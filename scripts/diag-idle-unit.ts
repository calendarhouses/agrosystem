/**
 * Діагностика холостого / полів для одного юніта за сьогодні.
 * npx tsx scripts/diag-idle-unit.ts [wialonUnitId]
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { kyivDayBoundsUnix, todayKyivYmd } from "../lib/kyiv-date";
import { hoursOnFieldFromGpsSamples } from "../lib/equipment-field-hours";
import {
  getWialonGeofences,
  getWialonUnitTrackBundle,
  wialonLogin,
  wialonResourcesToGeofenceGeoJSON,
} from "../lib/wialon";

const UNIT = Number(process.argv[2] || 601301822);

function haversineKm(
  a: [number, number],
  b: [number, number]
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function fmtH(h: number): string {
  const m = Math.round(h * 60);
  const hh = Math.floor(m / 60);
  const mm = m % 60;
  if (hh <= 0) return `${mm}хв`;
  if (mm <= 0) return `${hh}г`;
  return `${hh}г ${mm}хв`;
}

function fmtTime(unix: number): string {
  return new Date(unix * 1000).toLocaleTimeString("uk-UA", {
    timeZone: "Europe/Kyiv",
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function main() {
  const date = todayKyivYmd();
  const { fromUnix, toUnix: dayEnd } = kyivDayBoundsUnix(date);
  const toUnix = Math.min(Math.floor(Date.now() / 1000), dayEnd);

  console.log(`Unit ${UNIT} · ${date} · ${fmtTime(fromUnix)}–${fmtTime(toUnix)}`);

  const eid = await wialonLogin();
  const [bundle, resources] = await Promise.all([
    getWialonUnitTrackBundle(eid, UNIT, fromUnix, toUnix),
    getWialonGeofences(eid),
  ]);
  const geofences = wialonResourcesToGeofenceGeoJSON(resources);

  const summary = bundle.analytics?.summary;
  const samples = bundle.analytics?.samples ?? [];
  console.log("\n=== Summary з нашої аналітики ===");
  console.log({
    distanceKm: summary?.distanceKm,
    workHours: summary?.workHours,
    hoursIdling: summary?.hoursIdling,
    fuelStart: summary?.fuelStart,
    fuelEnd: summary?.fuelEnd,
    fuelConsumed: summary?.fuelConsumed,
    hasIgnition: summary?.hasIgnitionSensor,
    sampleCount: summary?.sampleCount,
    rawSamples: samples.length,
  });

  const fieldH = hoursOnFieldFromGpsSamples(
    samples,
    geofences,
    summary?.workHours && summary.workHours > 0 ? summary.workHours : undefined
  );
  console.log("hoursOnField (Wialon geofences):", fieldH, "=", fmtH(fieldH));

  // Speed histogram when ignition on
  const ignOn = samples.filter((s) => s.ignition === true);
  const buckets = [
    { label: "0–0.5", min: 0, max: 0.5 },
    { label: "0.5–2", min: 0.5, max: 2 },
    { label: "2–5", min: 2, max: 5 },
    { label: "5–12", min: 5, max: 12 },
    { label: "12+", min: 12, max: 999 },
  ];
  console.log("\n=== Швидкість при ignition ON (частка семплів) ===");
  for (const b of buckets) {
    const n = ignOn.filter((s) => s.speed >= b.min && s.speed < b.max).length;
    const pct = ignOn.length ? Math.round((n / ignOn.length) * 100) : 0;
    console.log(`  ${b.label.padEnd(6)} км/г: ${String(n).padStart(4)} (${pct}%)`);
  }

  // Reconstruct idle segments with OLD vs NEW thresholds
  type Seg = {
    start: number;
    end: number;
    km: number;
    avgKmh: number;
    countedNew: boolean;
    countedOld: boolean;
  };
  const segs: Seg[] = [];
  let runStart: number | null = null;
  let runStartIdx: number | null = null;

  const flush = (endIdx: number) => {
    if (runStart == null || runStartIdx == null) return;
    const endT = samples[endIdx]?.t ?? samples[samples.length - 1]!.t;
    const dur = endT - runStart;
    if (dur < 120) {
      runStart = null;
      runStartIdx = null;
      return;
    }
    let km = 0;
    for (let j = runStartIdx + 1; j <= endIdx; j++) {
      km += haversineKm(
        [samples[j - 1]!.lng, samples[j - 1]!.lat],
        [samples[j]!.lng, samples[j]!.lat]
      );
    }
    const hours = dur / 3600;
    const avgKmh = hours > 0 ? km / hours : 0;
    const maxNew = Math.min(0.08, 0.04 + 0.025 * hours);
    segs.push({
      start: runStart,
      end: endT,
      km,
      avgKmh,
      countedNew: km <= maxNew && avgKmh <= 0.2,
      countedOld: km <= 0.15 && avgKmh <= 0.35,
    });
    runStart = null;
    runStartIdx = null;
  };

  for (let i = 0; i < samples.length; i++) {
    const s = samples[i]!;
    const idle = s.speed <= 2 && s.ignition === true;
    if (idle) {
      if (runStart == null) {
        runStart = s.t;
        runStartIdx = i;
      }
    } else {
      flush(Math.max(0, i - 1));
    }
  }
  flush(samples.length - 1);

  const sum = (xs: Seg[], pred: (s: Seg) => boolean) =>
    xs.filter(pred).reduce((a, s) => a + (s.end - s.start), 0) / 3600;

  console.log("\n=== Сегменти «швидкість≤2 + запалення» ≥2хв ===");
  console.log(
    `усього кандидатів: ${segs.length}, Σ часу ${fmtH(sum(segs, () => true))}`
  );
  console.log(
    `старий фільтр (≤150м, ≤0.35км/г): ${fmtH(sum(segs, (s) => s.countedOld))}`
  );
  console.log(
    `новий фільтр (≤40м+25м/г, cap80м, ≤0.2км/г): ${fmtH(sum(segs, (s) => s.countedNew))}`
  );

  const top = [...segs].sort((a, b) => b.end - b.start - (a.end - a.start)).slice(0, 15);
  console.log("\nТоп сегментів за тривалістю:");
  for (const s of top) {
    const durH = (s.end - s.start) / 3600;
    console.log(
      `  ${fmtTime(s.start)}–${fmtTime(s.end)}  ${fmtH(durH).padEnd(10)}  ` +
        `зміщ=${(s.km * 1000).toFixed(0)}м  avg=${s.avgKmh.toFixed(2)}км/г  ` +
        `${s.countedNew ? "IDLE✓" : "відхилено"}` +
        `${s.countedOld && !s.countedNew ? " (було idle)" : ""}`
    );
  }

  // Moving vs stopped while ignition on (simple time-weighted by sample gaps)
  let moveSec = 0;
  let stopSec = 0;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1]!;
    const b = samples[i]!;
    if (a.ignition !== true) continue;
    const dt = Math.min(b.t - a.t, 300);
    if (dt <= 0) continue;
    if (a.speed > 2) moveSec += dt;
    else stopSec += dt;
  }
  console.log("\n=== Час ignition ON (по інтервалах семплів) ===");
  console.log(`  рух >2 км/г: ${fmtH(moveSec / 3600)}`);
  console.log(`  ≤2 км/г:     ${fmtH(stopSec / 3600)}`);
  console.log(`  разом:       ${fmtH((moveSec + stopSec) / 3600)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

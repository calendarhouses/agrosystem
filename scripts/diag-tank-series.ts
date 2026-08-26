import { config } from "dotenv";
config({ path: ".env.local" });

import { kyivDayBoundsUnix, shiftKyivYmd, todayKyivYmd } from "../lib/kyiv-date";
import { applySensorCalibrationTable } from "../lib/wialon-fuel-decode";
import {
  getWialonUnitSensors,
  listUnitSensors,
  loadWialonUnitMessages,
  wialonLogin,
} from "../lib/wialon";

const UNIT = Number(process.argv[2] || 601301822);
const DAY_OFFSET = Number(process.argv[3] || 0);

function hhmm(unix: number): string {
  return new Intl.DateTimeFormat("uk-UA", {
    timeZone: "Europe/Kyiv",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(unix * 1000));
}

async function main() {
  const eid = await wialonLogin();
  const date = shiftKyivYmd(todayKyivYmd(), -DAY_OFFSET);
  const { fromUnix, toUnix: dayEnd } = kyivDayBoundsUnix(date);
  const toUnix = Math.min(Math.floor(Date.now() / 1000), dayEnd);

  const messages = await loadWialonUnitMessages(eid, UNIT, fromUnix, toUnix);
  const unit = await getWialonUnitSensors(eid, UNIT);
  const sensors = unit ? listUnitSensors(unit) : [];

  const tanks = sensors.filter((s) => /бак/i.test(s.n || ""));
  console.log(
    "tanks:",
    tanks.map((t) => `${t.n} p=${t.p} tblPts=${t.tbl?.length ?? 0}`)
  );
  for (const t of tanks) {
    console.log(`  ${t.n} tbl:`, JSON.stringify(t.tbl?.slice(0, 6)));
  }

  let prevTotal: number | null = null;
  let printed = 0;
  for (let i = 0; i < messages.length; i++) {
    const p = (messages[i] as { p?: Record<string, unknown> }).p ?? {};
    const t = (messages[i] as { t: number }).t;
    const vals = tanks.map((tank) => {
      const key = String(tank.p ?? "");
      const raw = Number((p as Record<string, unknown>)[key]);
      const cal = tank.tbl?.length
        ? applySensorCalibrationTable(tank.tbl, raw)
        : raw;
      return { name: tank.n, raw, cal };
    });
    const total = vals.reduce((a, v) => a + (v.cal ?? 0), 0);
    const jump = prevTotal == null ? 0 : total - prevTotal;
    if (Math.abs(jump) >= 20 || i % 60 === 0 || i === messages.length - 1) {
      console.log(
        `${hhmm(t)} total=${total.toFixed(1).padStart(7)} ${
          Math.abs(jump) >= 20 ? (jump > 0 ? `▲+${jump.toFixed(1)}` : `▼${jump.toFixed(1)}`) : ""
        }  ` +
          vals
            .map((v) => `${v.name}: raw=${v.raw} → ${v.cal?.toFixed(1)}`)
            .join("  |  ")
      );
      printed++;
      if (printed > 60) break;
    }
    prevTotal = total;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

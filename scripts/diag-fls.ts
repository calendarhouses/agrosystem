import { config } from "dotenv";
config({ path: ".env.local" });

import { kyivDayBoundsUnix, shiftKyivYmd, todayKyivYmd } from "../lib/kyiv-date";
import { extractTimedFuelSamples } from "../lib/wialon-fuel-decode";
import {
  getWialonUnitSensors,
  listUnitSensors,
  loadWialonUnitMessages,
  wialonLogin,
} from "../lib/wialon";

const UNIT = Number(process.argv[2] || 601301822);
const DAY_OFFSET = Number(process.argv[3] || 0);

function hhmmKyiv(unix: number): string {
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

  console.log("unit", UNIT, unit?.nm, "date", date, "msgs", messages.length);
  console.log(
    "sensors:",
    sensors.map((s) => `${s.n} [${s.t}] p=${s.p}`)
  );

  // Сирі параметри перших повідомлень
  const raw = messages.slice(0, 3).map((m) => (m as { p?: unknown }).p);
  console.log("raw params sample:", JSON.stringify(raw, null, 1).slice(0, 900));

  const samples = extractTimedFuelSamples(messages, sensors);
  console.log("fuel samples:", samples.length);

  let prev: number | null = null;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i]!;
    const delta = prev == null ? 0 : s.liters - prev;
    const big = Math.abs(delta) >= 20;
    if (i % 25 === 0 || big) {
      console.log(
        `${hhmmKyiv(s.t)}  ${s.liters.toFixed(1).padStart(7)} л  ${
          big ? (delta > 0 ? `▲ +${delta.toFixed(1)}` : `▼ ${delta.toFixed(1)}`) : ""
        }`
      );
    }
    prev = s.liters;
  }

  const vals = samples.map((s) => s.liters);
  console.log("min", Math.min(...vals), "max", Math.max(...vals));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

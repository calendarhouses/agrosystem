import * as XLSX from "xlsx";

import type {
  DayAnalyticsSummary,
  FuelDrainEvent,
} from "@/lib/equipment-day-analytics";

export type ExportSessionRow = {
  startUnix: number;
  endUnix: number;
  name: string;
  kind: string;
};

export type DayExportPayload = {
  unitName: string;
  dateLabel: string;
  fileDate: string;
  sessions: ExportSessionRow[];
  summary: DayAnalyticsSummary;
  hoursOnField: number;
  hoursOnRoad: number;
  hoursAtBase: number;
  fuelEvents: FuelDrainEvent[];
};

function clock(unix: number): string {
  return new Date(unix * 1000).toLocaleTimeString("uk-UA", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function durationLabel(start: number, end: number): string {
  const totalMin = Math.max(0, Math.round((end - start) / 60));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h <= 0) return `${m} хв`;
  if (m <= 0) return `${h} год`;
  return `${h} год ${m} хв`;
}

function kindUk(kind: string): string {
  if (kind === "field") return "Поле";
  if (kind === "base") return "База";
  return "Дорога";
}

function hoursLabel(h: number): string {
  const totalMin = Math.round(h * 60);
  const hours = Math.floor(totalMin / 60);
  const minutes = totalMin % 60;
  if (hours <= 0) return `${minutes} хв`;
  if (minutes <= 0) return `${hours} год`;
  return `${hours} год ${minutes} хв`;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function safeFilePart(name: string): string {
  return name.replace(/[^\p{L}\p{N}_-]+/gu, "_").slice(0, 48);
}

export function exportDayJournalCsv(payload: DayExportPayload) {
  const lines: string[] = [
    "Час з;Час до;Локація;Тип;Тривалість",
    ...payload.sessions.map(
      (s) =>
        `${clock(s.startUnix)};${clock(s.endUnix)};${s.name};${kindUk(s.kind)};${durationLabel(s.startUnix, s.endUnix)}`
    ),
    "",
    "Підсумок",
    `Пробіг км;${payload.summary.distanceKm}`,
    `Робота;${hoursLabel(payload.summary.workHours)}`,
    `На полях;${hoursLabel(payload.hoursOnField)}`,
    `У дорозі;${hoursLabel(payload.hoursOnRoad)}`,
    `На базі;${hoursLabel(payload.hoursAtBase)}`,
    `Холостий хід;${hoursLabel(payload.summary.hoursIdling)}`,
    `Паливо зміна л;${payload.summary.fuelDelta ?? "—"}`,
    "",
    "Зливи",
    "Час з;Час до;Втрачено л;Впевненість",
    ...payload.fuelEvents.map(
      (e) =>
        `${clock(e.startUnix)};${clock(e.endUnix)};${e.litersLost};${e.confidence}`
    ),
  ];

  const bom = "\uFEFF";
  const blob = new Blob([bom + lines.join("\n")], {
    type: "text/csv;charset=utf-8",
  });
  downloadBlob(
    blob,
    `Техніка_${safeFilePart(payload.unitName)}_${payload.fileDate}.csv`
  );
}

export function exportDayJournalXlsx(payload: DayExportPayload) {
  const sessionsSheet = payload.sessions.map((s) => ({
    "Час з": clock(s.startUnix),
    "Час до": clock(s.endUnix),
    Локація: s.name,
    Тип: kindUk(s.kind),
    Тривалість: durationLabel(s.startUnix, s.endUnix),
  }));

  const summarySheet = [
    { Показник: "Техніка", Значення: payload.unitName },
    { Показник: "Дата", Значення: payload.dateLabel },
    {
      Показник: "Пробіг, км",
      Значення: payload.summary.distanceKm,
    },
    {
      Показник: "Робота",
      Значення: hoursLabel(payload.summary.workHours),
    },
    {
      Показник: "На полях",
      Значення: hoursLabel(payload.hoursOnField),
    },
    {
      Показник: "У дорозі",
      Значення: hoursLabel(payload.hoursOnRoad),
    },
    {
      Показник: "На базі",
      Значення: hoursLabel(payload.hoursAtBase),
    },
    {
      Показник: "Холостий хід",
      Значення: hoursLabel(payload.summary.hoursIdling),
    },
    {
      Показник: "Паливо старт, л",
      Значення: payload.summary.fuelStart ?? "—",
    },
    {
      Показник: "Паливо фініш, л",
      Значення: payload.summary.fuelEnd ?? "—",
    },
    {
      Показник: "Дельта палива, л",
      Значення: payload.summary.fuelDelta ?? "—",
    },
  ];

  const drainsSheet =
    payload.fuelEvents.length > 0
      ? payload.fuelEvents.map((e) => ({
          "Час з": clock(e.startUnix),
          "Час до": clock(e.endUnix),
          "Втрачено, л": e.litersLost,
          Впевненість: e.confidence === "high" ? "Висока" : "Середня",
          lat: e.lat,
          lng: e.lng,
        }))
      : [{ "Час з": "—", "Час до": "—", "Втрачено, л": 0, Впевненість: "Немає подій", lat: "", lng: "" }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(sessionsSheet),
    "Журнал"
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(summarySheet),
    "Підсумок"
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(drainsSheet),
    "Зливи"
  );

  XLSX.writeFile(
    wb,
    `Техніка_${safeFilePart(payload.unitName)}_${payload.fileDate}.xlsx`
  );
}

export function printDayJournalReport(payload: DayExportPayload) {
  const sessionsRows = payload.sessions
    .map(
      (s) =>
        `<tr>
          <td>${clock(s.startUnix)} – ${clock(s.endUnix)}</td>
          <td>${s.name}</td>
          <td>${kindUk(s.kind)}</td>
          <td>${durationLabel(s.startUnix, s.endUnix)}</td>
        </tr>`
    )
    .join("");

  const drainRows =
    payload.fuelEvents.length > 0
      ? payload.fuelEvents
          .map(
            (e) =>
              `<tr>
                <td>${clock(e.startUnix)} – ${clock(e.endUnix)}</td>
                <td>−${e.litersLost} л</td>
                <td>${e.confidence === "high" ? "Висока" : "Середня"}</td>
              </tr>`
          )
          .join("")
      : `<tr><td colspan="3">Підозр на злив не виявлено</td></tr>`;

  const html = `<!DOCTYPE html>
<html lang="uk">
<head>
  <meta charset="utf-8" />
  <title>Звіт · ${payload.unitName} · ${payload.dateLabel}</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, sans-serif; color: #18181b; padding: 32px; }
    h1 { font-size: 22px; margin: 0 0 4px; }
    .sub { color: #71717a; margin-bottom: 24px; font-size: 13px; }
    h2 { font-size: 14px; text-transform: uppercase; letter-spacing: 0.08em; color: #52525b; margin: 28px 0 10px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th, td { border-bottom: 1px solid #e4e4e7; padding: 8px 6px; text-align: left; }
    th { color: #71717a; font-weight: 600; }
    .cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: 8px; }
    .card { border: 1px solid #e5dfd3; border-radius: 12px; padding: 12px; background: #faf8f4; }
    .card b { display: block; font-size: 16px; margin-top: 4px; }
    .brand { color: #276749; font-weight: 700; font-size: 12px; letter-spacing: 0.12em; text-transform: uppercase; margin-bottom: 8px; }
  </style>
</head>
<body>
  <div class="brand">AgroSystem</div>
  <h1>${payload.unitName}</h1>
  <div class="sub">Журнал локацій · ${payload.dateLabel}</div>

  <h2>Підсумок зміни</h2>
  <div class="cards">
    <div class="card">Пробіг<b>${payload.summary.distanceKm} км</b></div>
    <div class="card">Робота<b>${hoursLabel(payload.summary.workHours)}</b></div>
    <div class="card">На полях<b>${hoursLabel(payload.hoursOnField)}</b></div>
    <div class="card">У дорозі<b>${hoursLabel(payload.hoursOnRoad)}</b></div>
    <div class="card">Холостий<b>${hoursLabel(payload.summary.hoursIdling)}</b></div>
    <div class="card">Паливо Δ<b>${payload.summary.fuelDelta ?? "—"} л</b></div>
  </div>

  <h2>Журнал локацій</h2>
  <table>
    <thead><tr><th>Час</th><th>Локація</th><th>Тип</th><th>Тривалість</th></tr></thead>
    <tbody>${sessionsRows || `<tr><td colspan="4">Немає сесій</td></tr>`}</tbody>
  </table>

  <h2>Події палива</h2>
  <table>
    <thead><tr><th>Час</th><th>Втрата</th><th>Впевненість</th></tr></thead>
    <tbody>${drainRows}</tbody>
  </table>
  <script>window.onload = () => { window.print(); setTimeout(() => window.close(), 300); };</script>
</body>
</html>`;

  const win = window.open("", "_blank", "noopener,noreferrer,width=900,height=700");
  if (!win) return;
  win.document.open();
  win.document.write(html);
  win.document.close();
}

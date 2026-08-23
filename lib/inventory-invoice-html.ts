import type { BasDocumentInvoice } from "@/lib/bas-api";

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function money(n: number): string {
  return new Intl.NumberFormat("uk-UA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function qty(n: number): string {
  return new Intl.NumberFormat("uk-UA", {
    maximumFractionDigits: n >= 100 ? 2 : 3,
  }).format(n);
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${d}.${m}.${y}`;
}

/** Друкована накладна з даних BAS (HTML → Print / Save as PDF). */
export function renderInvoiceHtml(invoice: BasDocumentInvoice): string {
  const title =
    invoice.type === "sale"
      ? "Видаткова накладна"
      : invoice.type === "production"
        ? "Звіт виробництва"
        : "Прибуткова накладна";
  const partyLabel =
    invoice.type === "sale"
      ? "Покупець"
      : invoice.type === "production"
        ? "Отримувач"
        : "Постачальник";
  const filename = `${
    invoice.type === "production" ? "Звіт" : "Накладна"
  }_${invoice.number}_${invoice.date || "doc"}`;

  const rows = invoice.lines
    .map(
      (line, i) => `
      <tr>
        <td class="num">${i + 1}</td>
        <td class="name">${esc(line.name)}${
          line.kind === "service"
            ? ' <span class="muted">(послуга)</span>'
            : ""
        }</td>
        <td class="unit">${esc(line.unit || "—")}</td>
        <td class="num">${qty(line.qty)}</td>
        <td class="num">${money(line.price)}</td>
        <td class="num">${money(line.sum)}</td>
        <td class="num">${line.vatRate || "—"}</td>
        <td class="num">${money(line.vat)}</td>
      </tr>`
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="uk">
<head>
  <meta charset="utf-8" />
  <title>${esc(title)} №${esc(invoice.number)}</title>
  <style>
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
      color: #18181b;
      background: #f4f4f5;
      line-height: 1.4;
    }
    .toolbar {
      position: sticky; top: 0; z-index: 10;
      display: flex; gap: 8px; justify-content: flex-end; align-items: center;
      padding: 12px 20px;
      background: rgba(255,255,255,.92);
      border-bottom: 1px solid #e4e4e7;
      backdrop-filter: blur(8px);
    }
    .toolbar button, .toolbar a {
      appearance: none; border: 1px solid #d4d4d8; background: #fff;
      border-radius: 10px; padding: 8px 14px; font-size: 13px; font-weight: 600;
      color: #18181b; cursor: pointer; text-decoration: none;
    }
    .toolbar .primary {
      background: #276749; border-color: #276749; color: #fff;
    }
    .sheet {
      width: 210mm; max-width: 100%;
      margin: 24px auto; padding: 18mm 16mm;
      background: #fff; box-shadow: 0 10px 40px rgba(0,0,0,.08);
    }
    h1 { margin: 0 0 4px; font-size: 22px; letter-spacing: -0.02em; }
    .meta { color: #71717a; font-size: 13px; margin-bottom: 18px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px 24px; margin-bottom: 18px; }
    .card {
      border: 1px solid #e4e4e7; border-radius: 12px; padding: 12px 14px;
      background: #fafafa;
    }
    .label { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: #71717a; margin-bottom: 4px; }
    .value { font-size: 14px; font-weight: 600; }
    .sub { font-size: 12px; color: #52525b; margin-top: 2px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th, td { border-bottom: 1px solid #e4e4e7; padding: 8px 6px; vertical-align: top; }
    th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: .03em; color: #71717a; font-weight: 700; }
    td.num, th.num { text-align: right; white-space: nowrap; }
    td.unit { white-space: nowrap; color: #52525b; }
    td.name { font-weight: 550; }
    .muted { color: #a1a1aa; font-weight: 400; }
    .totals {
      margin-top: 16px; margin-left: auto; width: 280px;
      border: 1px solid #e4e4e7; border-radius: 12px; overflow: hidden;
    }
    .totals div {
      display: flex; justify-content: space-between; gap: 12px;
      padding: 8px 12px; font-size: 13px; border-bottom: 1px solid #f4f4f5;
    }
    .totals div:last-child { border-bottom: 0; background: #f0fdf4; font-weight: 700; font-size: 14px; }
    .foot {
      margin-top: 28px; display: grid; grid-template-columns: 1fr 1fr; gap: 40px;
      font-size: 12px; color: #52525b;
    }
    .sign { border-top: 1px solid #a1a1aa; margin-top: 40px; padding-top: 6px; }
    .note { margin-top: 18px; font-size: 11px; color: #a1a1aa; }
    @media print {
      body { background: #fff; }
      .toolbar { display: none !important; }
      .sheet { margin: 0; box-shadow: none; width: auto; padding: 0; }
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <button type="button" onclick="window.print()" class="primary">Друкувати / PDF</button>
  </div>
  <main class="sheet">
    <h1>${esc(title)} №${esc(invoice.number)}</h1>
    <div class="meta">
      від ${esc(formatDate(invoice.date))}
    </div>

    <div class="grid">
      <div class="card">
        <div class="label">Постачальник / організація</div>
        <div class="value">${esc(invoice.organization.name)}</div>
        ${
          invoice.organization.edrpou
            ? `<div class="sub">ЄДРПОУ ${esc(invoice.organization.edrpou)}</div>`
            : ""
        }
      </div>
      <div class="card">
        <div class="label">${esc(partyLabel)}</div>
        <div class="value">${esc(invoice.counterparty.fullName || invoice.counterparty.name)}</div>
        ${
          invoice.counterparty.edrpou
            ? `<div class="sub">ЄДРПОУ ${esc(invoice.counterparty.edrpou)}</div>`
            : ""
        }
        ${
          invoice.counterparty.inn
            ? `<div class="sub">ІПН ${esc(invoice.counterparty.inn)}</div>`
            : ""
        }
      </div>
      ${
        invoice.contract
          ? `<div class="card"><div class="label">Договір</div><div class="value">${esc(invoice.contract)}</div></div>`
          : ""
      }
      ${
        invoice.warehouse
          ? `<div class="card"><div class="label">Склад</div><div class="value">${esc(invoice.warehouse)}</div></div>`
          : ""
      }
    </div>

    <table>
      <thead>
        <tr>
          <th class="num">№</th>
          <th>Найменування</th>
          <th>Од.</th>
          <th class="num">К-сть</th>
          <th class="num">Ціна</th>
          <th class="num">Сума</th>
          <th class="num">ПДВ</th>
          <th class="num">Сума ПДВ</th>
        </tr>
      </thead>
      <tbody>
        ${rows || `<tr><td colspan="8" class="muted">Немає рядків</td></tr>`}
      </tbody>
    </table>

    <div class="totals">
      ${
        invoice.type === "production"
          ? `<div><span>Планова собівартість</span><span>${money(invoice.amount)} ₴</span></div>`
          : `<div><span>Разом без ПДВ</span><span>${money(invoice.amount)} ₴</span></div>
      <div><span>ПДВ</span><span>${money(invoice.amountVat)} ₴</span></div>
      <div><span>Разом з ПДВ</span><span>${money(invoice.amountInclVat)} ₴</span></div>`
      }
    </div>

    ${
      invoice.comment
        ? `<p class="note">Коментар: ${esc(invoice.comment)}</p>`
        : ""
    }

    <div class="foot">
      <div>
        <div>Відпустив</div>
        <div class="sign">підпис</div>
      </div>
      <div>
        <div>Отримав</div>
        <div class="sign">підпис</div>
      </div>
    </div>

    <p class="note">Сформовано з даних BAS AGRO · ${esc(filename)}</p>
  </main>
</body>
</html>`;
}

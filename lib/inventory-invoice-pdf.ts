import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";

import type { BasDocumentInvoice } from "@/lib/bas-api";

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 42;
const CONTENT_W = PAGE_W - MARGIN * 2;
const FOOTER_H = 70;

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

function fontPaths() {
  const dir = path.join(process.cwd(), "lib", "fonts");
  const regular = path.join(dir, "DejaVuSans.ttf");
  const bold = path.join(dir, "DejaVuSans-Bold.ttf");
  if (!existsSync(regular) || !existsSync(bold)) {
    throw new Error("Не знайдено шрифти DejaVuSans у lib/fonts");
  }
  return { regular, bold };
}

function hex(value: string) {
  const clean = value.replace("#", "");
  const n = Number.parseInt(clean, 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

function splitLines(
  text: string,
  maxWidth: number,
  size: number,
  widthOf: (text: string, size: number) => number
): string[] {
  const parts = text.split(/\s+/).filter(Boolean);
  if (!parts.length) return [""];
  const lines: string[] = [];
  let current = "";
  for (const part of parts) {
    const next = current ? `${current} ${part}` : part;
    if (widthOf(next, size) <= maxWidth || !current) {
      current = next;
    } else {
      lines.push(current);
      current = part;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function blockHeight(
  text: string,
  width: number,
  size: number,
  font: import("pdf-lib").PDFFont,
  lineGap = 3
): number {
  const lines = splitLines(text, width, size, (t, s) => font.widthOfTextAtSize(t, s));
  return lines.length * size + Math.max(0, lines.length - 1) * lineGap;
}

function drawTextBlock(params: {
  page: import("pdf-lib").PDFPage;
  text: string;
  x: number;
  y: number;
  width: number;
  size: number;
  font: import("pdf-lib").PDFFont;
  color?: ReturnType<typeof rgb>;
  lineGap?: number;
}): number {
  const {
    page,
    text,
    x,
    y,
    width,
    size,
    font,
    color = hex("#18181b"),
    lineGap = 3,
  } = params;
  const lines = splitLines(text, width, size, (t, s) => font.widthOfTextAtSize(t, s));
  let cy = y;
  for (const line of lines) {
    page.drawText(line, { x, y: cy, size, font, color });
    cy -= size + lineGap;
  }
  return cy;
}

/** PDF-накладна з даних BAS. */
export async function renderInvoicePdf(
  invoice: BasDocumentInvoice
): Promise<Buffer> {
  const { regular, bold } = fontPaths();
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);

  const bodyFont = await pdf.embedFont(
    readFileSync(/*turbopackIgnore: true*/ regular)
  );
  const boldFont = await pdf.embedFont(
    readFileSync(/*turbopackIgnore: true*/ bold)
  );

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

  const cols = [
    { label: "№", w: 22, align: "right" as const },
    { label: "Найменування", w: 190, align: "left" as const },
    { label: "Од.", w: 34, align: "left" as const },
    { label: "К-сть", w: 48, align: "right" as const },
    { label: "Ціна", w: 56, align: "right" as const },
    { label: "Сума", w: 56, align: "right" as const },
    { label: "ПДВ", w: 32, align: "right" as const },
    { label: "Сума ПДВ", w: 57, align: "right" as const },
  ];

  let page = pdf.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  const addPage = () => {
    page = pdf.addPage([PAGE_W, PAGE_H]);
    y = PAGE_H - MARGIN;
  };

  const drawHeader = () => {
    page.drawText(`${title} №${invoice.number}`, {
      x: MARGIN,
      y,
      size: 16,
      font: boldFont,
      color: hex("#18181b"),
    });
    y -= 22;
    page.drawText(`від ${formatDate(invoice.date)}`, {
      x: MARGIN,
      y,
      size: 10,
      font: bodyFont,
      color: hex("#71717a"),
    });
    y -= 28;

    const cardW = (CONTENT_W - 12) / 2;
    const leftNameHeight = blockHeight(
      invoice.organization.name,
      cardW - 20,
      9,
      boldFont,
      2
    );
    const rightNameHeight = blockHeight(
      invoice.counterparty.fullName || invoice.counterparty.name,
      cardW - 20,
      9,
      boldFont,
      2
    );
    const extraLeft = invoice.organization.edrpou ? 14 : 0;
    const extraRight =
      (invoice.counterparty.edrpou ? 14 : 0) + (invoice.counterparty.inn ? 14 : 0);
    const cardH = Math.max(74, 24 + Math.max(leftNameHeight + extraLeft, rightNameHeight + extraRight));
    const cardY = y - cardH;
    for (const x of [MARGIN, MARGIN + cardW + 12]) {
      page.drawRectangle({
        x,
        y: cardY,
        width: cardW,
        height: cardH,
        borderColor: hex("#e4e4e7"),
        borderWidth: 1,
        color: hex("#fafafa"),
      });
    }

    drawTextBlock({
      page,
      text: "ПОСТАЧАЛЬНИК / ОРГАНІЗАЦІЯ",
      x: MARGIN + 10,
      y: y - 14,
      width: cardW - 20,
      size: 7,
      font: bodyFont,
      color: hex("#71717a"),
      lineGap: 2,
    });
    drawTextBlock({
      page,
      text: invoice.organization.name,
      x: MARGIN + 10,
      y: y - 27,
      width: cardW - 20,
      size: 9,
      font: boldFont,
      color: hex("#18181b"),
      lineGap: 2,
    });
    let leftMetaY = y - 27 - leftNameHeight - 3;
    if (invoice.organization.edrpou) {
      drawTextBlock({
        page,
        text: `ЄДРПОУ ${invoice.organization.edrpou}`,
        x: MARGIN + 10,
        y: leftMetaY,
        width: cardW - 20,
        size: 8,
        font: bodyFont,
        color: hex("#52525b"),
      });
    }

    const rx = MARGIN + cardW + 12;
    drawTextBlock({
      page,
      text: partyLabel.toUpperCase(),
      x: rx + 10,
      y: y - 14,
      width: cardW - 20,
      size: 7,
      font: bodyFont,
      color: hex("#71717a"),
      lineGap: 2,
    });
    let rightY = drawTextBlock({
      page,
      text: invoice.counterparty.fullName || invoice.counterparty.name,
      x: rx + 10,
      y: y - 27,
      width: cardW - 20,
      size: 9,
      font: boldFont,
      color: hex("#18181b"),
      lineGap: 2,
    });
    if (invoice.counterparty.edrpou) {
      rightY = drawTextBlock({
        page,
        text: `ЄДРПОУ ${invoice.counterparty.edrpou}`,
        x: rx + 10,
        y: rightY - 3,
        width: cardW - 20,
        size: 8,
        font: bodyFont,
        color: hex("#52525b"),
      });
    }
    if (invoice.counterparty.inn) {
      drawTextBlock({
        page,
        text: `ІПН ${invoice.counterparty.inn}`,
        x: rx + 10,
        y: rightY - 3,
        width: cardW - 20,
        size: 8,
        font: bodyFont,
        color: hex("#52525b"),
      });
    }

    y = cardY - 18;
    if (invoice.contract) {
      y = drawTextBlock({
        page,
        text: `Договір: ${invoice.contract}`,
        x: MARGIN,
        y,
        width: CONTENT_W,
        size: 10,
        font: bodyFont,
        color: hex("#52525b"),
      }) - 4;
    }
    if (invoice.warehouse) {
      y = drawTextBlock({
        page,
        text: `Склад: ${invoice.warehouse}`,
        x: MARGIN,
        y,
        width: CONTENT_W,
        size: 10,
        font: bodyFont,
        color: hex("#52525b"),
      }) - 8;
    }

    let x = MARGIN;
    for (const col of cols) {
      page.drawText(col.label, {
        x: col.align === "right" ? x + col.w - boldFont.widthOfTextAtSize(col.label, 8) : x,
        y,
        size: 8,
        font: boldFont,
        color: hex("#71717a"),
      });
      x += col.w;
    }
    y -= 8;
    page.drawLine({
      start: { x: MARGIN, y },
      end: { x: PAGE_W - MARGIN, y },
      thickness: 0.8,
      color: hex("#e4e4e7"),
    });
    y -= 12;
  };

  drawHeader();

  for (let i = 0; i < invoice.lines.length; i++) {
    const line = invoice.lines[i]!;
    const name = line.kind === "service" ? `${line.name} (послуга)` : line.name;
    const wrappedName = splitLines(name, cols[1].w - 6, 9, (t, s) =>
      bodyFont.widthOfTextAtSize(t, s)
    );
    const rowH = Math.max(14, wrappedName.length * 12) + 4;

    if (y - rowH < MARGIN + FOOTER_H) {
      addPage();
      drawHeader();
    }

    const top = y;
    const values = [
      String(i + 1),
      name,
      line.unit || "—",
      qty(line.qty),
      money(line.price),
      money(line.sum),
      line.vatRate || "—",
      money(line.vat),
    ];

    let x = MARGIN;
    for (let c = 0; c < cols.length; c++) {
      const col = cols[c]!;
      if (c === 1) {
        drawTextBlock({
          page,
          text: values[c]!,
          x,
          y: top,
          width: col.w - 6,
          size: 9,
          font: bodyFont,
          color: hex("#18181b"),
          lineGap: 3,
        });
      } else {
        const font = bodyFont;
        const text = values[c]!;
        const textWidth = font.widthOfTextAtSize(text, 9);
        page.drawText(text, {
          x: col.align === "right" ? x + col.w - textWidth : x,
          y: top,
          size: 9,
          font,
          color: hex("#18181b"),
        });
      }
      x += col.w;
    }

    y -= rowH;
    page.drawLine({
      start: { x: MARGIN, y: y + 2 },
      end: { x: PAGE_W - MARGIN, y: y + 2 },
      thickness: 0.5,
      color: hex("#f4f4f5"),
    });
    y -= 6;
  }

  if (y - 110 < MARGIN) {
    addPage();
  }

  const totalsX = PAGE_W - MARGIN - 210;
  const totals = [
    ["Разом без ПДВ", `${money(invoice.amount)} ₴`],
    ["ПДВ", `${money(invoice.amountVat)} ₴`],
    ["Разом з ПДВ", `${money(invoice.amountInclVat)} ₴`],
  ] as const;
  for (let i = 0; i < totals.length; i++) {
    const [label, value] = totals[i]!;
    const isLast = i === totals.length - 1;
    page.drawText(label, {
      x: totalsX,
      y,
      size: isLast ? 11 : 10,
      font: isLast ? boldFont : bodyFont,
      color: hex("#18181b"),
    });
    const valueWidth = (isLast ? boldFont : bodyFont).widthOfTextAtSize(
      value,
      isLast ? 11 : 10
    );
    page.drawText(value, {
      x: PAGE_W - MARGIN - valueWidth,
      y,
      size: isLast ? 11 : 10,
      font: isLast ? boldFont : bodyFont,
      color: hex("#18181b"),
    });
    y -= 16;
  }

  if (invoice.comment) {
    y -= 8;
    y = drawTextBlock({
      page,
      text: `Коментар: ${invoice.comment}`,
      x: MARGIN,
      y,
      width: CONTENT_W,
      size: 9,
      font: bodyFont,
      color: hex("#71717a"),
    }) - 10;
  }

  y -= 18;
  page.drawText("Відпустив", {
    x: MARGIN,
    y,
    size: 10,
    font: bodyFont,
    color: hex("#52525b"),
  });
  page.drawText("Отримав", {
    x: MARGIN + 260,
    y,
    size: 10,
    font: bodyFont,
    color: hex("#52525b"),
  });
  page.drawLine({
    start: { x: MARGIN, y: y - 22 },
    end: { x: MARGIN + 160, y: y - 22 },
    thickness: 0.8,
    color: hex("#a1a1aa"),
  });
  page.drawLine({
    start: { x: MARGIN + 260, y: y - 22 },
    end: { x: MARGIN + 420, y: y - 22 },
    thickness: 0.8,
    color: hex("#a1a1aa"),
  });

  page.drawText("підпис", {
    x: MARGIN,
    y: y - 34,
    size: 8,
    font: bodyFont,
    color: hex("#a1a1aa"),
  });
  page.drawText("підпис", {
    x: MARGIN + 260,
    y: y - 34,
    size: 8,
    font: bodyFont,
    color: hex("#a1a1aa"),
  });

  page.drawText(
    `Сформовано з даних BAS AGRO · Накладна_${invoice.number}_${invoice.date || "doc"}`,
    {
      x: MARGIN,
      y: 18,
      size: 8,
      font: bodyFont,
      color: hex("#a1a1aa"),
    }
  );

  const bytes = await pdf.save();
  return Buffer.from(bytes);
}

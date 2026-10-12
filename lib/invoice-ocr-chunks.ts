/**
 * Злиття чанків OCR великих накладних (по ~25 рядків / сторінка).
 */

import type { InvoiceLineInput } from "@/lib/agent-warehouse-receipt";

const CHUNK_HINT = 25;

export function invoiceChunkSize(): number {
  return CHUNK_HINT;
}

function lineKey(line: InvoiceLineInput): string {
  const art = (line.article ?? "").trim().toLocaleLowerCase("uk-UA");
  const name = line.name.trim().toLocaleLowerCase("uk-UA");
  const unit = line.unit.trim().toLocaleLowerCase("uk-UA");
  return `${art}|${name}|${unit}|${line.quantity}|${line.pricePerUnit}`;
}

/** Зливає кілька батчів позицій без дублів (однаковий ключ). */
export function mergeInvoiceLineChunks(
  chunks: InvoiceLineInput[][]
): InvoiceLineInput[] {
  const seen = new Set<string>();
  const out: InvoiceLineInput[] = [];
  for (const chunk of chunks) {
    for (const line of chunk) {
      const key = lineKey(line);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(line);
    }
  }
  return out;
}

export function validateInvoiceLineCoverage(input: {
  items: InvoiceLineInput[];
  expectedMinLines?: number | null;
  totalAmount?: number | null;
}): { ok: boolean; warnings: string[] } {
  const warnings: string[] = [];
  const n = input.items.length;
  if (input.expectedMinLines != null && n < input.expectedMinLines) {
    warnings.push(
      `Розпізнано ${n} рядків, очікувалось ≥ ${input.expectedMinLines} — можливо, обрізано OCR.`
    );
  }
  if (input.totalAmount != null && Number.isFinite(input.totalAmount)) {
    const sum = input.items.reduce((s, line) => {
      const t =
        line.totalAmount != null && Number.isFinite(line.totalAmount)
          ? Number(line.totalAmount)
          : Number(line.quantity) * Number(line.pricePerUnit);
      return s + (Number.isFinite(t) ? t : 0);
    }, 0);
    if (Math.abs(sum - Number(input.totalAmount)) > 1) {
      warnings.push(
        `Сума рядків ≈ ${sum.toFixed(2)} ₴, підсумок накладної ${Number(input.totalAmount).toFixed(2)} ₴.`
      );
    }
  }
  if (n > CHUNK_HINT) {
    warnings.push(
      `Велика накладна (${n} рядків) — перевір, що всі сторінки/чанки ввійшли в превʼю.`
    );
  }
  return { ok: warnings.length === 0, warnings };
}

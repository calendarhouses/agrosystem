/**
 * Злиття чанків OCR великих накладних (по ~25 рядків / сторінка)
 * + математична валідація к-сть × ціна ≈ сума.
 */

import type { InvoiceLineInput } from "@/lib/agent-warehouse-receipt";

const CHUNK_HINT = 25;
/** Допуск на рядок (коп.) */
const LINE_MATH_TOLERANCE = 0.02;

export function invoiceChunkSize(): number {
  return CHUNK_HINT;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function lineKey(line: InvoiceLineInput): string {
  const art = (line.article ?? "").trim().toLocaleLowerCase("uk-UA");
  const name = line.name.trim().toLocaleLowerCase("uk-UA");
  const unit = line.unit.trim().toLocaleLowerCase("uk-UA");
  const size = (line.size ?? "").trim().toLocaleLowerCase("uk-UA");
  return `${art}|${name}|${unit}|${size}|${line.quantity}|${line.pricePerUnit}`;
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

export function validateLineMath(line: InvoiceLineInput): {
  ok: boolean;
  computed: number;
  declared: number | null;
  delta: number;
} {
  const qty = Number(line.quantity);
  const price = Number(line.pricePerUnit);
  const computed = round2(
    (Number.isFinite(qty) ? qty : 0) * (Number.isFinite(price) ? price : 0)
  );
  const declared =
    line.totalAmount != null && Number.isFinite(Number(line.totalAmount))
      ? round2(Number(line.totalAmount))
      : null;
  if (declared == null) {
    return { ok: true, computed, declared: null, delta: 0 };
  }
  const delta = round2(declared - computed);
  return {
    ok: Math.abs(delta) <= LINE_MATH_TOLERANCE,
    computed,
    declared,
    delta,
  };
}

export function validateInvoiceLineCoverage(input: {
  items: InvoiceLineInput[];
  expectedMinLines?: number | null;
  totalAmount?: number | null;
  vatAmount?: number | null;
  totalInclVat?: number | null;
}): { ok: boolean; warnings: string[] } {
  const warnings: string[] = [];
  const n = input.items.length;
  if (input.expectedMinLines != null && n < input.expectedMinLines) {
    warnings.push(
      `Розпізнано ${n} рядків, очікувалось ≥ ${input.expectedMinLines} — можливо, обрізано OCR.`
    );
  }

  let mathBad = 0;
  for (const line of input.items) {
    const check = validateLineMath(line);
    if (!check.ok) {
      mathBad += 1;
      if (mathBad <= 5) {
        warnings.push(
          `«${line.name}»: ${line.quantity}×${line.pricePerUnit} = ${check.computed.toFixed(2)}, у документі сума ${check.declared?.toFixed(2)} (Δ ${check.delta.toFixed(2)}).`
        );
      }
    }
  }
  if (mathBad > 5) {
    warnings.push(`Ще ${mathBad - 5} рядків з розбіжністю к-сть×ціна ≠ сума.`);
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
    if (
      input.vatAmount != null &&
      input.totalInclVat != null &&
      Math.abs(
        Number(input.totalInclVat) -
          (Number(input.totalAmount) + Number(input.vatAmount))
      ) > 0.05
    ) {
      warnings.push(
        `Шапка: без ПДВ ${Number(input.totalAmount).toFixed(2)} + ПДВ ${Number(input.vatAmount).toFixed(2)} ≠ з ПДВ ${Number(input.totalInclVat).toFixed(2)}.`
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

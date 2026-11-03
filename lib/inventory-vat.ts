/** Ставки ПДВ для приходу ТМЦ (еталон аудиту / BAS СтавкаНДС). */
export const INVENTORY_VAT_RATES = [
  { id: "20", label: "20%", percent: 20 },
  { id: "14", label: "14%", percent: 14 },
  { id: "7", label: "7%", percent: 7 },
  { id: "0", label: "0%", percent: 0 },
  { id: "none", label: "Без ПДВ", percent: null },
] as const;

export type InventoryVatRateId = (typeof INVENTORY_VAT_RATES)[number]["id"];

export type InventoryVatBreakdown = {
  qty: number;
  unitPriceExVat: number;
  amountExVat: number;
  vatRate: InventoryVatRateId;
  vatPercent: number | null;
  vatAmount: number;
  amountInclVat: number;
};

export function roundMoney2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function roundPrice4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/** Дозволяє порожній рядок під час редагування; крапка або кома як десятковий роздільник. */
export function sanitizeDecimalInput(
  raw: string,
  options?: { maxFractionDigits?: number }
): string {
  const maxFrac = options?.maxFractionDigits;
  const normalized = raw.replace(/\s/g, "").replace(",", ".");
  let out = "";
  let seenDot = false;
  let frac = 0;
  for (const ch of normalized) {
    if (ch >= "0" && ch <= "9") {
      if (seenDot) {
        if (maxFrac != null && frac >= maxFrac) continue;
        frac += 1;
      }
      out += ch;
      continue;
    }
    if (ch === "." && !seenDot) {
      out += ".";
      seenDot = true;
    }
  }
  return out;
}

/** Суми завжди з 2 знаками (.90, не .9). */
export function formatMoney2(n: number): string {
  return roundMoney2(n).toLocaleString("uk-UA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Ціна без ПДВ — до 4 знаків (312,9700). */
export function formatPrice4(n: number): string {
  const rounded = roundPrice4(n);
  const fixed = rounded.toFixed(4).replace(/\.?0+$/, "");
  const [intPart, frac = ""] = fixed.split(".");
  const intFmt = Number(intPart).toLocaleString("uk-UA");
  if (!frac) return intFmt;
  // Мінімум 2 знаки для «грошового» вигляду, максимум 4
  const padded = frac.length < 2 ? frac.padEnd(2, "0") : frac;
  return `${intFmt},${padded}`;
}

/** Рядок ціни для інпута (крапка, до 4 знаків). */
export function priceToInput(n: number): string {
  const rounded = roundPrice4(n);
  const s = rounded.toFixed(4).replace(/\.?0+$/, "");
  if (!s.includes(".")) return s;
  const [a, b = ""] = s.split(".");
  return `${a}.${b.length < 2 ? b.padEnd(2, "0") : b}`;
}

/** Рядок суми для інпута (завжди 2 знаки). */
export function moneyToInput(n: number): string {
  return roundMoney2(n).toFixed(2);
}

export function parseDecimalInput(raw: string): number | null {
  const t = raw.trim().replace(",", ".");
  if (!t || t === ".") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function isInventoryVatRateId(v: unknown): v is InventoryVatRateId {
  return (
    v === "20" || v === "14" || v === "7" || v === "0" || v === "none"
  );
}

export function vatPercentOf(rate: InventoryVatRateId): number | null {
  const row = INVENTORY_VAT_RATES.find((r) => r.id === rate);
  return row?.percent ?? null;
}

export function computeInventoryVat(input: {
  qty: number;
  unitPriceExVat: number;
  vatRate: InventoryVatRateId;
  /** Якщо передано — пріоритет над qty×price (після ручного вводу суми). */
  amountExVat?: number | null;
}): InventoryVatBreakdown {
  const qty = Number(input.qty);
  const unitPriceExVat = Number(input.unitPriceExVat);
  const vatRate = isInventoryVatRateId(input.vatRate) ? input.vatRate : "20";
  const amountExVat =
    input.amountExVat != null && Number.isFinite(Number(input.amountExVat))
      ? roundMoney2(Number(input.amountExVat))
      : roundMoney2(
          (Number.isFinite(qty) ? qty : 0) *
            (Number.isFinite(unitPriceExVat) ? unitPriceExVat : 0)
        );
  const percent = vatPercentOf(vatRate);
  const vatAmount =
    percent == null ? 0 : roundMoney2((amountExVat * percent) / 100);
  const amountInclVat = roundMoney2(amountExVat + vatAmount);
  return {
    qty: Number.isFinite(qty) ? qty : 0,
    unitPriceExVat: Number.isFinite(unitPriceExVat)
      ? roundPrice4(unitPriceExVat)
      : 0,
    amountExVat,
    vatRate,
    vatPercent: percent,
    vatAmount,
    amountInclVat,
  };
}

/**
 * Зворотний перерахунок від «Усього з ПДВ» (або ціни з ПДВ).
 * amountInclVat → amountExVat / vat / unitPriceExVat.
 */
export function computeInventoryVatFromIncl(input: {
  qty: number;
  amountInclVat: number;
  vatRate: InventoryVatRateId;
}): InventoryVatBreakdown {
  const qty = Number.isFinite(Number(input.qty)) ? Number(input.qty) : 0;
  const incl = roundMoney2(Number(input.amountInclVat) || 0);
  const vatRate = isInventoryVatRateId(input.vatRate) ? input.vatRate : "20";
  const percent = vatPercentOf(vatRate);
  let amountExVat: number;
  let vatAmount: number;
  if (percent == null || percent === 0) {
    amountExVat = incl;
    vatAmount = 0;
  } else {
    amountExVat = roundMoney2(incl / (1 + percent / 100));
    vatAmount = roundMoney2(incl - amountExVat);
  }
  const unitPriceExVat =
    qty > 0 ? roundPrice4(amountExVat / qty) : 0;
  return {
    qty,
    unitPriceExVat,
    amountExVat,
    vatRate,
    vatPercent: percent,
    vatAmount,
    amountInclVat: incl,
  };
}

/** Ціна з ПДВ → ціна без ПДВ (для режиму «ціна включає ПДВ»). */
export function unitPriceExVatFromIncl(
  unitPriceIncl: number,
  vatRate: InventoryVatRateId
): number {
  const percent = vatPercentOf(vatRate);
  if (percent == null || percent === 0) return roundPrice4(unitPriceIncl);
  return roundPrice4(unitPriceIncl / (1 + percent / 100));
}

/** BAS enum-подібний рядок для СтавкаНДС. */
export function basVatRateLabel(rate: InventoryVatRateId): string {
  switch (rate) {
    case "20":
      return "НДС20";
    case "14":
      return "НДС14";
    case "7":
      return "НДС7";
    case "0":
      return "НДС0";
    case "none":
      return "БезНДС";
  }
}

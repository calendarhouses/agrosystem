import type {
  BasCounterparty,
  BasHarvestMovement,
  BasNomenclature,
  BasPurchaseMovement,
  BasReceiptDoc,
  BasSaleDoc,
  BasSaleMovement,
  BasUnit,
} from "@/lib/bas-api";
import { normalizeBasRefKey } from "@/lib/bas-mapping";

export type InventoryCategory =
  | "zzr"
  | "fertilizer"
  | "harvest"
  | "seed"
  | "parts";

export const INVENTORY_CATEGORIES: InventoryCategory[] = [
  "zzr",
  "harvest",
  "fertilizer",
  "seed",
  "parts",
];

export type InventoryItem = {
  id: string;
  name: string;
  code: string | null;
  category: InventoryCategory;
  unit: string;
  /** Надходження / випуск за період */
  qtyIn: number;
  /** Продажі / витрати за період */
  qtyOut: number;
  costIn: number;
  costOut: number;
  /** Сума грошового обороту (in+out) — для сортування */
  cost: number;
  moveCount: number;
  lastDate: string | null;
};

export type InventoryCategorySummary = {
  category: InventoryCategory;
  label: string;
  description: string;
  itemCount: number;
  activeCount: number;
  totalQty: number;
  totalCost: number;
  topUnit: string | null;
};

export type InventoryDashboard = {
  periodLabel: string;
  since: string;
  categories: InventoryCategorySummary[];
  items: InventoryItem[];
  /** Реальний Balance ТоварыНаСкладах через OData порожній — показуємо рухи */
  stockNote: string;
};

export const INVENTORY_CATEGORY_META: Record<
  InventoryCategory,
  { label: string; description: string; accent: string }
> = {
  zzr: {
    label: "ЗЗР",
    description: "Засоби захисту рослин",
    accent: "#276749",
  },
  fertilizer: {
    label: "Добрива",
    description: "Мінеральні та органо-мінеральні",
    accent: "#C05621",
  },
  harvest: {
    label: "Врожай",
    description: "Продукція рослиництва",
    accent: "#B7791F",
  },
  seed: {
    label: "Насіння",
    description: "Посівні матеріали",
    accent: "#2F855A",
  },
  parts: {
    label: "Запчастини",
    description: "Деталі та витратні матеріали",
    accent: "#4A5568",
  },
};

const FOLDER_ZZR = "ЗЗР, мін.добриво";
const FOLDER_PARTS = "Запчастини";
const FOLDER_HARVEST = ["Продукція С/Г рослиництво", "Продукція"];
/** У BAS немає окремої «Насіння» — папка «Посівні матеріали» */
const FOLDER_SEEDS = "Посівні матеріали";

const PESTICIDE_HINT_RE =
  /інсектицид|гербіцид|фунгіцид|протрую|десикант|прилипач|ад.?ювант|пестицид/i;

const FERTILIZER_RE =
  /добрив|npk|аміачн|карбамід|карабмід|сечовин|селітр|калій|сульфат амон|амоній|кас[\s\-]?3|діамофоск|нітроамоф|гумат|мікродобрив|азотно-фосфор|органо.?мінерал|хелат|бор\b|boron|polyfeed|мульти.?к|криста|ярам|yaramila|hortumus|rhizum|новолон|новалон|аммофос|суперфосфат|амофоск|азотн|агромастер|crissol|нутрівант|послід|моноамоній|мар\b|map\b|dap\b|фосфат|стимул.?мікс|kopmih|ikor|ikar|brandт|brandt|хелатамін|controval|стериль|sterk|speedfol|спідфол|powerfol energy|паверфол energy|amino start|growstim|lumik|quattro|кватрофос/i;

export function isFertilizerName(name: string): boolean {
  if (PESTICIDE_HINT_RE.test(name)) return false;
  return FERTILIZER_RE.test(name);
}

function guidOf(raw: string | null | undefined): string | null {
  return normalizeBasRefKey(raw);
}

type MovementAgg = { qty: number; cost: number; n: number; last: string | null };

function aggregatePurchases(
  rows: BasPurchaseMovement[]
): Map<string, MovementAgg> {
  const map = new Map<string, MovementAgg>();
  for (const row of rows) {
    const key = guidOf(row.Номенклатура);
    if (!key) continue;
    const cur = map.get(key) ?? { qty: 0, cost: 0, n: 0, last: null };
    cur.qty += Number(row.Количество) || 0;
    cur.cost += Number(row.Стоимость) || 0;
    cur.n += 1;
    if (!cur.last || (row.Period && row.Period > cur.last)) {
      cur.last = row.Period ?? null;
    }
    map.set(key, cur);
  }
  return map;
}

function aggregateHarvest(
  rows: BasHarvestMovement[]
): Map<string, MovementAgg> {
  const map = new Map<string, MovementAgg>();
  for (const row of rows) {
    const key = guidOf(row.Номенклатура);
    if (!key) continue;
    const cur = map.get(key) ?? { qty: 0, cost: 0, n: 0, last: null };
    cur.qty += Number(row.Количество) || 0;
    cur.cost += Number(row.Сумма) || 0;
    cur.n += 1;
    if (!cur.last || (row.Period && row.Period > cur.last)) {
      cur.last = row.Period ?? null;
    }
    map.set(key, cur);
  }
  return map;
}

function itemsInFolders(
  all: BasNomenclature[],
  folderNames: string[]
): BasNomenclature[] {
  const folders = all.filter(
    (row) =>
      row.IsFolder &&
      !row.DeletionMark &&
      folderNames.includes(row.Description?.trim() ?? "")
  );
  const parentKeys = new Set(
    folders.map((f) => f.Ref_Key.toLowerCase())
  );
  return all.filter(
    (row) =>
      !row.IsFolder &&
      !row.DeletionMark &&
      parentKeys.has((row.Parent_Key ?? "").toLowerCase())
  );
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function topUnitFor(items: InventoryItem[]): string | null {
  const counts = new Map<string, number>();
  for (const item of items) {
    if (!item.unit || (item.qtyIn <= 0 && item.qtyOut <= 0)) continue;
    counts.set(item.unit, (counts.get(item.unit) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestN = 0;
  for (const [unit, n] of counts) {
    if (n > bestN) {
      best = unit;
      bestN = n;
    }
  }
  return best;
}

function summarizeCategory(
  category: InventoryCategory,
  items: InventoryItem[]
): InventoryCategorySummary {
  const meta = INVENTORY_CATEGORY_META[category];
  const active = items.filter((i) => i.moveCount > 0);
  return {
    category,
    label: meta.label,
    description: meta.description,
    itemCount: items.length,
    activeCount: active.length,
    totalQty: round2(active.reduce((s, i) => s + i.qtyIn, 0)),
    totalCost: Math.round(active.reduce((s, i) => s + i.cost, 0)),
    topUnit: topUnitFor(active),
  };
}

export function buildInventoryDashboard(input: {
  nomenclature: BasNomenclature[];
  units: BasUnit[];
  purchases: BasPurchaseMovement[];
  harvest: BasHarvestMovement[];
  since?: string;
}): InventoryDashboard {
  const since = input.since ?? "2025-01-01T00:00:00";
  const unitMap = new Map(
    input.units.map((u) => [
      u.Ref_Key.toLowerCase(),
      u.Description?.trim() || u.Code?.trim() || "",
    ])
  );
  const purchaseMap = aggregatePurchases(input.purchases);
  const harvestMap = aggregateHarvest(input.harvest);

  const zzrFolder = itemsInFolders(input.nomenclature, [FOLDER_ZZR]);
  const fertilizerRaw = zzrFolder.filter((row) =>
    isFertilizerName(row.Description ?? "")
  );
  const fertilizerKeys = new Set(fertilizerRaw.map((r) => r.Ref_Key));
  const zzrRaw = zzrFolder.filter((row) => !fertilizerKeys.has(row.Ref_Key));
  const partsRaw = itemsInFolders(input.nomenclature, [FOLDER_PARTS]);
  const harvestRaw = itemsInFolders(input.nomenclature, FOLDER_HARVEST);
  const seedsRaw = itemsInFolders(input.nomenclature, [FOLDER_SEEDS]);

  function toItems(
    rows: BasNomenclature[],
    category: InventoryCategory,
    movement: Map<string, MovementAgg>
  ): InventoryItem[] {
    return rows
      .map((row) => {
        const key = row.Ref_Key.toLowerCase();
        const m = movement.get(key);
        return {
          id: key,
          name: row.Description?.trim() || "Без назви",
          code: row.Code?.trim() || null,
          category,
          unit:
            unitMap.get(
              (row.БазоваяЕдиницаИзмерения_Key ?? "").toLowerCase()
            ) || "",
          qtyIn: round2(m?.qty ?? 0),
          qtyOut: 0,
          costIn: Math.round(m?.cost ?? 0),
          costOut: 0,
          cost: Math.round(m?.cost ?? 0),
          moveCount: m?.n ?? 0,
          lastDate: m?.last?.slice(0, 10) ?? null,
        };
      })
      .sort(
        (a, b) =>
          b.cost - a.cost ||
          b.qtyIn - a.qtyIn ||
          a.name.localeCompare(b.name, "uk")
      );
  }

  const items = [
    ...toItems(zzrRaw, "zzr", purchaseMap),
    ...toItems(fertilizerRaw, "fertilizer", purchaseMap),
    ...toItems(harvestRaw, "harvest", harvestMap),
    ...toItems(seedsRaw, "seed", purchaseMap),
    ...toItems(partsRaw, "parts", purchaseMap),
  ];

  const categories: InventoryCategorySummary[] = INVENTORY_CATEGORIES.map(
    (cat) =>
    summarizeCategory(
      cat,
      items.filter((i) => i.category === cat)
    )
  );

  return {
    periodLabel: "2025–2026",
    since,
    categories,
    items,
    stockNote:
      "Залишки ТоварыНаСкладах через OData порожні. Показуємо окремо випуск/надходження і продажі (у BAS часто різні номенклатури).",
  };
}

export function formatInventoryQty(qty: number, unit: string): string {
  if (!Number.isFinite(qty) || qty === 0) return "—";
  const formatted = new Intl.NumberFormat("uk-UA", {
    maximumFractionDigits: Math.abs(qty) >= 100 ? 0 : 2,
  }).format(qty);
  return unit ? `${formatted} ${unit}` : formatted;
}

export function formatInventoryMoney(amount: number): string {
  if (!amount) return "—";
  return new Intl.NumberFormat("uk-UA", {
    style: "currency",
    currency: "UAH",
    maximumFractionDigits: 0,
  }).format(amount);
}

// ── Документи та помісячна аналітика ───────────────────────────────

export type DocRow = {
  refKey: string;
  number: string;
  date: string;
  amount: number;
  counterparty: string;
  type: "receipt" | "sale";
};

export type MonthBucket = {
  month: string; // "2025-01"
  label: string; // "Січ 2025"
  receipts: number;
  receiptCount: number;
  sales: number;
  saleCount: number;
  harvest: number;
  harvestCount: number;
};

export type InventoryFullDashboard = InventoryDashboard & {
  docs: DocRow[];
  monthly: MonthBucket[];
  totalReceipts: number;
  totalSales: number;
  totalHarvest: number;
  topBuyers: { name: string; total: number }[];
  topSuppliers: { name: string; total: number }[];
  /** Рухи номенклатури з датами — для клієнтського фільтра періоду */
  moves: ItemMove[];
};

/** Порожній дашборд — Склад відкривається одразу, дані дотягуються на місці. */
export function emptyInventoryDashboard(): InventoryFullDashboard {
  return {
    periodLabel: "",
    since: "",
    categories: INVENTORY_CATEGORIES.map((category) => {
      const meta = INVENTORY_CATEGORY_META[category];
      return {
        category,
        label: meta.label,
        description: meta.description,
        itemCount: 0,
        activeCount: 0,
        totalQty: 0,
        totalCost: 0,
        topUnit: null,
      };
    }),
    items: [],
    stockNote: "",
    docs: [],
    monthly: [],
    totalReceipts: 0,
    totalSales: 0,
    totalHarvest: 0,
    topBuyers: [],
    topSuppliers: [],
    moves: [],
  };
}

export type ItemMove = {
  itemId: string;
  date: string;
  qty: number;
  cost: number;
  kind: "purchase" | "harvest" | "sale";
  /** Ref_Key документа-реєстратора в BAS */
  docRefKey: string | null;
  docType: "receipt" | "sale" | "production" | null;
  docNumber: string | null;
  counterparty: string | null;
};

const UA_MONTHS = [
  "Січ", "Лют", "Бер", "Кві", "Тра", "Чер",
  "Лип", "Сер", "Вер", "Жов", "Лис", "Гру",
];

function monthLabel(ym: string): string {
  const [y, m] = ym.split("-");
  return `${UA_MONTHS[(Number(m) || 1) - 1]} ${y}`;
}

export function buildFullDashboard(input: {
  nomenclature: BasNomenclature[];
  units: BasUnit[];
  purchases: BasPurchaseMovement[];
  harvest: BasHarvestMovement[];
  saleMoves?: BasSaleMovement[];
  receipts: BasReceiptDoc[];
  sales: BasSaleDoc[];
  counterparties: BasCounterparty[];
  productionDocs?: { Ref_Key: string; Number: string | null }[];
  since?: string;
}): InventoryFullDashboard {
  const base = buildInventoryDashboard(input);

  const cpMap = new Map(
    input.counterparties.map((c) => [
      c.Ref_Key.toLowerCase(),
      c.Description?.trim() || "Невідомий",
    ])
  );

  const docs: DocRow[] = [
    ...input.receipts.map((r) => ({
      refKey: r.Ref_Key,
      number: r.Number?.replace(/^0+/, "") || "—",
      date: r.Date?.slice(0, 10) || "",
      amount: Number(r.СуммаДокумента) || 0,
      counterparty:
        cpMap.get((r.Контрагент_Key || "").toLowerCase()) || "Невідомий",
      type: "receipt" as const,
    })),
    ...input.sales.map((s) => ({
      refKey: s.Ref_Key,
      number: s.Number?.replace(/^0+/, "") || "—",
      date: s.Date?.slice(0, 10) || "",
      amount: Number(s.СуммаДокумента) || 0,
      counterparty:
        cpMap.get((s.Контрагент_Key || "").toLowerCase()) || "Невідомий",
      type: "sale" as const,
    })),
  ].sort((a, b) => b.date.localeCompare(a.date));

  // Monthly buckets
  const buckets = new Map<string, MonthBucket>();
  function getBucket(ym: string): MonthBucket {
    if (!buckets.has(ym))
      buckets.set(ym, {
        month: ym,
        label: monthLabel(ym),
        receipts: 0,
        receiptCount: 0,
        sales: 0,
        saleCount: 0,
        harvest: 0,
        harvestCount: 0,
      });
    return buckets.get(ym)!;
  }

  for (const r of input.receipts) {
    const ym = r.Date?.slice(0, 7);
    if (!ym) continue;
    const b = getBucket(ym);
    b.receipts += Number(r.СуммаДокумента) || 0;
    b.receiptCount += 1;
  }
  for (const s of input.sales) {
    const ym = s.Date?.slice(0, 7);
    if (!ym) continue;
    const b = getBucket(ym);
    b.sales += Number(s.СуммаДокумента) || 0;
    b.saleCount += 1;
  }
  for (const h of input.harvest) {
    const ym = h.Period?.slice(0, 7);
    if (!ym) continue;
    const b = getBucket(ym);
    b.harvest += Number(h.Сумма) || 0;
    b.harvestCount += 1;
  }

  const monthly = [...buckets.values()].sort((a, b) =>
    a.month.localeCompare(b.month)
  );

  // Top buyers / suppliers
  const buyerTotals = new Map<string, number>();
  for (const s of input.sales) {
    const name =
      cpMap.get((s.Контрагент_Key || "").toLowerCase()) || "Невідомий";
    buyerTotals.set(name, (buyerTotals.get(name) || 0) + (Number(s.СуммаДокумента) || 0));
  }
  const supplierTotals = new Map<string, number>();
  for (const r of input.receipts) {
    const name =
      cpMap.get((r.Контрагент_Key || "").toLowerCase()) || "Невідомий";
    supplierTotals.set(
      name,
      (supplierTotals.get(name) || 0) + (Number(r.СуммаДокумента) || 0)
    );
  }

  const topBuyers = [...buyerTotals.entries()]
    .map(([name, total]) => ({ name, total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 8);
  const topSuppliers = [...supplierTotals.entries()]
    .map(([name, total]) => ({ name, total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 8);

  const docNumberByKey = new Map(
    docs.map((d) => [d.refKey.toLowerCase(), d.number])
  );
  for (const p of input.productionDocs ?? []) {
    if (p.Ref_Key && p.Number) {
      docNumberByKey.set(p.Ref_Key.toLowerCase(), p.Number.trim());
    }
  }

  function parseRecorderType(
    raw: string | null | undefined
  ): ItemMove["docType"] {
    if (!raw) return null;
    if (raw.includes("ПоступлениеТоваровУслуг")) return "receipt";
    if (raw.includes("РеализацияТоваровУслуг")) return "sale";
    if (raw.includes("ОтчетПроизводства")) return "production";
    return null;
  }

  const itemIds = new Set(base.items.map((i) => i.id));
  const moves: ItemMove[] = [];
  for (const row of input.purchases) {
    const id = guidOf(row.Номенклатура);
    if (!id || !itemIds.has(id)) continue;
    const date = row.Period?.slice(0, 10);
    if (!date) continue;
    const docRefKey = normalizeBasRefKey(row.Recorder);
    const docType = parseRecorderType(row.Recorder_Type) ?? "receipt";
    moves.push({
      itemId: id,
      date,
      qty: Number(row.Количество) || 0,
      cost: Number(row.Стоимость) || 0,
      kind: "purchase",
      docRefKey,
      docType,
      docNumber: docRefKey
        ? docNumberByKey.get(docRefKey.toLowerCase()) ?? null
        : null,
      counterparty:
        cpMap.get((row.Контрагент_Key || "").toLowerCase()) || null,
    });
  }
  for (const row of input.harvest) {
    const id = guidOf(row.Номенклатура);
    if (!id || !itemIds.has(id)) continue;
    const date = row.Period?.slice(0, 10);
    if (!date) continue;
    const docRefKey = normalizeBasRefKey(row.Recorder);
    moves.push({
      itemId: id,
      date,
      qty: Number(row.Количество) || 0,
      cost: Number(row.Сумма) || 0,
      kind: "harvest",
      docRefKey,
      docType: parseRecorderType(row.Recorder_Type) ?? "production",
      docNumber: docRefKey
        ? docNumberByKey.get(docRefKey.toLowerCase()) ?? null
        : null,
      counterparty: null,
    });
  }
  for (const row of input.saleMoves ?? []) {
    const id = guidOf(row.Номенклатура);
    if (!id || !itemIds.has(id)) continue;
    const date = row.Period?.slice(0, 10);
    if (!date) continue;
    const docRefKey = normalizeBasRefKey(row.Recorder);
    moves.push({
      itemId: id,
      date,
      qty: Number(row.Количество) || 0,
      cost: Number(row.Стоимость) || 0,
      kind: "sale",
      docRefKey,
      docType: parseRecorderType(row.Recorder_Type) ?? "sale",
      docNumber: docRefKey
        ? docNumberByKey.get(docRefKey.toLowerCase()) ?? null
        : null,
      counterparty:
        cpMap.get((row.Контрагент_Key || "").toLowerCase()) || null,
    });
  }

  moves.sort((a, b) => b.date.localeCompare(a.date) || b.cost - a.cost);

  const docsByItem = new Map<string, Set<string>>();
  for (const m of moves) {
    const set = docsByItem.get(m.itemId) ?? new Set<string>();
    set.add(m.docRefKey || `${m.date}:${m.kind}:${m.qty}:${m.cost}`);
    docsByItem.set(m.itemId, set);
  }

  const netByItem = new Map<
    string,
    {
      qtyIn: number;
      qtyOut: number;
      costIn: number;
      costOut: number;
      last: string | null;
    }
  >();
  for (const m of moves) {
    const cur = netByItem.get(m.itemId) ?? {
      qtyIn: 0,
      qtyOut: 0,
      costIn: 0,
      costOut: 0,
      last: null,
    };
    if (m.kind === "sale") {
      cur.qtyOut += m.qty;
      cur.costOut += m.cost;
    } else {
      cur.qtyIn += m.qty;
      cur.costIn += m.cost;
    }
    if (!cur.last || m.date > cur.last) cur.last = m.date;
    netByItem.set(m.itemId, cur);
  }

  const itemsWithDocCount = base.items.map((item) => {
    const net = netByItem.get(item.id);
    const qtyIn = round2(net?.qtyIn ?? 0);
    const qtyOut = round2(net?.qtyOut ?? 0);
    const costIn = Math.round(net?.costIn ?? 0);
    const costOut = Math.round(net?.costOut ?? 0);
    return {
      ...item,
      qtyIn,
      qtyOut,
      costIn,
      costOut,
      cost: costIn + costOut,
      moveCount: docsByItem.get(item.id)?.size ?? 0,
      lastDate: net?.last ?? null,
    };
  });

  return {
    ...base,
    items: itemsWithDocCount,
    stockNote:
      "Залишки ТоварыНаСкладах через OData порожні. Показуємо окремо випуск/надходження і продажі (у BAS часто різні номенклатури).",
    categories: INVENTORY_CATEGORIES.map((cat) =>
      summarizeCategory(
        cat,
        itemsWithDocCount.filter((i) => i.category === cat)
      )
    ),
    docs,
    monthly,
    totalReceipts: Math.round(
      input.receipts.reduce((s, r) => s + (Number(r.СуммаДокумента) || 0), 0)
    ),
    totalSales: Math.round(
      input.sales.reduce((s, r) => s + (Number(r.СуммаДокумента) || 0), 0)
    ),
    totalHarvest: Math.round(
      input.harvest.reduce((s, h) => s + (Number(h.Сумма) || 0), 0)
    ),
    topBuyers,
    topSuppliers,
    moves,
  };
}

/** Клієнтський фільтр дашборду за ISO-датами (YYYY-MM-DD). */
export function filterDashboardByRange(
  full: InventoryFullDashboard,
  startIso: string,
  endIso: string
): InventoryFullDashboard {
  const docs = full.docs.filter(
    (d) => d.date >= startIso && d.date <= endIso
  );
  const moves = full.moves.filter(
    (m) => m.date >= startIso && m.date <= endIso
  );

  const agg = new Map<
    string,
    {
      qtyIn: number;
      qtyOut: number;
      costIn: number;
      costOut: number;
      docs: Set<string>;
      last: string | null;
    }
  >();
  for (const m of moves) {
    const cur = agg.get(m.itemId) ?? {
      qtyIn: 0,
      qtyOut: 0,
      costIn: 0,
      costOut: 0,
      docs: new Set<string>(),
      last: null,
    };
    if (m.kind === "sale") {
      cur.qtyOut += m.qty;
      cur.costOut += m.cost;
    } else {
      cur.qtyIn += m.qty;
      cur.costIn += m.cost;
    }
    cur.docs.add(m.docRefKey || `${m.date}:${m.kind}:${m.qty}:${m.cost}`);
    if (!cur.last || m.date > cur.last) cur.last = m.date;
    agg.set(m.itemId, cur);
  }

  const items = full.items
    .map((item) => {
      const m = agg.get(item.id);
      const qtyIn = round2(m?.qtyIn ?? 0);
      const qtyOut = round2(m?.qtyOut ?? 0);
      const costIn = Math.round(m?.costIn ?? 0);
      const costOut = Math.round(m?.costOut ?? 0);
      return {
        ...item,
        qtyIn,
        qtyOut,
        costIn,
        costOut,
        cost: costIn + costOut,
        moveCount: m?.docs.size ?? 0,
        lastDate: m?.last ?? null,
      };
    })
    .sort(
      (a, b) =>
        b.cost - a.cost ||
        b.qtyIn + b.qtyOut - (a.qtyIn + a.qtyOut) ||
        a.name.localeCompare(b.name, "uk")
    );

  const categories: InventoryCategorySummary[] = INVENTORY_CATEGORIES.map(
    (cat) =>
      summarizeCategory(
        cat,
        items.filter((i) => i.category === cat)
      )
  );

  const buckets = new Map<string, MonthBucket>();
  function getBucket(ym: string): MonthBucket {
    if (!buckets.has(ym))
      buckets.set(ym, {
        month: ym,
        label: monthLabel(ym),
        receipts: 0,
        receiptCount: 0,
        sales: 0,
        saleCount: 0,
        harvest: 0,
        harvestCount: 0,
      });
    return buckets.get(ym)!;
  }

  for (const d of docs) {
    const ym = d.date.slice(0, 7);
    if (!ym) continue;
    const b = getBucket(ym);
    if (d.type === "receipt") {
      b.receipts += d.amount;
      b.receiptCount += 1;
    } else {
      b.sales += d.amount;
      b.saleCount += 1;
    }
  }

  const harvestIds = new Set(
    full.items.filter((i) => i.category === "harvest").map((i) => i.id)
  );
  for (const m of moves) {
    if (!harvestIds.has(m.itemId)) continue;
    const ym = m.date.slice(0, 7);
    const b = getBucket(ym);
    b.harvest += m.cost;
    b.harvestCount += 1;
  }

  const monthly = [...buckets.values()].sort((a, b) =>
    a.month.localeCompare(b.month)
  );

  const buyerTotals = new Map<string, number>();
  const supplierTotals = new Map<string, number>();
  for (const d of docs) {
    if (d.type === "sale") {
      buyerTotals.set(d.counterparty, (buyerTotals.get(d.counterparty) || 0) + d.amount);
    } else {
      supplierTotals.set(
        d.counterparty,
        (supplierTotals.get(d.counterparty) || 0) + d.amount
      );
    }
  }

  const totalHarvest = Math.round(
    moves
      .filter((m) => harvestIds.has(m.itemId))
      .reduce((s, m) => s + m.cost, 0)
  );

  return {
    ...full,
    periodLabel: `${startIso.slice(0, 10)} — ${endIso.slice(0, 10)}`,
    since: startIso,
    categories,
    items,
    docs,
    monthly,
    moves,
    totalReceipts: Math.round(
      docs.filter((d) => d.type === "receipt").reduce((s, d) => s + d.amount, 0)
    ),
    totalSales: Math.round(
      docs.filter((d) => d.type === "sale").reduce((s, d) => s + d.amount, 0)
    ),
    totalHarvest,
    topBuyers: [...buyerTotals.entries()]
      .map(([name, total]) => ({ name, total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 8),
    topSuppliers: [...supplierTotals.entries()]
      .map(([name, total]) => ({ name, total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 8),
  };
}

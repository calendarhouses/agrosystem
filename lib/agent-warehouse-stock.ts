/**
 * Віртуальний залишок ТМЦ для LEVADIUS:
 * BAS (qtyIn − qtyOut) + локальні draft-рухи (як на /inventory і в адмінці).
 */

import { loadInventoryDashboard } from "@/lib/inventory-dashboard-load";
import { createServiceSupabase } from "@/lib/supabase/server";

export type AgentInventoryStockLine = {
  kind: "inventory";
  ref: string;
  name: string;
  categoryKey: string;
  category: string;
  unit: string;
  quantity: number;
};

type DraftMoveMaps = {
  inboundByRef: Record<string, number>;
  outboundByRef: Record<string, number>;
};

const CATEGORY_LABELS: Record<string, string> = {
  zzr: "ЗЗР",
  fertilizer: "Добрива",
  seed: "Насіння",
  fuel: "Паливо",
  harvest: "Врожай",
  parts: "Запчастини",
};

async function loadDraftLocalMoves(): Promise<
  DraftMoveMaps | { error: string }
> {
  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from("inventory_local_moves")
    .select("item_ref_key, type, qty, status")
    .eq("status", "draft")
    .limit(20_000);

  if (error) {
    if (error.code === "PGRST205" || error.code === "42P01") {
      return { inboundByRef: {}, outboundByRef: {} };
    }
    return { error: error.message };
  }

  const inboundByRef: Record<string, number> = {};
  const outboundByRef: Record<string, number> = {};
  for (const row of data ?? []) {
    const key = String(row.item_ref_key ?? "")
      .trim()
      .toLowerCase();
    if (!key) continue;
    const qty = Number(row.qty) || 0;
    const type = String(row.type ?? "");
    if (type === "inbound") {
      inboundByRef[key] = (inboundByRef[key] ?? 0) + qty;
    } else if (type === "outbound" || type === "sale") {
      outboundByRef[key] = (outboundByRef[key] ?? 0) + qty;
    }
  }
  return { inboundByRef, outboundByRef };
}

export async function loadAgentInventoryStock(options?: {
  categoryKey?: string;
  includeZero?: boolean;
  limit?: number;
}): Promise<{
  items: AgentInventoryStockLine[];
  basOk: boolean;
  error?: string;
  dataQualityNote: string;
}> {
  const categoryKey = options?.categoryKey;
  const includeZero = options?.includeZero === true;
  const limit = options?.limit ?? 80;

  const supabase = createServiceSupabase();
  let itemsQuery = supabase
    .from("inventory_items_cache")
    .select("bas_ref_key, name, custom_name, category, unit, is_hidden")
    .order("name")
    .limit(3_000);

  if (categoryKey) {
    itemsQuery = itemsQuery.eq("category", categoryKey);
  }

  const [itemsResult, movesResult, basResult] = await Promise.all([
    itemsQuery,
    loadDraftLocalMoves(),
    loadInventoryDashboard()
      .then((dashboard) => ({ ok: true as const, dashboard }))
      .catch((error: unknown) => ({
        ok: false as const,
        error: error instanceof Error ? error.message : "BAS stock failed",
      })),
  ]);

  if (itemsResult.error) {
    return {
      items: [],
      basOk: false,
      error: `Не вдалося прочитати номенклатуру: ${itemsResult.error.message}`,
      dataQualityNote: "",
    };
  }
  if ("error" in movesResult) {
    return {
      items: [],
      basOk: false,
      error: `Не вдалося прочитати локальні рухи: ${movesResult.error}`,
      dataQualityNote: "",
    };
  }

  const basIn: Record<string, number> = {};
  const basOut: Record<string, number> = {};
  let basOk = false;
  if (basResult.ok) {
    basOk = true;
    for (const item of basResult.dashboard.items) {
      const key = String(item.id ?? "")
        .trim()
        .toLowerCase();
      if (!key) continue;
      basIn[key] = Number(item.qtyIn) || 0;
      basOut[key] = Number(item.qtyOut) || 0;
    }
  }

  const items = (itemsResult.data ?? []).filter(
    (item) => item.is_hidden !== true
  );

  const lines: AgentInventoryStockLine[] = items
    .map((item) => {
      const ref = String(item.bas_ref_key).toLowerCase();
      const qtyIn =
        (basIn[ref] ?? 0) + (movesResult.inboundByRef[ref] ?? 0);
      const qtyOut =
        (basOut[ref] ?? 0) + (movesResult.outboundByRef[ref] ?? 0);
      const quantity = Math.round((qtyIn - qtyOut) * 1_000) / 1_000;
      const catKey = String(item.category ?? "");
      return {
        kind: "inventory" as const,
        ref: String(item.bas_ref_key),
        name:
          (typeof item.custom_name === "string" && item.custom_name.trim()) ||
          String(item.name ?? "ТМЦ"),
        categoryKey: catKey,
        category: CATEGORY_LABELS[catKey] ?? catKey,
        unit: String(item.unit ?? "").trim() || "од.",
        quantity,
      };
    })
    .filter((item) => (includeZero ? true : item.quantity > 0.0005))
    .sort(
      (a, b) =>
        b.quantity - a.quantity ||
        a.name.localeCompare(b.name, "uk")
    )
    .slice(0, limit);

  return {
    items: lines,
    basOk,
    dataQualityNote: basOk
      ? "ТМЦ: віртуальний залишок = BAS (прихід−витрата) + локальні draft-рухи Supabase."
      : "ТМЦ: лише локальні draft-рухи (BAS тимчасово недоступний). Паливо окремо з fuel_storages.",
  };
}

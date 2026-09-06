/**
 * Секційні брифінги диспетчера (LIVE-стрічка).
 * Без LLM — короткі живі фрази; якщо нічого цікавого — skip (не показуємо шум).
 */

import "server-only";

import { listAgentAccountantQueue } from "@/lib/agent-accountant-ops";
import { getAgentCompanyFinancialOverview } from "@/lib/agent-company-finance";
import { loadAgentInventoryStock } from "@/lib/agent-warehouse-stock";
import {
  SECTION_IDS,
  type SectionId,
} from "@/lib/agent-section-briefing-shared";
import { fetchCompanyFinancialOverview } from "@/lib/company-finance";
import { findUnrecordedRefuelings } from "@/lib/fuel-unrecorded-refuelings";
import { todayKyivYmd } from "@/lib/kyiv-date";
import { createServiceSupabase } from "@/lib/supabase/server";

export type { SectionId };
export { SECTION_IDS, pathnameToSection } from "@/lib/agent-section-briefing-shared";

export type SectionBriefing = {
  ok: true;
  section: SectionId;
  /** true = нема сенсу показувати стрічку */
  skip: boolean;
  text: string;
  followUpPrompt: string;
  generatedAt: string;
  cached: boolean;
  facts: Record<string, number | string | boolean | null>;
};

type BuiltBrief = {
  skip: boolean;
  text: string;
  followUpPrompt: string;
  facts: Record<string, number | string | boolean | null>;
};

const CACHE_TTL_MS = 150_000;
const cache = new Map<
  string,
  { expiresAt: number; payload: Omit<SectionBriefing, "cached"> }
>();

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function isSectionId(value: string): value is SectionId {
  return (SECTION_IDS as readonly string[]).includes(value);
}

function quiet(facts: BuiltBrief["facts"]): BuiltBrief {
  return {
    skip: true,
    text: "",
    followUpPrompt: "",
    facts,
  };
}

async function briefFields(): Promise<BuiltBrief> {
  const supabase = createServiceSupabase();
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();

  const [opsRes, ndviRes] = await Promise.all([
    supabase
      .from("field_operations")
      .select("id", { count: "exact", head: true })
      .in("status", ["in_progress", "assigned"]),
    supabase
      .from("field_ndvi_alerts")
      .select("id, severity, created_at")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(30),
  ]);

  const openOps = opsRes.count ?? 0;
  const ndviRows = ndviRes.error ? [] : ndviRes.data ?? [];
  const criticalNdvi = ndviRows.filter((r) => {
    const s = String(r.severity ?? "").toLowerCase();
    return s === "critical" || s === "high" || s === "danger" || s === "alert";
  }).length;

  const facts = { openOps, criticalNdvi, ndviAlerts: ndviRows.length };
  // Тиша, якщо немає критичного NDVI і мало/нема робіт
  if (criticalNdvi === 0 && openOps === 0) return quiet(facts);
  if (criticalNdvi === 0 && openOps < 3) return quiet(facts);

  if (criticalNdvi > 0 && openOps > 0) {
    return {
      skip: false,
      text: `Дивись: на полях ${openOps} роботи в ході, плюс ${criticalNdvi} жорстких NDVI за добу — варто глянути.`,
      followUpPrompt: "Покажи критичні NDVI і відкриті роботи на полях",
      facts,
    };
  }
  if (criticalNdvi > 0) {
    return {
      skip: false,
      text: `Є нюанс по NDVI: ${criticalNdvi} критичних за добу. Підкажи, відкриваємо карту?`,
      followUpPrompt: "Покажи критичні NDVI на полях",
      facts,
    };
  }
  return {
    skip: false,
    text: `На полях зараз ${openOps} відкритих робіт — якщо треба пріоритет, скажи.`,
    followUpPrompt: "Статус полів і відкриті роботи",
    facts,
  };
}

async function briefEquipment(): Promise<BuiltBrief> {
  const supabase = createServiceSupabase();
  const today = todayKyivYmd();

  const [inField, maint, idle] = await Promise.all([
    supabase
      .from("field_operations")
      .select("id", { count: "exact", head: true })
      .eq("status", "in_progress")
      .not("equipment_id", "is", null),
    supabase
      .from("equipment")
      .select(
        "id, name, current_motohours, next_service_motohours, maintenance_status, is_active"
      )
      .eq("is_active", true)
      .limit(200),
    supabase
      .from("wialon_equipment_day_stats")
      .select("equipment_id, hours_idling, work_hours")
      .eq("date", today)
      .limit(200),
  ]);

  const machines = inField.count ?? 0;
  const due = new Set<string>();
  for (const row of maint.error ? [] : maint.data ?? []) {
    const id = String(row.id);
    const cur = Number(row.current_motohours);
    const next = Number(row.next_service_motohours);
    if (
      Number.isFinite(cur) &&
      Number.isFinite(next) &&
      next - cur <= 20 &&
      next - cur >= 0
    ) {
      due.add(id);
    }
    if (String(row.maintenance_status ?? "") === "due") due.add(id);
  }

  let idleAnomalies = 0;
  for (const row of idle.error ? [] : idle.data ?? []) {
    const idling = Number(row.hours_idling);
    const work = Number(row.work_hours);
    if (idling >= 2 && (work < 0.5 || idling > work * 1.5)) idleAnomalies += 1;
  }

  const dueSoon = due.size;
  const facts = { machines, dueSoon, idleAnomalies };
  // Показуємо лише якщо є ТО/простої — «просто N у полі» без ризику = шум
  if (dueSoon === 0 && idleAnomalies === 0) {
    return quiet(facts);
  }

  const bits: string[] = [];
  if (machines > 0) bits.push(`${machines} у полі`);
  if (dueSoon > 0) bits.push(`ТО близько в ${dueSoon}`);
  if (idleAnomalies > 0) bits.push(`дивні простої: ${idleAnomalies}`);
  return {
    skip: false,
    text: `По парку: ${bits.join(", ")}. Давай розберемо?`,
    followUpPrompt: "Хто в полі, простої та наближення ТО",
    facts,
  };
}

async function briefFuel(): Promise<BuiltBrief> {
  const supabase = createServiceSupabase();
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();

  const [storages, burns, radar] = await Promise.all([
    supabase
      .from("fuel_storages")
      .select("id, name, current_volume, capacity, is_active")
      .limit(50),
    supabase
      .from("fuel_transactions")
      .select("amount_liters, transaction_type, transaction_date")
      .gte("transaction_date", since)
      .limit(500),
    findUnrecordedRefuelings({ lookbackHours: 24 }).catch(() => []),
  ]);

  let stockL = 0;
  let lowTanks = 0;
  for (const s of storages.error ? [] : storages.data ?? []) {
    if (s.is_active === false) continue;
    const v = Number(s.current_volume) || 0;
    stockL += v;
    const cap = Number(s.capacity) || 0;
    if (cap > 0 && v / cap < 0.15) lowTanks += 1;
  }

  let burned = 0;
  for (const t of burns.error ? [] : burns.data ?? []) {
    if (String(t.transaction_type) === "outbound") {
      burned += Math.abs(Number(t.amount_liters) || 0);
    }
  }

  const radarN = radar.length;
  const facts = {
    stockL: Math.round(stockL),
    burned: Math.round(burned),
    radarN,
    lowTanks,
  };

  if (radarN === 0 && lowTanks === 0) return quiet(facts);

  if (radarN > 0 && lowTanks > 0) {
    return {
      skip: false,
      text: `Є нюанс по солярці: ${radarN} підозри повз облік і ${lowTanks} ємності майже сухі.`,
      followUpPrompt: "Покажи підозри на заправку повз облік і низькі ємності",
      facts,
    };
  }
  if (radarN > 0) {
    return {
      skip: false,
      text: `Дивись, яка історія: датчик зловив ${radarN} доливання без запису. Розберемо?`,
      followUpPrompt: "Покажи підозри на заправку повз облік",
      facts,
    };
  }
  return {
    skip: false,
    text: `На ємностях тісно: ${lowTanks} уже <15%. Краще не чекати вечора.`,
    followUpPrompt: "Покажи ємності з низьким залишком палива",
    facts,
  };
}

async function briefInventory(): Promise<BuiltBrief> {
  const supabase = createServiceSupabase();
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();

  const [moves, stock] = await Promise.all([
    supabase
      .from("inventory_local_moves")
      .select("id, type, qty, status, created_at, is_reverted")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(80),
    loadAgentInventoryStock({ includeZero: true }).catch(() => ({
      items: [] as Array<{ quantity: number; categoryKey: string }>,
      basOk: false,
      dataQualityNote: "",
    })),
  ]);

  let inbound = 0;
  let sales = 0;
  for (const m of moves.error ? [] : moves.data ?? []) {
    if (m.is_reverted === true) continue;
    const type = String(m.type ?? "");
    if (type === "inbound" || type === "receipt") inbound += 1;
    if (type === "sale") sales += 1;
  }

  const lines = Array.isArray(stock.items) ? stock.items : [];
  let critical = 0;
  for (const line of lines) {
    const cat = String(line.categoryKey ?? "").toLowerCase();
    const qty = Number(line.quantity);
    if (!Number.isFinite(qty)) continue;
    if (
      (cat === "zzr" || cat === "seed" || cat === "fertilizer") &&
      qty > 0 &&
      qty < 5
    ) {
      critical += 1;
    }
  }

  const facts = { critical, inbound, sales };
  if (critical === 0 && inbound === 0 && sales === 0) return quiet(facts);

  if (critical > 0) {
    return {
      skip: false,
      text: `На складі ${critical} позицій уже на мінімумі — краще не проґавити.`,
      followUpPrompt: "Які ТМЦ на мінімумі",
      facts,
    };
  }
  if (sales > 0) {
    return {
      skip: false,
      text: `За добу пішло ${sales} продажів зерна${inbound > 0 ? ` і ${inbound} приходів` : ""}. Можу розкласти.`,
      followUpPrompt: "Останні рухи складу за добу",
      facts,
    };
  }
  return {
    skip: false,
    text: `Сьогодні ${inbound} приходів на склад — якщо треба, пройдемось разом.`,
    followUpPrompt: "Останні приходи на склад",
    facts,
  };
}

async function briefOperations(): Promise<BuiltBrief> {
  const supabase = createServiceSupabase();
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();

  const [active, completed] = await Promise.all([
    supabase
      .from("field_operations")
      .select("id", { count: "exact", head: true })
      .in("status", ["in_progress", "assigned", "planned"]),
    supabase
      .from("field_operations")
      .select("id, fuel_fact, area_fact, fuel_plan, area_plan")
      .eq("status", "completed")
      .gte("updated_at", since)
      .limit(40),
  ]);

  const activeN = active.count ?? 0;
  let fuelOveruse = 0;
  for (const row of completed.error ? [] : completed.data ?? []) {
    const fact = Number(row.fuel_fact);
    const plan = Number(row.fuel_plan);
    if (
      Number.isFinite(fact) &&
      Number.isFinite(plan) &&
      plan > 0 &&
      fact > plan * 1.2
    ) {
      fuelOveruse += 1;
    }
  }

  const facts = { activeN, fuelOveruse };
  // Без аномалій і без активних — тиша; лише активні теж не спамимо
  if (fuelOveruse === 0) return quiet(facts);

  return {
    skip: false,
    text: `Є нюанс: ${fuelOveruse} закритих нарядів спалили >20% над планом. Подивимось?`,
    followUpPrompt: "Покажи наряди з перевищенням палива",
    facts,
  };
}

async function briefAccounting(): Promise<BuiltBrief> {
  const queue = await listAgentAccountantQueue({
    status: "new",
    limit: 80,
  });

  if (!queue.ok) {
    return quiet({ count: 0, sum: 0 });
  }

  const count = queue.count;
  const sum = Math.round(queue.totalSumUah);
  if (count === 0) return quiet({ count, sum });

  return {
    skip: false,
    text: `У черзі на 1С висить ${count} док. ≈ ${sum.toLocaleString("uk-UA")} ₴ — не загубимо.`,
    followUpPrompt: "Що висить у черзі бухгалтерії на вивантаження",
    facts: { count, sum },
  };
}

async function briefFinance(): Promise<BuiltBrief> {
  const overview = await getAgentCompanyFinancialOverview({
    period: "full_season",
  });
  const full = await fetchCompanyFinancialOverview(String(overview.season));
  const burnPct = full.globalBurnRate;
  const costHa = overview.costPerHectareUah;
  const facts = {
    burnPct: burnPct ?? null,
    costHa: costHa ?? null,
    expenses: overview.totalExpensesUah,
  };

  // Показуємо лише якщо burn високий або є що сказати по собівартості з burn
  if (burnPct == null || burnPct < 70) return quiet(facts);

  return {
    skip: false,
    text: `По грошах: бюджет уже на ${round1(burnPct)}%${
      costHa != null
        ? `, собівартість ≈ ${costHa.toLocaleString("uk-UA")} ₴/га`
        : ""
    }. Хочеш розклад?`,
    followUpPrompt: "Фінансова картина господарства за сезон",
    facts,
  };
}

async function buildSection(section: SectionId): Promise<BuiltBrief> {
  switch (section) {
    case "fields":
      return briefFields();
    case "equipment":
      return briefEquipment();
    case "fuel":
      return briefFuel();
    case "inventory":
      return briefInventory();
    case "operations":
      return briefOperations();
    case "accounting":
      return briefAccounting();
    case "finance":
      return briefFinance();
  }
}

export async function getSectionBriefing(
  sectionRaw: string
): Promise<SectionBriefing | { ok: false; error: string }> {
  if (!isSectionId(sectionRaw)) {
    return {
      ok: false,
      error: `Невідома секція. Дозволено: ${SECTION_IDS.join(", ")}`,
    };
  }

  const hit = cache.get(sectionRaw);
  if (hit && hit.expiresAt > Date.now()) {
    return { ...hit.payload, cached: true };
  }

  try {
    const built = await buildSection(sectionRaw);
    const payload: Omit<SectionBriefing, "cached"> = {
      ok: true,
      section: sectionRaw,
      skip: built.skip,
      text: built.text,
      followUpPrompt: built.followUpPrompt,
      generatedAt: new Date().toISOString(),
      facts: built.facts,
    };
    cache.set(sectionRaw, {
      expiresAt: Date.now() + CACHE_TTL_MS,
      payload,
    });
    return { ...payload, cached: false };
  } catch (error) {
    console.error(
      "[section-briefing]",
      sectionRaw,
      error instanceof Error ? error.message : error
    );
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Не вдалося зібрати секційний бриф",
    };
  }
}

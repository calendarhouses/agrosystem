/**
 * Секційні брифінги диспетчера (Contextual Voice Capsule).
 * Без LLM — шаблони з живими цифрами + in-memory cache 2.5 хв.
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
  text: string;
  followUpPrompt: string;
  generatedAt: string;
  cached: boolean;
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

async function briefFields() {
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
    return (
      s === "critical" ||
      s === "high" ||
      s === "danger" ||
      s === "alert"
    );
  }).length;

  const parts: string[] = [
    openOps > 0
      ? `На полях ${openOps} відкритих робіт.`
      : "Відкритих робіт на полях немає.",
  ];
  if (criticalNdvi > 0) {
    parts.push(`NDVI-тривоги за добу: ${criticalNdvi} критичних.`);
  } else {
    parts.push(
      ndviRows.length > 0
        ? `NDVI за добу: ${ndviRows.length} сповіщень без критичних.`
        : "Критичних NDVI за добу немає."
    );
  }

  return {
    text: parts.join(" "),
    followUpPrompt:
      criticalNdvi > 0
        ? "Покажи критичні NDVI і відкриті роботи на полях"
        : "Статус полів і відкриті роботи",
    facts: {
      openOps,
      criticalNdvi,
      ndviAlerts: ndviRows.length,
    },
  };
}

async function briefEquipment() {
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
  const parts: string[] = [
    machines > 0
      ? `У полі ${machines} одиниць техніки.`
      : "Техніки в активних нарядах зараз немає.",
  ];
  if (dueSoon > 0) parts.push(`ТО ближче 20 м/г: ${dueSoon}.`);
  if (idleAnomalies > 0) {
    parts.push(`Аномальні простої сьогодні: ${idleAnomalies}.`);
  }
  if (dueSoon === 0 && idleAnomalies === 0) {
    parts.push("По ТО і простоях відхилень немає.");
  }

  return {
    text: parts.join(" "),
    followUpPrompt:
      dueSoon > 0 || idleAnomalies > 0
        ? "Хто в полі, простої та наближення ТО"
        : "Зведення парку за сьогодні",
    facts: { machines, dueSoon, idleAnomalies },
  };
}

async function briefFuel() {
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
  const parts: string[] = [
    `На ємностях ${Math.round(stockL).toLocaleString("uk-UA")} л.`,
  ];
  if (burned > 0) {
    parts.push(
      `Витрата за добу ≈ ${Math.round(burned).toLocaleString("uk-UA")} л.`
    );
  }
  if (radarN > 0) {
    parts.push(`Підозри на заправку повз облік: ${radarN}.`);
  } else {
    parts.push("Непідтверджених заправок у радарі немає.");
  }
  if (lowTanks > 0) parts.push(`Ємностей <15%: ${lowTanks}.`);

  return {
    text: parts.join(" "),
    followUpPrompt:
      radarN > 0
        ? "Покажи невраховані заправки в радарі DUT"
        : "Залишки палива та витрата за добу",
    facts: {
      stockL: Math.round(stockL),
      burned: Math.round(burned),
      radarN,
      lowTanks,
    },
  };
}

async function briefInventory() {
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

  const parts: string[] = [
    critical > 0
      ? `Низькі залишки (ЗЗР/насіння/добрива <5 од.): ${critical}.`
      : "Критичних мінімумів по ключових ТМЦ не видно.",
    `За добу: приходів ${inbound}, продажів зерна ${sales}.`,
  ];

  return {
    text: parts.join(" "),
    followUpPrompt:
      critical > 0
        ? "Які ТМЦ на мінімумі і що рухалось на складі за добу"
        : "Залишки складу та останні рухи за добу",
    facts: { critical, inbound, sales },
  };
}

async function briefOperations() {
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
    if (Number.isFinite(fact) && Number.isFinite(plan) && plan > 0 && fact > plan * 1.2) {
      fuelOveruse += 1;
    }
  }

  const parts: string[] = [
    activeN > 0
      ? `Активних нарядів: ${activeN}.`
      : "Активних нарядів зараз немає.",
  ];
  if (fuelOveruse > 0) {
    parts.push(
      `За добу ${fuelOveruse} закритих з перевищенням палива >20% плану.`
    );
  } else {
    parts.push("Аномалій витрати палива по закритих за добу немає.");
  }

  return {
    text: parts.join(" "),
    followUpPrompt:
      fuelOveruse > 0
        ? "Покажи наряди з перевищенням палива та активні роботи"
        : "Активні наряди та підсумок дня",
    facts: { activeN, fuelOveruse },
  };
}

async function briefAccounting() {
  const queue = await listAgentAccountantQueue({
    status: "new",
    limit: 80,
  });

  if (!queue.ok) {
    return {
      text: "Чергу бухгалтерії зараз не вдалося прочитати.",
      followUpPrompt: "Що висить у черзі бухгалтерії",
      facts: { count: 0, sum: 0 },
    };
  }

  const count = queue.count;
  const sum = Math.round(queue.totalSumUah);
  const text =
    count > 0
      ? `У черзі на 1С ${count} непереданих документів на ≈ ${sum.toLocaleString("uk-UA")} ₴.`
      : "Черга на 1С порожня — непереданих документів немає.";

  return {
    text,
    followUpPrompt: "Що висить у черзі бухгалтерії на вивантаження",
    facts: { count, sum },
  };
}

async function briefFinance() {
  const overview = await getAgentCompanyFinancialOverview({
    period: "full_season",
  });
  const full = await fetchCompanyFinancialOverview(String(overview.season));
  const burnPct = full.globalBurnRate;
  const costHa = overview.costPerHectareUah;

  const parts: string[] = [];
  if (burnPct != null) {
    parts.push(`Освоєння бюджету ${round1(burnPct)}%.`);
  } else {
    parts.push(
      "Плановий бюджет по полях ще не заданий — % освоєння недоступний."
    );
  }
  if (costHa != null) {
    parts.push(
      `Середня собівартість ${costHa.toLocaleString("uk-UA")} ₴/га.`
    );
  }

  return {
    text: parts.join(" ") || "Фінансових цифр за сезон ще недостатньо.",
    followUpPrompt: "Фінансова картина господарства за сезон",
    facts: {
      burnPct: burnPct ?? null,
      costHa: costHa ?? null,
      expenses: overview.totalExpensesUah,
    },
  };
}

async function buildSection(section: SectionId) {
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

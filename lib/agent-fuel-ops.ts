/**
 * Операції палива для LEVADIUS-агента (inbound / transfer / CRUD / KPI / radar).
 * Типи в БД: inbound | transfer | outbound (не purchase/dispense).
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { logActivity } from "@/lib/activity-log";
import { actorCreateColumns, getCurrentActor } from "@/lib/app-actor";
import { normalizeBasRefKey } from "@/lib/bas-mapping";
import { enqueueFuelBasDraft } from "@/lib/fuel-bas-sync";
import {
  confirmRadarRefuelEvent,
  dismissRadarRefuelEvent,
} from "@/lib/fuel-radar-confirm";
import { resolveDieselPriceUah } from "@/lib/fuel-price";
import {
  findUnrecordedRefuelings,
  UNRECORDED_LOOKBACK_HOURS,
} from "@/lib/fuel-unrecorded-refuelings";
import {
  computeTotalCost,
  computeWeightedAveragePrice,
  roundLiters,
  roundPrice,
} from "@/lib/fuel-wac";
import { resolveFieldFuelPeriodBounds } from "@/lib/wialon-field-fuel-sync";
import { createServiceSupabase } from "@/lib/supabase/server";

export type FuelStorageRow = {
  id: string;
  name: string;
  type: string | null;
  capacity: number;
  current_volume: number;
  price_per_liter: number;
  bas_ref_key?: string | null;
};

export type ResolveStorageResult =
  | { ok: true; storage: FuelStorageRow }
  | {
      ok: false;
      status: "not_found" | "ambiguous" | "needs_slots" | "error";
      error: string;
      candidates?: { id: string; name: string; volume: number }[];
    };

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

function fillPct(volume: number, capacity: number): number {
  if (!(capacity > 0)) return 0;
  return Math.round(Math.min(100, Math.max(0, (volume / capacity) * 100)) * 10) / 10;
}

export async function resolveFuelStorageByLookup(
  supabase: SupabaseClient,
  lookupRaw: string
): Promise<ResolveStorageResult> {
  const lookup = lookupRaw.trim();
  if (!lookup) {
    return {
      ok: false,
      status: "needs_slots",
      error: "Вкажи назву або ID ємності.",
    };
  }

  if (isUuid(lookup)) {
    const { data, error } = await supabase
      .from("fuel_storages")
      .select("id, name, type, capacity, current_volume, price_per_liter, bas_ref_key")
      .eq("id", lookup)
      .maybeSingle();
    if (error) {
      return { ok: false, status: "error", error: error.message };
    }
    if (!data) {
      return {
        ok: false,
        status: "not_found",
        error: `Ємність «${lookup}» не знайдена.`,
      };
    }
    return { ok: true, storage: data as FuelStorageRow };
  }

  const safe = lookup.replaceAll(",", " ");
  const { data, error } = await supabase
    .from("fuel_storages")
    .select("id, name, type, capacity, current_volume, price_per_liter, bas_ref_key")
    .ilike("name", `%${safe}%`)
    .order("name")
    .limit(5);

  if (error) {
    return { ok: false, status: "error", error: error.message };
  }

  const rows = (data ?? []) as FuelStorageRow[];
  if (rows.length === 0) {
    return {
      ok: false,
      status: "not_found",
      error: `Ємність «${lookup}» не знайдена.`,
    };
  }
  if (rows.length > 1) {
    const exact = rows.find(
      (r) => r.name.trim().toLowerCase() === safe.toLowerCase()
    );
    if (exact) return { ok: true, storage: exact };
    return {
      ok: false,
      status: "ambiguous",
      error: `Знайдено кілька ємностей для «${lookup}». Уточни назву.`,
      candidates: rows.map((r) => ({
        id: r.id,
        name: r.name,
        volume: roundLiters(Number(r.current_volume) || 0),
      })),
    };
  }
  return { ok: true, storage: rows[0]! };
}

export function encodeRadarEventId(
  unitId: number,
  timeUnix: number,
  volumeLiters: number
): string {
  return `radar:${unitId}:${timeUnix}:${roundLiters(volumeLiters)}`;
}

export function decodeRadarEventId(raw: string): {
  unitId: number;
  timeUnix: number;
  volumeLiters: number;
  timeIso: string;
} | null {
  const m = /^radar:(\d+):(\d+):([\d.]+)$/.exec(raw.trim());
  if (!m) return null;
  const unitId = Number(m[1]);
  const timeUnix = Number(m[2]);
  const volumeLiters = Number(m[3]);
  if (
    !Number.isFinite(unitId) ||
    !Number.isFinite(timeUnix) ||
    !Number.isFinite(volumeLiters)
  ) {
    return null;
  }
  return {
    unitId,
    timeUnix,
    volumeLiters: roundLiters(volumeLiters),
    timeIso: new Date(timeUnix * 1000).toISOString(),
  };
}

async function insertFuelTx(
  supabase: SupabaseClient,
  payload: Record<string, unknown>
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  let { data, error } = await supabase
    .from("fuel_transactions")
    .insert(payload)
    .select("id")
    .maybeSingle();

  if (error) {
    const retry = { ...payload };
    for (const col of [
      "equipment_id",
      "actor_id",
      "actor_name",
      "sync_status",
      "total_cost",
      "price_per_liter",
      "wialon_variance",
      "wialon_verified",
    ] as const) {
      if (error.message?.includes(col) || error.code === "42703") {
        delete retry[col];
      }
    }
    const second = await supabase
      .from("fuel_transactions")
      .insert(retry)
      .select("id")
      .maybeSingle();
    data = second.data;
    error = second.error;
  }

  if (error || !data?.id) {
    return { ok: false, error: error?.message ?? "Не вдалося записати транзакцію" };
  }
  return { ok: true, id: String(data.id) };
}

export async function executeFuelPurchase(params: {
  supabase: SupabaseClient;
  storage: FuelStorageRow;
  liters: number;
  pricePerLiter: number;
  supplier?: string | null;
  transactionDate?: string | null;
}): Promise<
  | {
      ok: true;
      transactionId: string;
      volumeBefore: number;
      volumeAfter: number;
      fillPercentAfter: number;
      pricePerLiter: number;
      totalCost: number;
      overflow: boolean;
    }
  | { ok: false; error: string }
> {
  const amount = roundLiters(params.liters);
  const buyPrice = roundPrice(params.pricePerLiter);
  const volumeBefore = roundLiters(Number(params.storage.current_volume) || 0);
  const capacity = Number(params.storage.capacity) || 0;
  const volumeAfter = roundLiters(volumeBefore + amount);
  const overflow = volumeAfter > capacity + 0.001;

  if (overflow) {
    return {
      ok: false,
      error: `Перелив: «${params.storage.name}» місткість ${capacity} л, буде ${volumeAfter} л.`,
    };
  }

  let transactionDateIso = new Date().toISOString();
  if (params.transactionDate?.trim()) {
    const parsed = new Date(params.transactionDate.trim());
    if (Number.isNaN(parsed.getTime())) {
      return { ok: false, error: "Некоректна transactionDate." };
    }
    transactionDateIso = parsed.toISOString();
  }

  const currentPrice = Number(params.storage.price_per_liter) || 0;
  const wac = computeWeightedAveragePrice(
    volumeBefore,
    currentPrice,
    amount,
    buyPrice
  );
  const totalCost = computeTotalCost(amount, buyPrice);
  const actor = await getCurrentActor();
  const supplier = params.supplier?.trim() || null;

  const { error: volErr } = await params.supabase
    .from("fuel_storages")
    .update({
      current_volume: volumeAfter,
      price_per_liter: wac,
    })
    .eq("id", params.storage.id);
  if (volErr) return { ok: false, error: volErr.message };

  const insert = await insertFuelTx(params.supabase, {
    transaction_type: "inbound",
    amount_liters: amount,
    from_storage_id: null,
    to_storage_id: params.storage.id,
    equipment_id: null,
    wialon_unit_id: null,
    operator_name: supplier,
    price_per_liter: buyPrice,
    total_cost: totalCost,
    sync_status: "pending_1c",
    wialon_variance: null,
    wialon_verified: false,
    transaction_date: transactionDateIso,
    ...actorCreateColumns(actor),
  });

  if (!insert.ok) {
    await params.supabase
      .from("fuel_storages")
      .update({
        current_volume: volumeBefore,
        price_per_liter: currentPrice,
      })
      .eq("id", params.storage.id);
    return insert;
  }

  void enqueueFuelBasDraft({ transactionId: insert.id }).catch(() => undefined);
  void logActivity({
    actor,
    action: "create",
    entityType: "fuel_transaction",
    entityId: insert.id,
    summary: `Закупівля ДП: ${amount} л → «${params.storage.name}»`,
    meta: { storageId: params.storage.id, liters: amount, buyPrice, supplier },
  }).catch(() => undefined);

  return {
    ok: true,
    transactionId: insert.id,
    volumeBefore,
    volumeAfter,
    fillPercentAfter: fillPct(volumeAfter, capacity),
    pricePerLiter: buyPrice,
    totalCost,
    overflow: false,
  };
}

export async function executeFuelTransfer(params: {
  supabase: SupabaseClient;
  from: FuelStorageRow;
  to: FuelStorageRow;
  liters: number;
  transactionDate?: string | null;
}): Promise<
  | {
      ok: true;
      transactionId: string;
      fromVolumeBefore: number;
      fromVolumeAfter: number;
      toVolumeBefore: number;
      toVolumeAfter: number;
      pricePerLiter: number;
      totalCost: number;
    }
  | { ok: false; error: string }
> {
  if (params.from.id === params.to.id) {
    return { ok: false, error: "Ємності мають бути різними." };
  }

  let transactionDateIso = new Date().toISOString();
  if (params.transactionDate?.trim()) {
    const parsed = new Date(params.transactionDate.trim());
    if (Number.isNaN(parsed.getTime())) {
      return { ok: false, error: "Некоректна transactionDate." };
    }
    transactionDateIso = parsed.toISOString();
  }

  const amount = roundLiters(params.liters);
  const fromBefore = roundLiters(Number(params.from.current_volume) || 0);
  const toBefore = roundLiters(Number(params.to.current_volume) || 0);
  const toCapacity = Number(params.to.capacity) || 0;
  const donorPrice = roundPrice(Number(params.from.price_per_liter) || 0);

  if (fromBefore + 0.001 < amount) {
    return {
      ok: false,
      error: `Недостатньо палива в «${params.from.name}» (є ${fromBefore} л).`,
    };
  }
  const toAfter = roundLiters(toBefore + amount);
  if (toAfter > toCapacity + 0.001) {
    return {
      ok: false,
      error: `Перелив у «${params.to.name}» (місткість ${toCapacity} л).`,
    };
  }

  const fromAfter = roundLiters(fromBefore - amount);
  const toPrice = Number(params.to.price_per_liter) || 0;
  const receiverWac = computeWeightedAveragePrice(
    toBefore,
    toPrice,
    amount,
    donorPrice
  );
  const totalCost = computeTotalCost(amount, donorPrice);
  const actor = await getCurrentActor();

  const { error: fromErr } = await params.supabase
    .from("fuel_storages")
    .update({ current_volume: fromAfter })
    .eq("id", params.from.id);
  if (fromErr) return { ok: false, error: fromErr.message };

  const { error: toErr } = await params.supabase
    .from("fuel_storages")
    .update({
      current_volume: toAfter,
      price_per_liter: receiverWac,
    })
    .eq("id", params.to.id);

  if (toErr) {
    await params.supabase
      .from("fuel_storages")
      .update({ current_volume: fromBefore })
      .eq("id", params.from.id);
    return { ok: false, error: toErr.message };
  }

  const insert = await insertFuelTx(params.supabase, {
    transaction_type: "transfer",
    amount_liters: amount,
    from_storage_id: params.from.id,
    to_storage_id: params.to.id,
    equipment_id: null,
    wialon_unit_id: null,
    operator_name: null,
    price_per_liter: donorPrice,
    total_cost: totalCost,
    sync_status: "pending_1c",
    wialon_variance: null,
    wialon_verified: false,
    transaction_date: transactionDateIso,
    ...actorCreateColumns(actor),
  });

  if (!insert.ok) {
    await params.supabase
      .from("fuel_storages")
      .update({ current_volume: fromBefore })
      .eq("id", params.from.id);
    await params.supabase
      .from("fuel_storages")
      .update({
        current_volume: toBefore,
        price_per_liter: toPrice,
      })
      .eq("id", params.to.id);
    return insert;
  }

  void enqueueFuelBasDraft({ transactionId: insert.id }).catch(() => undefined);
  void logActivity({
    actor,
    action: "create",
    entityType: "fuel_transaction",
    entityId: insert.id,
    summary: `Переміщення ДП: ${amount} л «${params.from.name}» → «${params.to.name}»`,
    meta: {
      fromId: params.from.id,
      toId: params.to.id,
      liters: amount,
    },
  }).catch(() => undefined);

  return {
    ok: true,
    transactionId: insert.id,
    fromVolumeBefore: fromBefore,
    fromVolumeAfter: fromAfter,
    toVolumeBefore: toBefore,
    toVolumeAfter: toAfter,
    pricePerLiter: donorPrice,
    totalCost,
  };
}

export async function createFuelStorageRow(params: {
  supabase: SupabaseClient;
  name: string;
  capacity: number;
  fuelType?: "diesel" | "petrol";
  initialVolume?: number;
  storageKind?: "stationary" | "mobile";
}): Promise<
  | { ok: true; storage: FuelStorageRow }
  | { ok: false; error: string }
> {
  if (params.fuelType === "petrol") {
    return {
      ok: false,
      error: "У системі зараз лише дизель (ДП). Створення бензину не підтримується.",
    };
  }

  const name = params.name.trim();
  const capacity = roundLiters(params.capacity);
  const initial = roundLiters(params.initialVolume ?? 0);
  if (!name) return { ok: false, error: "Вкажи назву ємності." };
  if (!(capacity > 0)) return { ok: false, error: "Місткість має бути > 0." };
  if (initial < 0 || initial > capacity + 0.001) {
    return { ok: false, error: "Початковий обʼєм некоректний." };
  }

  const type =
    params.storageKind ??
    (/бензовоз|mobile|цистерн/i.test(name) ? "mobile" : "stationary");

  const diesel = await resolveDieselPriceUah().catch(() => ({
    priceUah: 0,
  }));
  const price = roundPrice(Number(diesel.priceUah) || 0);

  const { data, error } = await params.supabase
    .from("fuel_storages")
    .insert({
      name,
      type,
      capacity,
      current_volume: initial,
      price_per_liter: price,
    })
    .select("id, name, type, capacity, current_volume, price_per_liter, bas_ref_key")
    .single();

  if (error || !data) {
    return { ok: false, error: error?.message ?? "Не вдалося створити ємність" };
  }
  return { ok: true, storage: data as FuelStorageRow };
}

export async function updateFuelStorageRow(params: {
  supabase: SupabaseClient;
  storage: FuelStorageRow;
  name?: string | null;
  capacity?: number | null;
  basRefKey?: string | null;
}): Promise<
  | { ok: true; storage: FuelStorageRow }
  | { ok: false; error: string }
> {
  const patch: Record<string, unknown> = {};
  if (params.name !== undefined) {
    const n = params.name?.trim() || "";
    if (!n) return { ok: false, error: "Назва не може бути порожньою." };
    patch.name = n;
  }
  if (params.capacity !== undefined && params.capacity != null) {
    const cap = roundLiters(params.capacity);
    const vol = Number(params.storage.current_volume) || 0;
    if (!(cap > 0)) return { ok: false, error: "Місткість має бути > 0." };
    if (cap + 0.001 < vol) {
      return {
        ok: false,
        error: `Місткість не може бути меншою за залишок (${roundLiters(vol)} л).`,
      };
    }
    patch.capacity = cap;
  }
  if (params.basRefKey !== undefined) {
    const key = params.basRefKey?.trim() || null;
    if (key) {
      const normalized = normalizeBasRefKey(key);
      if (!normalized) {
        return { ok: false, error: "bas_ref_key має бути UUID Ref_Key з BAS." };
      }
      patch.bas_ref_key = normalized;
    } else {
      patch.bas_ref_key = null;
    }
  }

  if (Object.keys(patch).length === 0) {
    return { ok: false, error: "Немає полів для оновлення." };
  }

  const { data, error } = await params.supabase
    .from("fuel_storages")
    .update(patch)
    .eq("id", params.storage.id)
    .select("id, name, type, capacity, current_volume, price_per_liter, bas_ref_key")
    .single();

  if (error || !data) {
    return { ok: false, error: error?.message ?? "Не вдалося оновити ємність" };
  }
  return { ok: true, storage: data as FuelStorageRow };
}

export async function deleteFuelStorageRow(params: {
  supabase: SupabaseClient;
  storage: FuelStorageRow;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const vol = Number(params.storage.current_volume) || 0;
  if (vol > 0.001) {
    return {
      ok: false,
      error: `Спочатку спустіть ємність (залишок ${roundLiters(vol)} л): спишіть або перемістіть.`,
    };
  }

  const { count, error: countErr } = await params.supabase
    .from("fuel_transactions")
    .select("id", { count: "exact", head: true })
    .or(
      `from_storage_id.eq.${params.storage.id},to_storage_id.eq.${params.storage.id}`
    );

  if (countErr) return { ok: false, error: countErr.message };
  if ((count ?? 0) > 0) {
    return {
      ok: false,
      error: `Ємність має історію транзакцій (${count}). Видалення заборонено — залиште її або деактивуйте вручну в адмінці.`,
    };
  }

  const { error } = await params.supabase
    .from("fuel_storages")
    .delete()
    .eq("id", params.storage.id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function computeFuelPeriodKpis(params: {
  supabase: SupabaseClient;
  period: "today" | "week" | "month" | "season";
}): Promise<{
  period: string;
  purchasedLiters: number;
  dispensedLiters: number;
  transferredLiters: number;
  currentTotalStock: number;
  storagesCount: number;
  avgPurchasePricePerLiter: number | null;
  fromDate: string;
  toDate: string;
}> {
  const { fromDate, toDate } = resolveFieldFuelPeriodBounds(params.period);
  const fromIso = `${fromDate}T00:00:00.000Z`;
  const toIso = `${toDate}T23:59:59.999Z`;

  const [txRes, stRes] = await Promise.all([
    params.supabase
      .from("fuel_transactions")
      .select("transaction_type, amount_liters, price_per_liter")
      .gte("transaction_date", fromIso)
      .lte("transaction_date", toIso)
      .limit(5000),
    params.supabase
      .from("fuel_storages")
      .select("id, current_volume")
      .limit(200),
  ]);

  if (txRes.error) throw new Error(txRes.error.message);
  if (stRes.error) throw new Error(stRes.error.message);

  let purchased = 0;
  let dispensed = 0;
  let transferred = 0;
  let purchaseCost = 0;
  let purchaseLitersForAvg = 0;

  for (const row of txRes.data ?? []) {
    const liters = Number(row.amount_liters) || 0;
    const type = String(row.transaction_type ?? "");
    if (type === "inbound") {
      purchased += liters;
      const p = Number(row.price_per_liter) || 0;
      if (p > 0 && liters > 0) {
        purchaseCost += p * liters;
        purchaseLitersForAvg += liters;
      }
    } else if (type === "outbound") {
      dispensed += liters;
    } else if (type === "transfer") {
      transferred += liters;
    }
  }

  const storages = stRes.data ?? [];
  const currentTotalStock = roundLiters(
    storages.reduce((s, r) => s + (Number(r.current_volume) || 0), 0)
  );

  return {
    period: params.period,
    purchasedLiters: roundLiters(purchased),
    dispensedLiters: roundLiters(dispensed),
    transferredLiters: roundLiters(transferred),
    currentTotalStock,
    storagesCount: storages.length,
    avgPurchasePricePerLiter:
      purchaseLitersForAvg > 0
        ? roundPrice(purchaseCost / purchaseLitersForAvg)
        : null,
    fromDate,
    toDate,
  };
}

export async function listAgentUnrecordedRefuelings(lookbackHours = 48) {
  const hours =
    lookbackHours === 24 || lookbackHours === 48 || lookbackHours === 168
      ? lookbackHours
      : 48;
  const events = await findUnrecordedRefuelings({ lookbackHours: hours });

  const supabase = createServiceSupabase();
  const { data: storages } = await supabase
    .from("fuel_storages")
    .select("id, name, type, current_volume, capacity")
    .order("name")
    .limit(40);

  const storageRows = storages ?? [];
  const tankers = storageRows.filter(
    (s) =>
      String(s.type) === "mobile" ||
      /бензовоз|цистерн|mobile/i.test(String(s.name ?? ""))
  );
  const bases = storageRows.filter(
    (s) =>
      String(s.type) === "stationary" ||
      /азс|база|нафтобаз|склад/i.test(String(s.name ?? ""))
  );

  const suggestedStorages = [
    ...tankers.slice(0, 2).map((s) => ({
      id: String(s.id),
      name: String(s.name),
      kind: "tanker" as const,
      label: `Бензовоз · ${String(s.name)}`,
    })),
    ...bases.slice(0, 2).map((s) => ({
      id: String(s.id),
      name: String(s.name),
      kind: "base" as const,
      label: `АЗС / база · ${String(s.name)}`,
    })),
  ];
  // Якщо немає typed matches — візьми перші дві ємності
  if (suggestedStorages.length === 0) {
    for (const s of storageRows.slice(0, 2)) {
      suggestedStorages.push({
        id: String(s.id),
        name: String(s.name),
        kind: String(s.type) === "mobile" ? "tanker" : "base",
        label: String(s.name),
      });
    }
  }

  const formatTime = (iso: string) => {
    try {
      return new Intl.DateTimeFormat("uk-UA", {
        timeZone: "Europe/Kyiv",
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(iso));
    } catch {
      return iso.slice(0, 16).replace("T", " ");
    }
  };

  const mapped = events.map((e) => {
    const liters = roundLiters(e.volume);
    const timeLabel = formatTime(e.timeIso);
    const machine = e.equipmentName || "невідома техніка";
    return {
      radarEventId: encodeRadarEventId(e.unitId, e.time, e.volume),
      unitId: e.unitId,
      equipmentId: e.equipmentId,
      equipmentName: e.equipmentName,
      timeIso: e.timeIso,
      timeLabel,
      volumeLiters: liters,
      location: e.location,
      badge: "⛽ Підозра на заправку повз облік",
      humanLine: `${machine} +${liters} л о ${timeLabel}`,
      humanExplanation:
        `Датчик у баку «${machine}» показав доливання ≈${liters} л (${timeLabel}), ` +
        `але в системі немає чека чи запису від заправника. Або забули внести, або хибне спрацювання на схилі/ямі.`,
      confirmChoice: "Зафіксувати як заправку",
      dismissChoice: "Відхилити (глюк датчика / яма)",
      dismissReasonDefault: "коливання поплавка / схил або яма",
      suggestedStorages,
    };
  });

  const digest =
    mapped.length === 0
      ? `За ${hours} год датчики не ловили доливання без запису — по радару спокійно.`
      : mapped.length === 1
        ? `Дивись, яка історія: ${mapped[0]!.humanLine}. ${mapped[0]!.humanExplanation} Підкажи, що робимо?`
        : `Є нюанс по солярці: ${mapped.length} позицій, де датчик у баку показав доливання, а запису заправника немає. Найсвіжіше — ${mapped[0]!.humanLine}. Підкажи, що робимо?`;

  return {
    lookbackHours: hours,
    defaultLookbackHint: UNRECORDED_LOOKBACK_HOURS,
    count: mapped.length,
    events: mapped,
    suggestedStorages,
    humanDigest: digest,
    empty: mapped.length === 0,
  };
}

export async function confirmAgentRadarRefueling(params: {
  supabase: SupabaseClient;
  radarEventId: string;
  /** Якщо null/порожньо — лише KPI-корекція без списання зі складу */
  storageIdOrName?: string | null;
  writeOffFromStorage?: boolean;
  driverIdOrName?: string | null;
  correctedLiters?: number | null;
}): Promise<
  | {
      ok: true;
      fuelTransactionId: string | null;
      liters: number;
      storageId: string | null;
      storageName: string | null;
      equipmentName: string | null;
      wroteOffStorage: boolean;
    }
  | { ok: false; error: string }
> {
  const decoded = decodeRadarEventId(params.radarEventId);
  if (!decoded) {
    return {
      ok: false,
      error: "Некоректний radarEventId. Спочатку виклич getUnrecordedRefuelings.",
    };
  }

  const wantWriteOff = params.writeOffFromStorage !== false;
  let storageId: string | null = null;
  let storageName: string | null = null;

  if (wantWriteOff && params.storageIdOrName?.trim()) {
    const resolved = await resolveFuelStorageByLookup(
      params.supabase,
      params.storageIdOrName.trim()
    );
    if (!resolved.ok) {
      return { ok: false, error: resolved.error };
    }
    storageId = resolved.storage.id;
    storageName = resolved.storage.name;
  } else if (wantWriteOff && !params.storageIdOrName?.trim()) {
    // writeOff за замовчуванням true, але без складу — KPI-only
    storageId = null;
  }

  const liters = roundLiters(
    params.correctedLiters != null && params.correctedLiters > 0
      ? params.correctedLiters
      : decoded.volumeLiters
  );

  try {
    const result = await confirmRadarRefuelEvent({
      unitId: decoded.unitId,
      timeIso: decoded.timeIso,
      detectedLiters: decoded.volumeLiters,
      correctedLiters: liters,
      fromStorageId: storageId,
      operatorName: params.driverIdOrName?.trim() || undefined,
    });

    let equipmentName: string | null = null;
    const { data: eq } = await params.supabase
      .from("equipment")
      .select("name")
      .eq("wialon_id", decoded.unitId)
      .maybeSingle();
    if (eq?.name) equipmentName = String(eq.name);

    return {
      ok: true,
      fuelTransactionId: result.fuelTransactionId,
      liters,
      storageId,
      storageName,
      equipmentName,
      wroteOffStorage: Boolean(storageId),
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Помилка підтвердження радара",
    };
  }
}

export async function dismissAgentRadarRefueling(params: {
  radarEventId: string;
  reason: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const decoded = decodeRadarEventId(params.radarEventId);
  if (!decoded) {
    return { ok: false, error: "Некоректний radarEventId." };
  }
  const reason = params.reason.trim();
  if (!reason) {
    return { ok: false, error: "Вкажи причину відхилення." };
  }
  try {
    await dismissRadarRefuelEvent({
      unitId: decoded.unitId,
      timeIso: decoded.timeIso,
      detectedLiters: decoded.volumeLiters,
      reason,
    });
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Помилка відхилення радара",
    };
  }
}

export { fillPct as fuelFillPercent, roundLiters, roundPrice };

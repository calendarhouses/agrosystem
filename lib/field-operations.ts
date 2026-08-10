export type FieldOperationStatus =
  | "planned"
  | "in_progress"
  | "completed"
  | "cancelled";

export type FieldOperationExportStatus = "none" | "pending" | "synced";

/** Операція в UI історії поля */
export type FieldOperation = {
  /** Стабільний client_key (також ключ у localStorage) */
  id: string;
  seasonYear: number;
  occurredAt: string;
  type: string;
  crop: string;
  date: string;
  time: string;
  machinery: string;
  implement: string;
  areaDone: number;
  areaTotal: number;
  fuelUsed: number;
  wage: number;
  status: Exclude<FieldOperationStatus, "cancelled">;
  agronomistComment?: string;
  wialonUnitId?: number | null;
  implementWidthM?: number | null;
  trackerDistanceKm?: number | null;
  trackerWorkHours?: number | null;
  trackerFuelL?: number | null;
  exportStatus?: FieldOperationExportStatus;
};

export type FieldOperationInput = FieldOperation & {
  fieldKey: string;
  fieldId?: string | null;
};

type FieldKeySource = {
  id: string;
  source: string;
  farmField?: { id: string; wialonZoneId?: string | null } | null;
};

type DbRow = Record<string, unknown>;

const LOCAL_KEY = "agrosystem.field_operations.v1";

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

/** Стабільний ключ історії для ділянки (не плутати між полями) */
export function fieldOperationsKey(item: FieldKeySource): string {
  if (item.farmField?.id) return `farm:${item.farmField.id}`;
  if (item.source === "wialon") return `wialon:${item.id}`;
  if (item.source === "demo") return `demo:${item.id}`;
  return `map:${item.id}`;
}

/** Додаткові ключі (напр. wialon:… до створення паспорта) */
export function fieldOperationsLegacyKeys(item: FieldKeySource): string[] {
  const primary = fieldOperationsKey(item);
  const candidates: string[] = [];
  const zoneId = item.farmField?.wialonZoneId?.trim();
  if (zoneId) candidates.push(`wialon:${zoneId}`);
  if (item.farmField?.id && item.id && item.id !== item.farmField.id) {
    candidates.push(`wialon:${item.id}`);
  }
  return Array.from(new Set(candidates)).filter((key) => key !== primary);
}

export function farmFieldIdFromKey(fieldKey: string): string | null {
  if (fieldKey.startsWith("farm:")) {
    const id = fieldKey.slice("farm:".length);
    return isUuid(id) ? id : null;
  }
  return null;
}

/** Оцінка обробленої площі: км × ширина(м) / 10 = га */
export function estimateAreaHaFromTrack(
  distanceKm: number,
  widthM: number,
  areaCap?: number | null
): number {
  if (!Number.isFinite(distanceKm) || distanceKm <= 0) return 0;
  if (!Number.isFinite(widthM) || widthM <= 0) return 0;
  const ha = Math.round(((distanceKm * widthM) / 10) * 100) / 100;
  if (areaCap != null && Number.isFinite(areaCap) && areaCap > 0) {
    return Math.min(ha, Math.round(areaCap * 100) / 100);
  }
  return ha;
}

function formatOpDateLabel(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat("uk-UA", {
      day: "numeric",
      month: "long",
    }).format(d);
  } catch {
    return iso;
  }
}

function num(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function optionalNum(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function mapExportStatus(value: unknown): FieldOperationExportStatus {
  const s = String(value ?? "none");
  if (s === "pending" || s === "synced") return s;
  return "none";
}

export function mapOperationRow(row: DbRow): FieldOperation {
  const statusRaw = String(row.status ?? "planned");
  const status: FieldOperation["status"] =
    statusRaw === "completed" || statusRaw === "in_progress"
      ? statusRaw
      : "planned";

  const areaPlan = num(row.area_plan);
  const areaFact = num(row.area_fact);
  const fuelPlan = num(row.fuel_plan);
  const fuelFact = num(row.fuel_fact);
  const wagePlan = num(row.wage_plan);
  const wageFact = num(row.wage_fact);
  const occurredAt =
    String(row.occurred_at ?? "").slice(0, 10) ||
    String(row.closed_at ?? row.created_at ?? "").slice(0, 10) ||
    new Date().toISOString().slice(0, 10);

  const areaDone =
    status === "completed" && areaFact > 0
      ? areaFact
      : areaPlan > 0
        ? areaPlan
        : areaFact;

  return {
    id: String(row.client_key),
    seasonYear: num(row.season_year, new Date(occurredAt).getFullYear()),
    occurredAt,
    type: String(row.work_type ?? ""),
    crop: String(row.crop ?? ""),
    date: formatOpDateLabel(occurredAt),
    time: String(row.time_label ?? "—"),
    machinery: String(row.machinery ?? "—"),
    implement: String(row.implement ?? "—"),
    areaDone: Math.round(areaDone * 100) / 100,
    areaTotal: num(row.area_total, areaDone),
    fuelUsed:
      status === "completed" && fuelFact > 0
        ? fuelFact
        : fuelPlan > 0
          ? fuelPlan
          : fuelFact,
    wage:
      status === "completed" && wageFact > 0
        ? wageFact
        : wagePlan > 0
          ? wagePlan
          : wageFact,
    status,
    agronomistComment:
      row.agronomist_comment != null && String(row.agronomist_comment).trim()
        ? String(row.agronomist_comment)
        : undefined,
    wialonUnitId: optionalNum(row.wialon_unit_id),
    implementWidthM: optionalNum(row.implement_width_m),
    trackerDistanceKm: optionalNum(row.tracker_distance_km),
    trackerWorkHours: optionalNum(row.tracker_work_hours),
    trackerFuelL: optionalNum(row.tracker_fuel_l),
    exportStatus: mapExportStatus(row.export_status),
  };
}

function readLocalAll(): Record<string, FieldOperation[]> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(LOCAL_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, FieldOperation[]>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeLocalAll(data: Record<string, FieldOperation[]>) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LOCAL_KEY, JSON.stringify(data));
}

function listLocal(fieldKeys: string[]): FieldOperation[] {
  const all = readLocalAll();
  const byId = new Map<string, FieldOperation>();
  for (const key of fieldKeys) {
    for (const op of all[key] ?? []) {
      byId.set(op.id, op);
    }
  }
  return Array.from(byId.values()).sort((a, b) =>
    b.occurredAt.localeCompare(a.occurredAt)
  );
}

function upsertLocal(fieldKey: string, op: FieldOperation) {
  const all = readLocalAll();
  const list = [...(all[fieldKey] ?? [])];
  const idx = list.findIndex((item) => item.id === op.id);
  if (idx === -1) list.unshift(op);
  else list[idx] = op;
  all[fieldKey] = list.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  writeLocalAll(all);
}

function removeLocal(fieldKeys: string[], clientKey: string) {
  const all = readLocalAll();
  let changed = false;
  for (const key of fieldKeys) {
    const list = all[key];
    if (!list) continue;
    const next = list.filter((op) => op.id !== clientKey);
    if (next.length !== list.length) {
      all[key] = next;
      changed = true;
    }
  }
  if (changed) writeLocalAll(all);
}

function migrateLocalKeys(primary: string, legacy: string[]) {
  if (legacy.length === 0) return;
  const all = readLocalAll();
  const merged = [...(all[primary] ?? [])];
  const seen = new Set(merged.map((op) => op.id));
  let moved = false;
  for (const key of legacy) {
    const list = all[key] ?? [];
    if (list.length === 0) continue;
    for (const op of list) {
      if (!seen.has(op.id)) {
        merged.push(op);
        seen.add(op.id);
      }
    }
    delete all[key];
    moved = true;
  }
  if (moved) {
    all[primary] = merged.sort((a, b) =>
      b.occurredAt.localeCompare(a.occurredAt)
    );
    writeLocalAll(all);
  }
}

export function todayIsoLocal(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Усі локальні наряди (для poller / sync) */
export function listAllLocalFieldOperations(): Array<
  FieldOperation & { fieldKey: string }
> {
  const all = readLocalAll();
  const out: Array<FieldOperation & { fieldKey: string }> = [];
  for (const [fieldKey, ops] of Object.entries(all)) {
    for (const op of ops) {
      out.push({ ...op, fieldKey });
    }
  }
  return out;
}

export async function listFieldOperations(
  fieldKey: string,
  legacyKeys: string[] = []
): Promise<FieldOperation[]> {
  migrateLocalKeys(fieldKey, legacyKeys);
  const keys = [fieldKey, ...legacyKeys.filter((k) => k !== fieldKey)];
  const params = new URLSearchParams({ fieldKey });
  if (legacyKeys.length > 0) params.set("also", legacyKeys.join(","));

  try {
    const res = await fetch(`/api/field-operations?${params}`, {
      cache: "no-store",
    });
    if (res.ok) {
      const data = (await res.json()) as { operations?: FieldOperation[] };
      const ops = data.operations ?? [];
      const all = readLocalAll();
      all[fieldKey] = ops;
      for (const key of legacyKeys) delete all[key];
      writeLocalAll(all);
      return ops;
    }
  } catch {
    /* fallback local */
  }
  return listLocal(keys);
}

export async function upsertFieldOperation(
  input: FieldOperationInput
): Promise<FieldOperation> {
  const fieldId =
    input.fieldId && isUuid(input.fieldId)
      ? input.fieldId
      : farmFieldIdFromKey(input.fieldKey);

  const body = {
    clientKey: input.id,
    fieldKey: input.fieldKey,
    fieldId,
    workType: input.type,
    crop: input.crop,
    status: input.status,
    machinery: input.machinery,
    implement: input.implement,
    occurredAt: input.occurredAt,
    timeLabel: input.time,
    seasonYear: input.seasonYear,
    areaTotal: input.areaTotal,
    areaPlan: input.areaDone,
    areaFact: input.status === "completed" ? input.areaDone : null,
    fuelPlan: input.fuelUsed,
    fuelFact: input.status === "completed" ? input.fuelUsed : null,
    wagePlan: input.wage,
    wageFact: input.status === "completed" ? input.wage : null,
    agronomistComment: input.agronomistComment ?? null,
    wialonUnitId: input.wialonUnitId ?? null,
    implementWidthM: input.implementWidthM ?? null,
    trackerDistanceKm: input.trackerDistanceKm ?? null,
    trackerWorkHours: input.trackerWorkHours ?? null,
    trackerFuelL: input.trackerFuelL ?? null,
    exportStatus: input.exportStatus ?? "none",
  };

  upsertLocal(input.fieldKey, {
    ...input,
    date: input.date || formatOpDateLabel(input.occurredAt),
  });

  try {
    const res = await fetch("/api/field-operations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const data = (await res.json()) as { operation?: FieldOperation };
      if (data.operation) {
        upsertLocal(input.fieldKey, data.operation);
        return data.operation;
      }
    }
  } catch {
    /* keep local */
  }

  return {
    ...input,
    date: input.date || formatOpDateLabel(input.occurredAt),
  };
}

export async function deleteFieldOperation(
  fieldKey: string,
  clientKey: string,
  legacyKeys: string[] = []
): Promise<void> {
  const keys = [fieldKey, ...legacyKeys];
  removeLocal(keys, clientKey);

  try {
    const params = new URLSearchParams({ clientKey });
    await fetch(`/api/field-operations?${params}`, { method: "DELETE" });
  } catch {
    /* local already updated */
  }
}

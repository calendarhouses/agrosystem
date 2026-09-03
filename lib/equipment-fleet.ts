/**
 * Флот моніторингу.
 * Тимчасово (до зіставлення BAS AGRO↔Wialon): джерело правди = усі юніти Wialon.
 * Опційно збагачуємо mapped equipment (бак, тип), якщо wialon_id є.
 */

import type { FeatureCollection, Polygon } from "geojson";

import type { FleetActiveOperation } from "@/lib/equipment-active-ops";
import {
  isFuelDeliveryUnit,
  resolveFuelTankVolumeLiters,
} from "@/lib/equipment-fuel-tanks";
import type { WialonGeofenceProperties, WialonUnit } from "@/lib/wialon";

/**
 * БД-обʼєм бака, інакше номінал за назвою.
 * Бензовоз: завжди цистерна (~7000 L), навіть якщо в БД лишився бак тягача 200.
 */
function resolveUnitTankVolume(
  dbVolume: unknown,
  ...names: Array<string | null | undefined>
): number | null {
  if (isFuelDeliveryUnit(...names)) {
    return resolveFuelTankVolumeLiters(...names) ?? numOrNull(dbVolume);
  }
  return numOrNull(dbVolume) ?? resolveFuelTankVolumeLiters(...names);
}

export type FleetEquipmentRow = {
  id: string;
  name: string;
  type: string;
  code: string | null;
  wialon_id: number | null;
  fuel_tank_volume: number | null;
  /** field | base | null */
  work_scope?: string | null;
};

/** Активна техніка з GPS (або з wialon_id, але без відповіді Wialon) */
export type FleetTrackedUnit = WialonUnit & {
  equipmentId: string;
  /** Номінальний обʼєм бака, л; null = % не рахуємо */
  fuelTankVolume: number | null;
  equipmentType: string;
  equipmentCode: string | null;
  activeOp?: FleetActiveOperation | null;
};

export type FleetNonTrackedItem = {
  equipmentId: string;
  name: string;
  type: string;
  code: string | null;
  fuelTankVolume: number | null;
  /** field = Поля, base = База */
  workScope?: "field" | "base" | null;
  /** equipment без GPS або запис з довідника implements */
  source?: "equipment" | "implement";
  activeOp?: FleetActiveOperation | null;
};

/** Самохідна техніка (основні засоби з двигуном) */
export const SELF_PROPELLED_EQUIPMENT_TYPES = new Set([
  "tractor",
  "combine",
  "harvester",
  "sprayer",
  "loader",
  "truck",
  "car",
]);

/** Причіпне / навісне обладнання (implements) */
export const TOWED_EQUIPMENT_TYPES = new Set([
  "seeder",
  "plow",
  "harrow",
  "header",
  "cultivator",
  "spreader",
  "compactor",
]);

export function isTowedEquipmentType(type: string): boolean {
  return TOWED_EQUIPMENT_TYPES.has(type.toLowerCase());
}

/** Назви причіпного / баків / знаряддя (коли type = other у Wialon) */
const IMPLEMENT_NAME_RE =
  /бак\s*для|бак\s*внесен|причіпн|\bпричіп\b|сівалк|плуг\b|борон|культиват|розкид|жатка|\bкотк|знарядд|навісн|глибокорозпуш|дисков|trailer|implement|сеялк|культиватор|диск\.?\s*борон|оприскувачн\s*бак/i;

export function isImplementLikeName(name: string): boolean {
  return IMPLEMENT_NAME_RE.test(name.trim());
}

/** Що показуємо у флоті моніторингу: трактори, комбайни тощо — без знаряддя */
export function isFleetMonitorUnit(type: string, name: string): boolean {
  if (isTowedEquipmentType(type)) return false;
  if (isImplementLikeName(name)) return false;
  return true;
}

/** Самохідна машина з довідника equipment (не сівалка/плуг тощо) */
export function isSelfPropelledEquipmentType(type: string): boolean {
  const normalized = type.toLowerCase();
  if (isTowedEquipmentType(normalized)) return false;
  if (SELF_PROPELLED_EQUIPMENT_TYPES.has(normalized)) return true;
  // Запис у equipment без явного implement-типу — трактуємо як самохідний
  return true;
}

export type FleetPayload = {
  tracked: FleetTrackedUnit[];
  /** Самохідна техніка без GPS-трекера */
  nonTracked: FleetNonTrackedItem[];
  /** Причіпне обладнання та інвентар */
  towedEquipment: FleetNonTrackedItem[];
  geofences: FeatureCollection<Polygon, WialonGeofenceProperties>;
};

function numOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** % палива лише коли заданий обʼєм бака */
export function fuelPercentOfTank(
  liters: number | null | undefined,
  tankVolume: number | null | undefined
): number | null {
  if (
    liters == null ||
    !Number.isFinite(liters) ||
    liters < 0 ||
    tankVolume == null ||
    !Number.isFinite(tankVolume) ||
    tankVolume <= 0
  ) {
    return null;
  }
  return Math.min(100, Math.max(0, (liters / tankVolume) * 100));
}

export function isFuelCritical(
  liters: number | null | undefined,
  tankVolume: number | null | undefined,
  ratio = 0.15
): boolean {
  const pct = fuelPercentOfTank(liters, tankVolume);
  return pct != null && pct / 100 < ratio;
}

function stubWialonUnit(wialonId: number, name: string): WialonUnit {
  return {
    id: wialonId,
    nm: name,
    pos: null,
  };
}

/**
 * Тимчасово: флот = усі юніти Wialon.
 * Якщо є mapping у equipment — підтягуємо бак/тип/id; інакше synthetic equipmentId.
 */
export function wialonFirstFleet(
  wialonUnits: WialonUnit[],
  equipment: FleetEquipmentRow[] = []
): {
  tracked: FleetTrackedUnit[];
  nonTracked: FleetNonTrackedItem[];
  towedEquipment: FleetNonTrackedItem[];
} {
  const eqByWialon = new Map<number, FleetEquipmentRow>();
  const mappedWialonIds = new Set<number>();

  for (const row of equipment) {
    if (row.wialon_id != null && Number.isFinite(row.wialon_id)) {
      eqByWialon.set(row.wialon_id, row);
      mappedWialonIds.add(row.wialon_id);
    }
  }

  const tracked: FleetTrackedUnit[] = wialonUnits
    .filter((u) => Number.isFinite(u.id) && u.id > 0)
    .map((unit) => {
      const eq = eqByWialon.get(unit.id);
      return {
        ...unit,
        id: unit.id,
        nm: unit.nm,
        equipmentId: eq?.id ?? `wialon:${unit.id}`,
        fuelTankVolume: resolveUnitTankVolume(
          eq?.fuel_tank_volume,
          unit.nm,
          eq?.name
        ),
        equipmentType: eq?.type ?? "other",
        equipmentCode: eq?.code ?? null,
        activeOp: null,
      };
    })
    .filter((unit) => isFleetMonitorUnit(unit.equipmentType, unit.nm));

  tracked.sort((a, b) => a.nm.localeCompare(b.nm, "uk"));

  const nonTracked: FleetNonTrackedItem[] = [];
  const towedEquipment: FleetNonTrackedItem[] = [];
  for (const row of equipment) {
    if (row.wialon_id != null && mappedWialonIds.has(row.wialon_id)) continue;
    if (row.wialon_id != null) continue;

    const item: FleetNonTrackedItem = {
      equipmentId: row.id,
      name: row.name,
      type: row.type,
      code: row.code,
      fuelTankVolume: resolveUnitTankVolume(row.fuel_tank_volume, row.name),
      workScope:
        row.work_scope === "field" || row.work_scope === "base"
          ? row.work_scope
          : null,
      source: "equipment",
      activeOp: null,
    };

    if (
      isSelfPropelledEquipmentType(row.type) &&
      isFleetMonitorUnit(row.type, row.name)
    ) {
      nonTracked.push(item);
    } else {
      towedEquipment.push(item);
    }
  }
  nonTracked.sort((a, b) => a.name.localeCompare(b.name, "uk"));
  towedEquipment.sort((a, b) => a.name.localeCompare(b.name, "uk"));

  return { tracked, nonTracked, towedEquipment };
}

/**
 * Legacy: equipment-first merge (після зіставлення BAS AGRO↔Wialon).
 */
export function mergeEquipmentFleet(
  equipment: FleetEquipmentRow[],
  wialonUnits: WialonUnit[]
): {
  tracked: FleetTrackedUnit[];
  nonTracked: FleetNonTrackedItem[];
  towedEquipment: FleetNonTrackedItem[];
} {
  const byWialonId = new Map<number, WialonUnit>();
  for (const unit of wialonUnits) {
    if (Number.isFinite(unit.id)) byWialonId.set(unit.id, unit);
  }

  const tracked: FleetTrackedUnit[] = [];
  const nonTracked: FleetNonTrackedItem[] = [];
  const towedEquipment: FleetNonTrackedItem[] = [];

  for (const row of equipment) {
    const tank = resolveUnitTankVolume(row.fuel_tank_volume, row.name);
    const wialonId =
      row.wialon_id != null && Number.isFinite(Number(row.wialon_id))
        ? Number(row.wialon_id)
        : null;

    if (wialonId == null) {
      const item: FleetNonTrackedItem = {
        equipmentId: row.id,
        name: row.name,
        type: row.type,
        code: row.code,
        fuelTankVolume: tank,
        workScope:
          row.work_scope === "field" || row.work_scope === "base"
            ? row.work_scope
            : null,
        source: "equipment",
      };
      if (
        isSelfPropelledEquipmentType(row.type) &&
        isFleetMonitorUnit(row.type, row.name)
      ) {
        nonTracked.push(item);
      } else {
        towedEquipment.push(item);
      }
      continue;
    }

    if (!isFleetMonitorUnit(row.type, row.name)) {
      towedEquipment.push({
        equipmentId: row.id,
        name: row.name,
        type: row.type,
        code: row.code,
        fuelTankVolume: tank,
        source: "equipment",
      });
      continue;
    }

    const gps = byWialonId.get(wialonId) ?? stubWialonUnit(wialonId, row.name);
    tracked.push({
      ...gps,
      id: wialonId,
      nm: row.name.trim() || gps.nm,
      equipmentId: row.id,
      fuelTankVolume: tank ?? resolveFuelTankVolumeLiters(gps.nm),
      equipmentType: row.type,
      equipmentCode: row.code,
      activeOp: null,
    });
  }

  tracked.sort((a, b) => a.nm.localeCompare(b.nm, "uk"));
  nonTracked.sort((a, b) => a.name.localeCompare(b.name, "uk"));
  towedEquipment.sort((a, b) => a.name.localeCompare(b.name, "uk"));

  return { tracked, nonTracked, towedEquipment };
}

/** Додати причіпне обладнання з довідника implements */
export function appendImplementsAsTowedEquipment(
  towedEquipment: FleetNonTrackedItem[],
  implementsRows: {
    id: string;
    name: string;
    type: string;
    code: string | null;
  }[]
): FleetNonTrackedItem[] {
  const next = [...towedEquipment];
  for (const row of implementsRows) {
    next.push({
      equipmentId: row.id,
      name: row.name,
      type: row.type,
      code: row.code,
      fuelTankVolume: null,
      source: "implement",
      activeOp: null,
    });
  }
  next.sort((a, b) => a.name.localeCompare(b.name, "uk"));
  return next;
}

/** @deprecated використовуйте appendImplementsAsTowedEquipment */
export function appendImplementsAsNonTracked(
  nonTracked: FleetNonTrackedItem[],
  implementsRows: Parameters<typeof appendImplementsAsTowedEquipment>[1]
): FleetNonTrackedItem[] {
  return appendImplementsAsTowedEquipment(nonTracked, implementsRows);
}

function gpsSnapshotChanged(prev: FleetTrackedUnit, live: WialonUnit): boolean {
  const op = prev.pos;
  const np = live.pos;
  if (!op && !np) {
    /* check sensors below */
  } else if (!op || !np) {
    return true;
  } else if (
    op.x !== np.x ||
    op.y !== np.y ||
    (op.s ?? 0) !== (np.s ?? 0) ||
    (op.t ?? 0) !== (np.t ?? 0) ||
    (op.c ?? 0) !== (np.c ?? 0)
  ) {
    return true;
  }
  const prevCalc = (prev as FleetTrackedUnit & { sensorCalc?: Record<string, number> })
    .sensorCalc;
  const liveCalc = (live as WialonUnit & { sensorCalc?: Record<string, number> })
    .sensorCalc;
  // Live без calc — не вважати зміною (поллінг позицій не тягне датчики)
  if (liveCalc == null) return false;
  return JSON.stringify(prevCalc ?? null) !== JSON.stringify(liveCalc);
}

/** Оновити лише GPS-частину tracked-списку після поллінгу */
export function patchFleetGps(
  tracked: FleetTrackedUnit[],
  liveUnits: WialonUnit[]
): FleetTrackedUnit[] {
  if (tracked.length === 0 || liveUnits.length === 0) return tracked;
  const byId = new Map(liveUnits.map((u) => [u.id, u]));
  let changed = false;
  const next = tracked.map((item) => {
    const live = byId.get(item.id);
    if (!live) return item;
    if (!gpsSnapshotChanged(item, live)) return item;
    changed = true;
    const prevCalc = (
      item as FleetTrackedUnit & { sensorCalc?: Record<string, number> }
    ).sensorCalc;
    const liveCalc = (
      live as WialonUnit & { sensorCalc?: Record<string, number> }
    ).sensorCalc;
    return {
      ...live,
      id: item.id,
      nm: item.nm || live.nm,
      equipmentId: item.equipmentId,
      fuelTankVolume: item.fuelTankVolume,
      equipmentType: item.equipmentType,
      equipmentCode: item.equipmentCode,
      activeOp: item.activeOp ?? null,
      // Live-поллінг без calc — не затирати вже відомі літри
      sensorCalc: liveCalc ?? prevCalc,
    };
  });
  return changed ? next : tracked;
}

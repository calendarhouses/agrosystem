import {
  allChangeItems,
  itemStatus,
  type BasChangeRequest,
} from "@/lib/bas-change-request";
import { normalizeBasRefKey } from "@/lib/bas-mapping";

/** Домени звірки поза полями — лише «немає звʼязку з BAS AGRO». */
export type ReconciliationLinkDomain = "machinery" | "storages" | "tmc";

export type ReconciliationGapItem = {
  id: string;
  title: string;
  subtitle: string | null;
  reason: "unmapped" | "local";
};

export type ReconciliationLinkGaps = {
  machinery: ReconciliationGapItem[];
  storages: ReconciliationGapItem[];
  tmc: ReconciliationGapItem[];
};

export type ReconciliationHubCounts = {
  fieldsOpen: number;
  machinery: number;
  storages: number;
  tmc: number;
  totalOpen: number;
};

export function countOpenFieldItems(request: BasChangeRequest): number {
  return allChangeItems(request).filter(
    (item) => itemStatus(item) !== "synced"
  ).length;
}

export function linkGapCounts(
  gaps: ReconciliationLinkGaps
): Pick<ReconciliationHubCounts, "machinery" | "storages" | "tmc"> {
  return {
    machinery: gaps.machinery.length,
    storages: gaps.storages.length,
    tmc: gaps.tmc.length,
  };
}

export function buildHubCounts(
  request: BasChangeRequest,
  gaps: ReconciliationLinkGaps
): ReconciliationHubCounts {
  const fieldsOpen = countOpenFieldItems(request);
  const link = linkGapCounts(gaps);
  return {
    fieldsOpen,
    machinery: link.machinery,
    storages: link.storages,
    tmc: link.tmc,
    totalOpen: fieldsOpen + link.machinery + link.storages + link.tmc,
  };
}

/** Чи вважаємо рядок «без звʼязку з BAS AGRO» (як у мапінгу). */
export function isUnmappedBasRef(
  basRefKey: string | null | undefined,
  isLocal?: boolean
): boolean {
  if (isLocal === true) return true;
  return normalizeBasRefKey(basRefKey) == null;
}

export function mapMachineryGapRows(
  rows: {
    id: string;
    wialon_name: string | null;
    wialon_id: number | string | null;
    bas_ref_key: string | null;
  }[]
): ReconciliationGapItem[] {
  return rows
    .filter((row) => isUnmappedBasRef(row.bas_ref_key))
    .map((row) => ({
      id: String(row.id),
      title: String(row.wialon_name || `Техніка #${row.wialon_id ?? "?"}`),
      subtitle:
        row.wialon_id != null ? `GPS · ID ${row.wialon_id}` : "GPS-трекер",
      reason: "unmapped" as const,
    }));
}

export function mapStorageGapRows(
  rows: {
    id: string;
    name: string | null;
    type: string | null;
    bas_ref_key: string | null;
  }[]
): ReconciliationGapItem[] {
  return rows
    .filter((row) => isUnmappedBasRef(row.bas_ref_key))
    .map((row) => ({
      id: String(row.id),
      title: String(row.name ?? "Склад ДП"),
      subtitle:
        row.type === "mobile"
          ? "Мобільний"
          : row.type === "stationary"
            ? "Стаціонарний"
            : null,
      reason: "unmapped" as const,
    }));
}

export function mapTmcGapRows(
  rows: {
    id: string;
    name: string | null;
    custom_name: string | null;
    category: string | null;
    unit: string | null;
    bas_ref_key: string | null;
    is_local: boolean | null;
  }[]
): ReconciliationGapItem[] {
  const categoryLabel: Record<string, string> = {
    zzr: "ЗЗР",
    fertilizer: "Добрива",
    harvest: "Врожай",
    parts: "Запчастини",
    seed: "Насіння",
  };

  return rows
    .filter((row) => isUnmappedBasRef(row.bas_ref_key, row.is_local === true))
    .map((row) => {
      const isLocal = row.is_local === true;
      return {
        id: String(row.id),
        title: String(row.custom_name?.trim() || row.name || "Товар"),
        subtitle: [
          categoryLabel[String(row.category)] ?? row.category,
          row.unit ? String(row.unit) : null,
          isLocal ? "нова позиція" : "без зіставлення",
        ]
          .filter(Boolean)
          .join(" · "),
        reason: isLocal ? ("local" as const) : ("unmapped" as const),
      };
    });
}

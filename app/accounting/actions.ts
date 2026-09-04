"use server";

import {
  getBasFields,
  getBasMachinery,
  getBasNomenclature,
  getBasStorages,
} from "@/lib/bas-api";
import {
  buildBasChangeRequest,
  orphanCollisions,
  type BasChangeRequest,
  type OrphanCollision,
} from "@/lib/bas-change-request";
import {
  fieldsToOptions,
  machineryToOptions,
  nomenclatureToOptions,
  normalizeBasRefKey,
  storagesToOptions,
  type BasSelectOption,
  type MappingCatalogKind,
  type MappingLocalRow,
} from "@/lib/bas-mapping";
import {
  loadBasFields,
  loadRegistryRows,
} from "@/lib/field-registry-data";
import { unmatchedBasFields, type BasFieldSummary } from "@/lib/field-registry";
import {
  buildHubCounts,
  mapMachineryGapRows,
  mapStorageGapRows,
  mapTmcGapRows,
  type ReconciliationGapItem,
  type ReconciliationHubCounts,
  type ReconciliationLinkGaps,
} from "@/lib/reconciliation-gaps";
import { createServiceSupabase } from "@/lib/supabase/server";

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export type AccountingReconciliationData = {
  request: BasChangeRequest;
  orphans: BasFieldSummary[];
  collisions: OrphanCollision[];
  basError: string | null;
  gaps: ReconciliationLinkGaps;
  counts: ReconciliationHubCounts;
};

async function loadBasCatalog<T>(
  loader: () => Promise<T[]>
): Promise<{ items: T[]; error: string | null }> {
  try {
    return { items: await loader(), error: null };
  } catch (error) {
    return {
      items: [],
      error: error instanceof Error ? error.message : "Не вдалося прочитати BAS AGRO",
    };
  }
}

async function loadLinkGaps(): Promise<ReconciliationLinkGaps> {
  const supabase = createServiceSupabase();

  const [machineryRes, storagesRes, tmcRes] = await Promise.all([
    supabase
      .from("wialon_bas_mapping")
      .select("id, wialon_id, wialon_name, bas_ref_key")
      .order("wialon_name", { ascending: true }),
    supabase
      .from("fuel_storages")
      .select("id, name, type, bas_ref_key")
      .order("name", { ascending: true }),
    supabase
      .from("inventory_items_cache")
      .select(
        "id, name, custom_name, category, unit, bas_ref_key, is_local, is_hidden"
      )
      .or("is_hidden.is.null,is_hidden.eq.false")
      .order("name", { ascending: true })
      .limit(500),
  ]);

  return {
    machinery: mapMachineryGapRows(machineryRes.data ?? []),
    storages: mapStorageGapRows(storagesRes.data ?? []),
    tmc: mapTmcGapRows(tmcRes.data ?? []),
  };
}

export async function loadAccountingReconciliation(): Promise<
  ActionResult<AccountingReconciliationData>
> {
  try {
    const [rows, basFields, gaps] = await Promise.all([
      loadRegistryRows(),
      loadBasFields(),
      loadLinkGaps(),
    ]);
    const request = buildBasChangeRequest(rows, basFields.items);
    const orphans = unmatchedBasFields(rows, basFields.items);
    const collisions = orphanCollisions(rows, orphans);
    const counts = buildHubCounts(request, gaps);
    return {
      ok: true,
      data: {
        request,
        orphans,
        collisions,
        basError: basFields.error,
        gaps,
        counts,
      },
    };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error ? err.message : "Не вдалося завантажити звірку",
    };
  }
}

export type { ReconciliationGapItem, ReconciliationHubCounts, ReconciliationLinkGaps };

async function loadLocalRows(
  kind: MappingCatalogKind
): Promise<MappingLocalRow[]> {
  const supabase = createServiceSupabase();

  if (kind === "storages") {
    const { data, error } = await supabase
      .from("fuel_storages")
      .select("id, name, type, capacity, current_volume, bas_ref_key")
      .order("name", { ascending: true });
    if (error) return [];
    const litres = new Intl.NumberFormat("uk-UA");
    return (data ?? []).map((row) => ({
      id: String(row.id),
      title: String(row.name ?? "Склад"),
      subtitle: [
        row.type === "mobile"
          ? "Мобільний"
          : row.type === "stationary"
            ? "Стаціонарний"
            : null,
        Number.isFinite(Number(row.capacity))
          ? `${litres.format(Number(row.current_volume ?? 0))} / ${litres.format(Number(row.capacity))} л`
          : null,
      ]
        .filter(Boolean)
        .join(" · "),
      basRefKey: normalizeBasRefKey(
        row.bas_ref_key != null ? String(row.bas_ref_key) : null
      ),
    }));
  }

  if (kind === "fields") {
    const { data, error } = await supabase
      .from("farm_fields")
      .select(
        "id, name, canonical_name, field_no, area_ha, is_field, bas_ref_key"
      )
      .not("is_field", "is", false)
      .order("canonical_name", { ascending: true });
    if (error) return [];
    return (data ?? []).map((row) => {
      const wialonName = String(row.name ?? "Поле");
      const title = String(row.canonical_name ?? "").trim() || wialonName;
      const areaHa =
        row.area_ha != null && Number.isFinite(Number(row.area_ha))
          ? Number(row.area_ha)
          : null;
      return {
        id: String(row.id),
        title,
        subtitle: [
          title === wialonName ? null : `Wialon: ${wialonName}`,
          areaHa != null ? `${areaHa.toLocaleString("uk-UA")} га` : null,
        ]
          .filter(Boolean)
          .join(" · "),
        basRefKey: normalizeBasRefKey(
          row.bas_ref_key != null ? String(row.bas_ref_key) : null
        ),
        areaHa,
        fieldNumberKey:
          String(row.field_no ?? "").trim() || null,
      };
    });
  }

  if (kind === "machinery") {
    const { data, error } = await supabase
      .from("wialon_bas_mapping")
      .select("id, wialon_id, wialon_name, bas_ref_key")
      .order("wialon_name", { ascending: true });
    if (error) return [];
    return (data ?? []).map((row) => ({
      id: String(row.id),
      title: String(row.wialon_name || `Wialon #${row.wialon_id}`),
      subtitle: row.wialon_id != null ? `ID ${row.wialon_id}` : null,
      basRefKey: normalizeBasRefKey(
        row.bas_ref_key != null ? String(row.bas_ref_key) : null
      ),
    }));
  }

  // tmc — лише локальний кеш, без повного BAS на старті
  const { data, error } = await supabase
    .from("inventory_items_cache")
    .select(
      "id, bas_ref_key, name, custom_name, category, unit, is_local, is_hidden"
    )
    .or("is_hidden.is.null,is_hidden.eq.false")
    .order("name", { ascending: true })
    .limit(400);
  if (error) return [];
  const categoryLabel: Record<string, string> = {
    zzr: "ЗЗР",
    fertilizer: "Добрива",
    harvest: "Врожай",
    parts: "Запчастини",
    seed: "Насіння",
  };
  return (data ?? []).map((row) => {
    const isLocal = row.is_local === true;
    const basRefKey = normalizeBasRefKey(
      row.bas_ref_key != null ? String(row.bas_ref_key) : null
    );
    return {
      id: String(row.id),
      title: String(row.custom_name?.trim() || row.name || "ТМЦ"),
      subtitle: [
        categoryLabel[String(row.category)] ?? row.category,
        row.unit ? String(row.unit) : null,
        isLocal ? "локальна" : null,
      ]
        .filter(Boolean)
        .join(" · "),
      basRefKey: isLocal ? null : basRefKey,
      isLocal,
    };
  });
}

async function loadBasOptions(
  kind: MappingCatalogKind
): Promise<{ options: BasSelectOption[]; error: string | null }> {
  if (kind === "storages") {
    const res = await loadBasCatalog(getBasStorages);
    return { options: storagesToOptions(res.items), error: res.error };
  }
  if (kind === "fields") {
    const res = await loadBasCatalog(getBasFields);
    return { options: fieldsToOptions(res.items), error: res.error };
  }
  if (kind === "machinery") {
    const res = await loadBasCatalog(getBasMachinery);
    return { options: machineryToOptions(res.items), error: res.error };
  }
  // Номенклатура велика — беремо лише не-папки, далі обрізаємо на UI
  const res = await loadBasCatalog(async () => {
    const all = await getBasNomenclature();
    return all.filter((i) => !i.IsFolder && !i.DeletionMark).slice(0, 1500);
  });
  return { options: nomenclatureToOptions(res.items), error: res.error };
}

/** Лише локальні рядки (швидко) — для миттєвого показу при зміні вкладки. */
export async function loadMappingLocalRows(
  kind: MappingCatalogKind
): Promise<ActionResult<{ rows: MappingLocalRow[] }>> {
  try {
    const rows = await loadLocalRows(kind);
    return { ok: true, data: { rows } };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error ? err.message : "Не вдалося завантажити список",
    };
  }
}

/** Довідник BAS AGRO (важкий GET) — викликати після debounce. */
export async function loadMappingBasOptions(
  kind: MappingCatalogKind
): Promise<ActionResult<{ options: BasSelectOption[]; error: string | null }>> {
  try {
    const bas = await loadBasOptions(kind);
    return { ok: true, data: { options: bas.options, error: bas.error } };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : "Не вдалося прочитати довідник BAS AGRO",
    };
  }
}

/** Ліниве завантаження одного довідника мапінгу (не блокує /accounting). */
export async function loadMappingCatalog(
  kind: MappingCatalogKind
): Promise<
  ActionResult<{
    rows: MappingLocalRow[];
    options: BasSelectOption[];
    error: string | null;
  }>
> {
  try {
    const [rows, bas] = await Promise.all([
      loadLocalRows(kind),
      loadBasOptions(kind),
    ]);
    return {
      ok: true,
      data: { rows, options: bas.options, error: bas.error },
    };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error ? err.message : "Не вдалося завантажити мапінг",
    };
  }
}

/** Збереження акта послуг з картки LEVADIUS → accounting_acts */
export async function executeServiceActSaveAction(input: {
  previewId?: string | null;
  actNumber?: string | null;
  actDate?: string | null;
  contractorName: string;
  contractorEdrpou?: string | null;
  category?: string | null;
  totalAmount?: number | null;
  vatAmount?: number | null;
  targetAssetHint?: string | null;
  equipmentId?: string | null;
  linkEquipment?: boolean;
  notes?: string | null;
  services: {
    name: string;
    quantity?: number | null;
    unit?: string | null;
    pricePerUnit?: number | null;
    totalAmount?: number | null;
  }[];
  /** Скан/фото акта (base64 без data: префікса) */
  attachment?: {
    fileName: string;
    mimeType: string;
    base64: string;
  } | null;
  /** Кілька сканів (пріоритетніше за attachment) */
  attachments?: Array<{
    fileName: string;
    mimeType: string;
    base64: string;
  }> | null;
}) {
  const { revalidatePath } = await import("next/cache");
  const { executeServiceActSave } = await import("@/lib/agent-service-act");
  const result = await executeServiceActSave(input);
  if (!result.success) return result;

  const docs =
    input.attachments?.filter((a) => a?.base64) ??
    (input.attachment?.base64 ? [input.attachment] : []);

  if (docs.length > 0) {
    try {
      const { uploadOperationAttachment } = await import(
        "@/lib/operation-attachments"
      );
      for (const doc of docs) {
        const bytes = Buffer.from(doc.base64, "base64");
        await uploadOperationAttachment({
          entityType: "accounting_act",
          entityId: result.actId,
          fileName: doc.fileName || "akt.jpg",
          mimeType: doc.mimeType || "image/jpeg",
          bytes,
        });
      }
    } catch (err) {
      console.error("[executeServiceActSaveAction] attachment", err);
    }
  }

  revalidatePath("/accounting");
  revalidatePath("/equipment");
  revalidatePath("/");
  return result;
}

/** Прикріпити скан(и) до вже збереженого акта. */
export async function attachServiceActDocumentsAction(input: {
  actId: string;
  attachments: Array<{
    fileName: string;
    mimeType: string;
    base64: string;
  }>;
}) {
  const actId = input.actId?.trim();
  const docs = (input.attachments ?? []).filter((a) => a?.base64);
  if (!actId || docs.length === 0) {
    return { ok: false as const, error: "Немає акта або файлу" };
  }
  try {
    const {
      countAttachments,
      uploadOperationAttachment,
      MAX_ATTACHMENTS_PER_ENTITY,
    } = await import("@/lib/operation-attachments");
    for (const doc of docs) {
      const existing = await countAttachments("accounting_act", actId);
      if (existing >= MAX_ATTACHMENTS_PER_ENTITY) break;
      const bytes = Buffer.from(doc.base64, "base64");
      const res = await uploadOperationAttachment({
        entityType: "accounting_act",
        entityId: actId,
        fileName: doc.fileName || "akt.jpg",
        mimeType: doc.mimeType || "image/jpeg",
        bytes,
      });
      if (!res.ok) return { ok: false as const, error: res.error };
    }
    return { ok: true as const };
  } catch (err) {
    return {
      ok: false as const,
      error:
        err instanceof Error ? err.message : "Не вдалося прикріпити файл",
    };
  }
}

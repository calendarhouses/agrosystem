/**
 * Акти виконаних послуг (LEVADIUS Vision) → accounting_acts + equipment_expenses.
 */

import { createServiceSupabase } from "@/lib/supabase/server";
import { todayKyivYmd } from "@/lib/kyiv-date";

export const SERVICE_ACT_CATEGORIES = [
  "Сервіс техніки",
  "Логістика",
  "Польові послуги",
  "Адміністративні",
] as const;

export type ServiceActCategory = (typeof SERVICE_ACT_CATEGORIES)[number];

export type ServiceActLineInput = {
  name: string;
  quantity?: number | null;
  unit?: string | null;
  pricePerUnit?: number | null;
  totalAmount?: number | null;
};

export type ServiceActInput = {
  actNumber?: string | null;
  actDate?: string | null;
  contractorName: string;
  contractorEdrpou?: string | null;
  services: ServiceActLineInput[];
  totalAmount?: number | null;
  vatAmount?: number | null;
  category?: ServiceActCategory | string | null;
  targetAssetHint?: string | null;
  equipmentId?: string | null;
  linkEquipment?: boolean;
  notes?: string | null;
};

export type ServiceActPreviewLine = {
  lineId: string;
  name: string;
  quantity: number;
  unit: string;
  pricePerUnit: number;
  totalAmount: number;
};

export type ServiceActPreviewResult = {
  status: "service_act_preview_ready";
  previewId: string;
  actNumber: string | null;
  actDate: string | null;
  contractorName: string;
  contractorEdrpou: string | null;
  category: ServiceActCategory;
  services: ServiceActPreviewLine[];
  totalAmount: number;
  vatAmount: number | null;
  targetAssetHint: string | null;
  matchedEquipment: {
    id: string;
    name: string;
    type: string | null;
  } | null;
  equipmentCandidates: { id: string; name: string; type: string | null }[];
  suggestLinkEquipment: boolean;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function normalizeText(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase("uk-UA")
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ");
}

function isServiceActCategory(value: unknown): value is ServiceActCategory {
  return (
    typeof value === "string" &&
    (SERVICE_ACT_CATEGORIES as readonly string[]).includes(value)
  );
}

const REPAIR_HINT_RE =
  /ремонт|сервіс|техніка|трактор|навантажувач|комбайн|обприскувач|телескоп|jcb|manitou|dieci|мерло|клоас|john\s*deere|fendt|case|new\s*holland|запчасти|то\b|техобслуг/i;

const LOGISTICS_HINT_RE =
  /логістик|перевезен|доставк|нова\s*пошт|вантаж|транспортн|експедиц/i;

const FIELD_HINT_RE =
  /оранк|культивац|посів|обприск|дискуван|лущен|збиран|комбайн(уван)?|поле|га\b|гектар|внесенн/i;

export function inferServiceActCategory(input: {
  category?: string | null;
  contractorName?: string | null;
  services: { name: string }[];
  targetAssetHint?: string | null;
}): ServiceActCategory {
  if (isServiceActCategory(input.category)) return input.category;

  const blob = [
    input.category,
    input.contractorName,
    input.targetAssetHint,
    ...input.services.map((s) => s.name),
  ]
    .filter(Boolean)
    .join(" ");

  if (REPAIR_HINT_RE.test(blob) || input.targetAssetHint?.trim()) {
    return "Сервіс техніки";
  }
  if (LOGISTICS_HINT_RE.test(blob)) return "Логістика";
  if (FIELD_HINT_RE.test(blob)) return "Польові послуги";
  return "Адміністративні";
}

function scoreEquipmentMatch(
  hint: string,
  name: string,
  fullName: string | null
): number {
  const h = normalizeText(hint);
  const n = normalizeText(name);
  const f = normalizeText(fullName || "");
  if (!h || !n) return 0;
  if (n === h || f === h) return 100;
  if (n.includes(h) || h.includes(n)) return 80;
  if (f.includes(h) || (f && h.includes(f))) return 70;

  const hintTokens = h.split(" ").filter((t) => t.length > 2);
  const nameTokens = new Set(
    `${n} ${f}`
      .split(" ")
      .filter((t) => t.length > 2)
  );
  let hits = 0;
  for (const token of hintTokens) {
    if (nameTokens.has(token)) hits += 1;
    else if ([...nameTokens].some((t) => t.includes(token) || token.includes(t))) {
      hits += 0.5;
    }
  }
  if (hintTokens.length === 0) return 0;
  return Math.round((hits / hintTokens.length) * 60);
}

async function matchEquipment(hint: string | null | undefined): Promise<{
  matched: { id: string; name: string; type: string | null } | null;
  candidates: { id: string; name: string; type: string | null }[];
}> {
  const needle = hint?.trim() || "";
  if (!needle) return { matched: null, candidates: [] };

  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from("equipment")
    .select("id, name, full_name, type, is_active")
    .eq("is_active", true)
    .order("name")
    .limit(300);

  if (error || !data?.length) return { matched: null, candidates: [] };

  const scored = data
    .map((row) => {
      const name = String(row.name ?? "").trim() || "Техніка";
      const fullName =
        typeof row.full_name === "string" ? row.full_name : null;
      const score = scoreEquipmentMatch(needle, name, fullName);
      return {
        id: String(row.id),
        name,
        type: typeof row.type === "string" ? row.type : null,
        score,
      };
    })
    .filter((row) => row.score >= 35)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "uk"));

  const candidates = scored.slice(0, 5).map(({ id, name, type }) => ({
    id,
    name,
    type,
  }));
  const best = scored[0];
  const matched =
    best && best.score >= 55
      ? { id: best.id, name: best.name, type: best.type }
      : null;

  return { matched, candidates };
}

export async function buildServiceActPreview(
  input: ServiceActInput
): Promise<
  ServiceActPreviewResult | { status: "error"; error: string }
> {
  const contractorName =
    input.contractorName?.trim() || "Виконавець";
  const servicesRaw = Array.isArray(input.services) ? input.services : [];
  if (servicesRaw.length === 0) {
    return { status: "error", error: "В акті немає рядків послуг." };
  }

  const services: ServiceActPreviewLine[] = servicesRaw.map((raw, index) => {
    const name = String(raw.name ?? "").trim() || `Послуга ${index + 1}`;
    const quantity =
      raw.quantity != null && Number.isFinite(Number(raw.quantity))
        ? Number(raw.quantity)
        : 1;
    const price =
      raw.pricePerUnit != null && Number.isFinite(Number(raw.pricePerUnit))
        ? Number(raw.pricePerUnit)
        : 0;
    const total =
      raw.totalAmount != null && Number.isFinite(Number(raw.totalAmount))
        ? round2(Number(raw.totalAmount))
        : round2(quantity * price);
    return {
      lineId: `svc-${index + 1}`,
      name,
      quantity: quantity > 0 ? quantity : 1,
      unit: String(raw.unit ?? "послуга").trim() || "послуга",
      pricePerUnit: price,
      totalAmount: total,
    };
  });

  const computedTotal = round2(
    services.reduce((sum, line) => sum + line.totalAmount, 0)
  );
  const totalAmount =
    input.totalAmount != null && Number.isFinite(Number(input.totalAmount))
      ? round2(Number(input.totalAmount))
      : computedTotal;
  const vatAmount =
    input.vatAmount != null && Number.isFinite(Number(input.vatAmount))
      ? round2(Number(input.vatAmount))
      : null;

  const category = inferServiceActCategory({
    category: input.category,
    contractorName,
    services,
    targetAssetHint: input.targetAssetHint,
  });

  let targetAssetHint = input.targetAssetHint?.trim() || null;
  if (!targetAssetHint && category === "Сервіс техніки") {
    const fromLines = services
      .map((s) => s.name)
      .find((name) => REPAIR_HINT_RE.test(name));
    targetAssetHint = fromLines?.trim() || null;
  }

  const { matched, candidates } = await matchEquipment(
    targetAssetHint ||
      (category === "Сервіс техніки" ? services.map((s) => s.name).join(" ") : null)
  );

  // Явний equipmentId з вводу має пріоритет
  let matchedEquipment = matched;
  if (input.equipmentId?.trim()) {
    const supabase = createServiceSupabase();
    const { data } = await supabase
      .from("equipment")
      .select("id, name, type")
      .eq("id", input.equipmentId.trim())
      .maybeSingle();
    if (data) {
      matchedEquipment = {
        id: String(data.id),
        name: String(data.name ?? "Техніка"),
        type: typeof data.type === "string" ? data.type : null,
      };
    }
  }

  return {
    status: "service_act_preview_ready",
    previewId: crypto.randomUUID(),
    actNumber: input.actNumber?.trim() || null,
    actDate: (input.actDate?.trim() || todayKyivYmd()).slice(0, 10),
    contractorName,
    contractorEdrpou: input.contractorEdrpou?.trim() || null,
    category,
    services,
    totalAmount,
    vatAmount,
    targetAssetHint,
    matchedEquipment,
    equipmentCandidates: candidates,
    suggestLinkEquipment:
      category === "Сервіс техніки" && matchedEquipment != null,
  };
}

export async function executeServiceActSave(
  input: ServiceActInput & { previewId?: string | null }
): Promise<
  | {
      success: true;
      status: "posted";
      actId: string;
      actNumber: string | null;
      contractorName: string;
      category: ServiceActCategory;
      totalAmount: number;
      equipmentId: string | null;
      equipmentName: string | null;
      expenseId: string | null;
      message: string;
    }
  | { success: false; status: "error"; error: string }
> {
  const preview = await buildServiceActPreview(input);
  if (preview.status === "error") {
    return { success: false, status: "error", error: preview.error };
  }

  const wantLink = input.linkEquipment !== false;
  const equipmentId = wantLink
    ? input.equipmentId?.trim() || preview.matchedEquipment?.id || null
    : null;
  const equipmentName = equipmentId
    ? preview.matchedEquipment?.id === equipmentId
      ? preview.matchedEquipment.name
      : preview.equipmentCandidates.find((c) => c.id === equipmentId)?.name ||
        preview.matchedEquipment?.name ||
        null
    : null;

  const supabase = createServiceSupabase();
  const actId = input.previewId?.trim() || preview.previewId;

  const { error: insertError } = await supabase.from("accounting_acts").insert({
    id: actId,
    act_number: preview.actNumber,
    act_date: preview.actDate,
    contractor_name: preview.contractorName,
    contractor_edrpou: preview.contractorEdrpou,
    category: preview.category,
    total_amount: preview.totalAmount,
    vat_amount: preview.vatAmount,
    services: preview.services,
    equipment_id: equipmentId,
    equipment_name_hint: preview.targetAssetHint,
    status: "posted",
    source: "levadius",
    notes: input.notes?.trim() || null,
  });

  if (insertError) {
    if (
      insertError.code === "PGRST205" ||
      insertError.code === "42P01" ||
      insertError.message?.includes("accounting_acts")
    ) {
      return {
        success: false,
        status: "error",
        error:
          "Таблиця accounting_acts ще не створена. Виконай міграцію 063 у Supabase.",
      };
    }
    return {
      success: false,
      status: "error",
      error: `Не вдалося зберегти акт: ${insertError.message}`,
    };
  }

  let expenseId: string | null = null;
  if (equipmentId && preview.totalAmount > 0) {
    const { data: expenseRow, error: expenseError } = await supabase
      .from("equipment_expenses")
      .insert({
        equipment_id: equipmentId,
        amount_uah: preview.totalAmount,
        expense_date: preview.actDate,
        category: preview.category,
        description: [
          preview.contractorName,
          preview.actNumber ? `акт №${preview.actNumber}` : null,
          preview.services
            .slice(0, 3)
            .map((s) => s.name)
            .join("; "),
        ]
          .filter(Boolean)
          .join(" · "),
        accounting_act_id: actId,
        source: "levadius",
      })
      .select("id")
      .maybeSingle();

    if (
      expenseError &&
      expenseError.code !== "PGRST205" &&
      expenseError.code !== "42P01" &&
      !expenseError.message?.includes("equipment_expenses")
    ) {
      console.error("[executeServiceActSave] equipment_expenses", expenseError);
    } else if (expenseRow?.id) {
      expenseId = String(expenseRow.id);
    }
  }

  return {
    success: true,
    status: "posted",
    actId,
    actNumber: preview.actNumber,
    contractorName: preview.contractorName,
    category: preview.category,
    totalAmount: preview.totalAmount,
    equipmentId,
    equipmentName,
    expenseId,
    message: `Акт${
      preview.actNumber ? ` №${preview.actNumber}` : ""
    } записано в Бухгалтерію (${preview.totalAmount.toLocaleString("uk-UA", {
      maximumFractionDigits: 2,
    })} ₴)${
      equipmentName ? ` · витрата на «${equipmentName}»` : ""
    }.`,
  };
}

export type ServiceActDeleteTarget = {
  id: string;
  actNumber: string | null;
  contractorName: string;
  totalAmount: number;
  actDate: string | null;
};

export async function deleteServiceActs(input: {
  actIds?: string[] | null;
  count?: number | null;
  contractorHint?: string | null;
  confirmed?: boolean | null;
}): Promise<
  | {
      status: "requires_confirmation";
      actIds: string[];
      acts: ServiceActDeleteTarget[];
      userHint: string;
      warning: string;
      confirmChoice: string;
      cancelChoice: string;
    }
  | {
      success: true;
      status: "deleted";
      deletedCount: number;
      deletedActs: ServiceActDeleteTarget[];
      message: string;
    }
  | { success: false; status: "error"; error: string }
> {
  const supabase = createServiceSupabase();
  const confirmed = input.confirmed === true;
  const explicitIds = [
    ...new Set(
      (input.actIds ?? [])
        .map((id) => String(id ?? "").trim())
        .filter(Boolean)
    ),
  ];
  const countRaw = input.count != null ? Number(input.count) : 1;
  const count =
    Number.isFinite(countRaw) && countRaw > 0
      ? Math.min(Math.trunc(countRaw), 20)
      : 1;
  const contractorHint = input.contractorHint?.trim() || null;

  type ActRow = {
    id: string;
    act_number: string | null;
    contractor_name: string | null;
    total_amount: number | string | null;
    act_date: string | null;
    created_at?: string | null;
    status?: string | null;
  };

  let rows: ActRow[] = [];

  if (explicitIds.length > 0) {
    const { data, error } = await supabase
      .from("accounting_acts")
      .select(
        "id, act_number, contractor_name, total_amount, act_date, created_at, status"
      )
      .in("id", explicitIds)
      .neq("status", "cancelled");
    if (error) {
      if (
        error.code === "PGRST205" ||
        error.code === "42P01" ||
        error.message?.includes("accounting_acts")
      ) {
        return {
          success: false,
          status: "error",
          error:
            "Таблиця accounting_acts ще не створена. Виконай міграцію 063 у Supabase.",
        };
      }
      return { success: false, status: "error", error: error.message };
    }
    rows = (data ?? []) as ActRow[];
  } else {
    let q = supabase
      .from("accounting_acts")
      .select(
        "id, act_number, contractor_name, total_amount, act_date, created_at, status"
      )
      .neq("status", "cancelled")
      .order("created_at", { ascending: false })
      .limit(contractorHint ? Math.max(count * 8, 20) : count);

    if (contractorHint) {
      q = q.ilike("contractor_name", `%${contractorHint}%`);
    }

    const { data, error } = await q;
    if (error) {
      if (
        error.code === "PGRST205" ||
        error.code === "42P01" ||
        error.message?.includes("accounting_acts")
      ) {
        return {
          success: false,
          status: "error",
          error:
            "Таблиця accounting_acts ще не створена. Виконай міграцію 063 у Supabase.",
        };
      }
      return { success: false, status: "error", error: error.message };
    }
    rows = ((data ?? []) as ActRow[]).slice(0, count);
  }

  const acts: ServiceActDeleteTarget[] = rows.map((row) => ({
    id: String(row.id),
    actNumber:
      typeof row.act_number === "string" && row.act_number.trim()
        ? row.act_number.trim()
        : null,
    contractorName:
      typeof row.contractor_name === "string" && row.contractor_name.trim()
        ? row.contractor_name.trim()
        : "Виконавець",
    totalAmount:
      row.total_amount != null && Number.isFinite(Number(row.total_amount))
        ? Number(row.total_amount)
        : 0,
    actDate:
      typeof row.act_date === "string" && row.act_date
        ? row.act_date.slice(0, 10)
        : null,
  }));

  if (acts.length === 0) {
    return {
      success: false,
      status: "error",
      error: contractorHint
        ? `Не знайшов актів за контрагентом «${contractorHint}».`
        : "Немає актів послуг для видалення.",
    };
  }

  const targetIds = acts.map((a) => a.id);
  const confirmChoice = "Так, видалити ці акти";
  const cancelChoice = "Скасувати";

  if (!confirmed) {
    const listHint = acts
      .map((a) => {
        const num = a.actNumber ? `№${a.actNumber}` : "без номера";
        const sum = a.totalAmount.toLocaleString("uk-UA", {
          maximumFractionDigits: 2,
        });
        return `${num} — ${a.contractorName} — ${sum} ₴`;
      })
      .join("; ");
    return {
      status: "requires_confirmation",
      actIds: targetIds,
      acts,
      userHint: `Видалити наступні акти з Бухгалтерії? ${listHint}`,
      warning:
        "Видалення безповоротне: акти зникнуть із черги Бухгалтерії (і повʼязані витрати по техніці).",
      confirmChoice,
      cancelChoice,
    };
  }

  const { error: delError } = await supabase
    .from("accounting_acts")
    .delete()
    .in("id", targetIds);

  if (delError) {
    return {
      success: false,
      status: "error",
      error: `Не вдалося видалити акти: ${delError.message}`,
    };
  }

  return {
    success: true,
    status: "deleted",
    deletedCount: targetIds.length,
    deletedActs: acts,
    message: `Видалено ${targetIds.length} ${
      targetIds.length === 1 ? "акт" : targetIds.length < 5 ? "акти" : "актів"
    } з Бухгалтерії.`,
  };
}

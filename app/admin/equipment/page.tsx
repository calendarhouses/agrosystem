import type { Metadata } from "next";
import { Wrench } from "lucide-react";

import { EquipmentAdmin } from "@/components/admin/equipment-admin";
import { PageHeader } from "@/components/layout/page-header";
import { createServiceSupabase } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Техніка та обладнання",
};

export const dynamic = "force-dynamic";

export type EquipmentRow = {
  id: string;
  bas_ref_key: string;
  name: string;
  full_name: string | null;
  code: string | null;
  type: string;
  wialon_id: number | null;
  wialon_name: string | null;
  has_tracker: boolean;
  is_active: boolean;
  fuel_tank_volume: number | null;
  /** field | base | null — категорія для бухгалтерії */
  work_scope: "field" | "base" | null;
};

export type ImplementRow = {
  id: string;
  bas_ref_key: string;
  name: string;
  full_name: string | null;
  code: string | null;
  type: string;
  working_width_m: number;
};

async function fetchWialonUnits(): Promise<{ id: number; name: string }[]> {
  const token = process.env.WIALON_API_TOKEN?.trim();
  if (!token) return [];
  try {
    const base = "https://hst-api.wialon.com/wialon/ajax.html";
    const loginRes = await fetch(
      `${base}?svc=token/login&params=${encodeURIComponent(JSON.stringify({ token }))}`,
      { cache: "no-store" }
    );
    const login = await loginRes.json();
    if (!login.eid) return [];

    const params = {
      spec: {
        itemsType: "avl_unit",
        propName: "sys_name",
        propValueMask: "*",
        sortType: "sys_name",
        propType: "property",
      },
      force: 1,
      flags: 0x1,
      from: 0,
      to: 0,
    };
    const res = await fetch(
      `${base}?svc=core/search_items&params=${encodeURIComponent(JSON.stringify(params))}&sid=${login.eid}`,
      { cache: "no-store" }
    );
    const data = await res.json();
    return (data.items ?? []).map((u: { id: number; nm: string }) => ({
      id: u.id,
      name: u.nm,
    }));
  } catch {
    return [];
  }
}

export default async function EquipmentPage() {
  const supabase = createServiceSupabase();

  const equipmentQuery = await supabase
    .from("equipment")
    .select(
      "id,bas_ref_key,name,full_name,code,type,wialon_id,wialon_name,has_tracker,is_active,fuel_tank_volume,work_scope"
    )
    .order("name");

  let equipmentData: Record<string, unknown>[] | null = equipmentQuery.data as
    | Record<string, unknown>[]
    | null;
  let equipmentError = equipmentQuery.error;

  if (equipmentError && equipmentError.message?.includes("work_scope")) {
    const fallback = await supabase
      .from("equipment")
      .select(
        "id,bas_ref_key,name,full_name,code,type,wialon_id,wialon_name,has_tracker,is_active,fuel_tank_volume"
      )
      .order("name");
    equipmentData = (fallback.data as Record<string, unknown>[] | null) ?? null;
    equipmentError = fallback.error;
  }

  if (equipmentError) {
    throw new Error(equipmentError.message);
  }

  const [{ data: implements_ }, wialonUnits] = await Promise.all([
    supabase
      .from("implements")
      .select("id,bas_ref_key,name,full_name,code,type,working_width_m")
      .order("name"),
    fetchWialonUnits(),
  ]);

  const equipmentRows: EquipmentRow[] = (equipmentData ?? []).map((row) => {
    const r = row as Record<string, unknown>;
    return {
      id: String(r.id),
      bas_ref_key: String(r.bas_ref_key),
      name: String(r.name),
      full_name: r.full_name != null ? String(r.full_name) : null,
      code: r.code != null ? String(r.code) : null,
      type: String(r.type ?? "other"),
      wialon_id:
        r.wialon_id != null && Number.isFinite(Number(r.wialon_id))
          ? Number(r.wialon_id)
          : null,
      wialon_name: r.wialon_name != null ? String(r.wialon_name) : null,
      has_tracker: Boolean(r.has_tracker),
      is_active: r.is_active !== false,
      fuel_tank_volume:
        r.fuel_tank_volume != null &&
        Number.isFinite(Number(r.fuel_tank_volume))
          ? Number(r.fuel_tank_volume)
          : null,
      work_scope:
        r.work_scope === "field" || r.work_scope === "base"
          ? r.work_scope
          : null,
    };
  });

  return (
    <main className="mx-auto h-full w-full max-w-7xl overflow-y-auto overscroll-none px-4 pt-3 pb-6 sm:px-6 lg:px-8">
      <PageHeader
        icon={Wrench}
        title="Техніка та обладнання"
        description="Синхронізація з BAS AGRO та Wialon"
      />
      <div className="mt-6">
        <EquipmentAdmin
          equipment={equipmentRows}
          implements_={(implements_ ?? []).map((row) => ({
            ...(row as ImplementRow),
            working_width_m: Number((row as ImplementRow).working_width_m) || 0,
          }))}
          wialonUnits={wialonUnits}
        />
      </div>
    </main>
  );
}

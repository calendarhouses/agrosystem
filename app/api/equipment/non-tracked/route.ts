import { NextResponse } from "next/server";

import { isSelfPropelledEquipmentType } from "@/lib/equipment-fleet";
import { createServiceSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET() {
  try {
    const supabase = createServiceSupabase();
    const { data, error } = await supabase
      .from("equipment")
      .select("id,name,type,code,is_active")
      .is("wialon_id", null)
      .eq("is_active", true)
      .order("name");

    if (error) {
      return NextResponse.json({ items: [], error: error.message }, { status: 500 });
    }

    const items = (data ?? []).filter((row) =>
      isSelfPropelledEquipmentType(String(row.type ?? "other"))
    );

    return NextResponse.json({ items });
  } catch (err) {
    return NextResponse.json(
      { items: [], error: err instanceof Error ? err.message : "error" },
      { status: 500 }
    );
  }
}

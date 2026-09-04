import { NextResponse } from "next/server";

import { canAccessLevadius } from "@/lib/levadius-access";
import { normalizeSeason } from "@/lib/season";
import { createAuthServerSupabase } from "@/lib/supabase/auth-server";
import { createServiceSupabase } from "@/lib/supabase/server";
import { resolveUnitPriceOrZero } from "@/lib/field-analytics";

export const runtime = "nodejs";

function csvCell(value: string | number | null | undefined): string {
  const raw = value == null ? "" : String(value);
  if (/[;"\n\r]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

function csvRow(cells: Array<string | number | null | undefined>): string {
  return cells.map(csvCell).join(";");
}

/**
 * GET /api/export/field?id=<uuid>&season=2026
 * CSV-історія поля: наряди + ТМЦ + паливо Wialon.
 */
export async function GET(request: Request) {
  try {
    const auth = await createAuthServerSupabase();
    const {
      data: { user },
    } = await auth.auth.getUser();
    if (
      !user ||
      !canAccessLevadius({ id: user.id, email: user.email ?? null })
    ) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(request.url);
    const fieldId = url.searchParams.get("id")?.trim() || "";
    const season = normalizeSeason(
      url.searchParams.get("season") || new Date().getFullYear()
    );

    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        fieldId
      )
    ) {
      return NextResponse.json({ error: "Некоректний id поля" }, { status: 400 });
    }

    const supabase = createServiceSupabase();
    const { data: field, error: fieldError } = await supabase
      .from("farm_fields")
      .select("id, name, canonical_name, crop, area_ha, season")
      .eq("id", fieldId)
      .maybeSingle();

    if (fieldError || !field) {
      return NextResponse.json({ error: "Поле не знайдено" }, { status: 404 });
    }

    const fieldName =
      (field.canonical_name && String(field.canonical_name).trim()) ||
      String(field.name ?? "Поле");
    const fieldKey = `farm:${fieldId}`;
    const seasonYear = Number(season) || new Date().getFullYear();
    const seasonStart = `${seasonYear}-01-01`;
    const seasonEnd = `${seasonYear}-12-31`;

    const [opsRes, movesRes, fuelRes] = await Promise.all([
      supabase
        .from("field_operations")
        .select(
          "occurred_at, work_type, status, area_fact, area_plan, machinery, implement, mechanic_name, fuel_fact, wage_fact"
        )
        .or(`field_id.eq.${fieldId},field_key.eq.${fieldKey}`)
        .gte("occurred_at", seasonStart)
        .lte("occurred_at", `${seasonEnd}T23:59:59.999Z`)
        .neq("status", "cancelled")
        .order("occurred_at", { ascending: true })
        .limit(2000),
      supabase
        .from("inventory_local_moves")
        .select(
          `
          date, qty, type, status,
          inventory_items_cache (
            name, custom_name, unit, category, planned_price_uah, unit_cost
          )
        `
        )
        .eq("field_id", fieldId)
        .eq("season", season)
        .order("date", { ascending: true })
        .limit(2000),
      supabase
        .from("wialon_field_fuel_logs")
        .select("date, fuel_consumed, equipment_id")
        .eq("field_id", fieldId)
        .gte("date", seasonStart)
        .lte("date", seasonEnd)
        .order("date", { ascending: true })
        .limit(2000),
    ]);

    const lines: string[] = [];
    lines.push(
      csvRow([
        "Тип",
        "Дата",
        "Опис",
        "Статус",
        "Площа_га",
        "Кількість",
        "Од",
        "Ціна_₴",
        "Сума_₴",
        "Техніка",
        "Знаряддя",
        "Механізатор",
      ])
    );

    for (const op of opsRes.data ?? []) {
      const area =
        Number(op.area_fact) > 0 ? Number(op.area_fact) : Number(op.area_plan) || 0;
      lines.push(
        csvRow([
          "Наряд",
          String(op.occurred_at ?? "").slice(0, 10),
          String(op.work_type ?? ""),
          String(op.status ?? ""),
          area || "",
          op.fuel_fact != null ? Number(op.fuel_fact) : "",
          op.fuel_fact != null ? "л" : "",
          "",
          op.wage_fact != null ? Number(op.wage_fact) : "",
          String(op.machinery ?? ""),
          String(op.implement ?? ""),
          String(op.mechanic_name ?? ""),
        ])
      );
    }

    for (const move of movesRes.data ?? []) {
      const cacheRaw = move.inventory_items_cache;
      const cache = Array.isArray(cacheRaw) ? cacheRaw[0] : cacheRaw;
      const name =
        (cache &&
          ((cache as { custom_name?: string }).custom_name ||
            (cache as { name?: string }).name)) ||
        "ТМЦ";
      const unit = cache ? String((cache as { unit?: string }).unit ?? "") : "";
      const price = resolveUnitPriceOrZero({
        planned_price_uah: cache
          ? ((cache as { planned_price_uah?: number }).planned_price_uah ?? null)
          : null,
        unit_cost: cache
          ? ((cache as { unit_cost?: number }).unit_cost ?? null)
          : null,
      });
      const qty = Number(move.qty) || 0;
      lines.push(
        csvRow([
          "ТМЦ",
          String(move.date ?? "").slice(0, 10),
          String(name),
          String(move.status ?? move.type ?? ""),
          "",
          qty,
          unit,
          price || "",
          price > 0 ? Math.round(qty * price * 100) / 100 : "",
          "",
          "",
          "",
        ])
      );
    }

    for (const fuel of fuelRes.data ?? []) {
      const liters = Number(fuel.fuel_consumed) || 0;
      lines.push(
        csvRow([
          "Паливо_Wialon",
          String(fuel.date ?? "").slice(0, 10),
          "Спалено на полі",
          "",
          "",
          liters,
          "л",
          "",
          "",
          fuel.equipment_id ? String(fuel.equipment_id) : "",
          "",
          "",
        ])
      );
    }

    const bom = "\uFEFF";
    const body = bom + lines.join("\r\n") + "\r\n";
    const safeName = fieldName.replace(/[^\p{L}\p{N}_-]+/gu, "_").slice(0, 40);
    const filename = `field_${safeName}_${season}.csv`;

    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Помилка експорту поля",
      },
      { status: 500 }
    );
  }
}

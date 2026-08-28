import { NextRequest, NextResponse } from "next/server";

import { syncInventoryNomenclatureAction } from "@/app/admin/inventory/actions";

export const runtime = "nodejs";
export const maxDuration = 300;

const JSON_UTF8 = {
  "Content-Type": "application/json; charset=utf-8",
} as const;

function authorizeCron(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    console.error("[cron/sync-inventory-nomenclature] CRON_SECRET не задано");
    return false;
  }
  const header = request.headers.get("authorization") ?? "";
  return header === `Bearer ${secret}`;
}

/**
 * GET/POST /api/cron/sync-inventory-nomenclature
 *
 * Синк довідника ТМЦ з BAS → inventory_items_cache (read-only GET у BAS AGRO).
 * Для cronjob.org / Vercel Cron:
 *   Authorization: Bearer $CRON_SECRET
 *
 * Рекомендовано: 1–2 рази на добу (ранком).
 */
async function handle(request: NextRequest) {
  if (!authorizeCron(request)) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401, headers: JSON_UTF8 }
    );
  }

  try {
    const res = await syncInventoryNomenclatureAction();
    if (!res.ok) {
      console.error("[cron/sync-inventory-nomenclature]", res.error);
      return NextResponse.json(
        { ok: false, error: res.error },
        { status: 500, headers: JSON_UTF8 }
      );
    }
    const payload = { ok: true as const, ...res.data };
    console.log("[cron/sync-inventory-nomenclature]", payload);
    return NextResponse.json(payload, { headers: JSON_UTF8 });
  } catch (error) {
    console.error("[cron/sync-inventory-nomenclature]", error);
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Не вдалося синхронізувати номенклатуру",
      },
      { status: 500, headers: JSON_UTF8 }
    );
  }
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}

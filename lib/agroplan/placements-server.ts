import { getCurrentActor } from "@/lib/app-actor";
import { createServiceSupabase } from "@/lib/supabase/server";

export type AgroplanPlacementRow = {
  blockId: string;
  season: string;
  startMs: number;
  durationHours: number | null;
  hidden: boolean;
  updatedAt: string;
};

export type AgroplanPlacementsMap = Record<
  string,
  {
    startMs: number;
    durationHours?: number;
    hidden?: boolean;
    updatedAt: string;
  }
>;

function rowToPlacement(raw: Record<string, unknown>): AgroplanPlacementRow | null {
  const blockId = String(raw.block_id ?? "").trim();
  const season = String(raw.season ?? "").trim();
  const startMs = Number(raw.start_ms);
  if (!blockId || !season || !Number.isFinite(startMs)) return null;
  const durationRaw = raw.duration_hours;
  const durationHours =
    durationRaw == null || durationRaw === ""
      ? null
      : Number.isFinite(Number(durationRaw))
        ? Number(durationRaw)
        : null;
  return {
    blockId,
    season,
    startMs,
    durationHours,
    hidden: Boolean(raw.hidden),
    updatedAt: String(raw.updated_at ?? new Date().toISOString()),
  };
}

export async function loadAgroplanPlacements(
  season: string
): Promise<AgroplanPlacementsMap> {
  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from("agroplan_placements")
    .select("block_id, season, start_ms, duration_hours, hidden, updated_at")
    .eq("season", season)
    .limit(2000);

  if (error) {
    if (
      error.code === "PGRST205" ||
      error.code === "42P01" ||
      error.message?.includes("agroplan_placements")
    ) {
      return {};
    }
    console.error("[agroplan/placements] load:", error.message);
    return {};
  }

  const out: AgroplanPlacementsMap = {};
  for (const raw of data ?? []) {
    const row = rowToPlacement(raw as Record<string, unknown>);
    if (!row) continue;
    out[row.blockId] = {
      startMs: row.startMs,
      ...(row.durationHours != null ? { durationHours: row.durationHours } : {}),
      ...(row.hidden ? { hidden: true } : {}),
      updatedAt: row.updatedAt,
    };
  }
  return out;
}

export type UpsertAgroplanPlacementInput = {
  blockId: string;
  season: string;
  startMs: number;
  durationHours?: number | null;
  hidden?: boolean;
};

export async function upsertAgroplanPlacements(
  rows: readonly UpsertAgroplanPlacementInput[]
): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  if (rows.length === 0) return { ok: true, count: 0 };

  const supabase = createServiceSupabase();
  const actor = await getCurrentActor();
  const now = new Date().toISOString();

  const payload = rows.map((row) => ({
    block_id: row.blockId,
    season: row.season,
    start_ms: Math.round(row.startMs),
    duration_hours:
      row.durationHours != null && Number.isFinite(row.durationHours)
        ? row.durationHours
        : null,
    hidden: row.hidden === true,
    actor_id: actor?.id ?? null,
    updated_at: now,
  }));

  const { error } = await supabase
    .from("agroplan_placements")
    .upsert(payload, { onConflict: "block_id,season" });

  if (error) {
    if (
      error.code === "PGRST205" ||
      error.code === "42P01" ||
      error.message?.includes("agroplan_placements")
    ) {
      return { ok: false, error: "Таблиця agroplan_placements ще не створена" };
    }
    return { ok: false, error: error.message };
  }

  return { ok: true, count: payload.length };
}

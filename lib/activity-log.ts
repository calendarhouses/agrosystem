/**
 * Журнал дій: хто що зробив у системі.
 */

import type { AppActor, AppRole } from "@/lib/app-actor-shared";
import { createServiceSupabase } from "@/lib/supabase/server";

export type ActivityAction =
  | "create"
  | "update"
  | "delete"
  | "close"
  | "export"
  | "login"
  | "mapping"
  | "sync"
  | "other";

export type LogActivityInput = {
  actor: AppActor;
  action: ActivityAction;
  entityType: string;
  entityId?: string | null;
  summary: string;
  meta?: Record<string, unknown>;
};

export type ActivityLogRow = {
  id: string;
  createdAt: string;
  actorId: string | null;
  actorName: string;
  actorRole: AppRole | null;
  action: string;
  entityType: string;
  entityId: string | null;
  summary: string;
  meta: Record<string, unknown>;
};

/** Не кидає — аудит не повинен ламати основну операцію. */
export async function logActivity(input: LogActivityInput): Promise<void> {
  try {
    const supabase = createServiceSupabase();
    const { error } = await supabase.from("activity_log").insert({
      actor_id: input.actor.id || null,
      actor_name: input.actor.label,
      actor_role: input.actor.role,
      action: input.action,
      entity_type: input.entityType,
      entity_id: input.entityId ?? null,
      summary: input.summary.slice(0, 500),
      meta: input.meta ?? {},
    });
    if (error) {
      console.error("[activity_log]", error.message);
    }
  } catch (err) {
    console.error("[activity_log]", err);
  }
}

export async function listActivityLog(input?: {
  limit?: number;
  entityType?: string;
  entityId?: string;
}): Promise<ActivityLogRow[]> {
  const supabase = createServiceSupabase();
  let q = supabase
    .from("activity_log")
    .select(
      "id, created_at, actor_id, actor_name, actor_role, action, entity_type, entity_id, summary, meta"
    )
    .order("created_at", { ascending: false })
    .limit(Math.min(input?.limit ?? 80, 200));

  if (input?.entityType) q = q.eq("entity_type", input.entityType);
  if (input?.entityId) q = q.eq("entity_id", input.entityId);

  const { data, error } = await q;
  if (error) {
    console.error("[activity_log] list", error.message);
    return [];
  }

  return (data ?? []).map((row) => ({
    id: String(row.id),
    createdAt: String(row.created_at),
    actorId: row.actor_id != null ? String(row.actor_id) : null,
    actorName: String(row.actor_name ?? ""),
    actorRole:
      row.actor_role === "admin" ||
      row.actor_role === "owner" ||
      row.actor_role === "agronomist" ||
      row.actor_role === "accountant"
        ? row.actor_role
        : null,
    action: String(row.action ?? ""),
    entityType: String(row.entity_type ?? ""),
    entityId: row.entity_id != null ? String(row.entity_id) : null,
    summary: String(row.summary ?? ""),
    meta:
      row.meta && typeof row.meta === "object" && !Array.isArray(row.meta)
        ? (row.meta as Record<string, unknown>)
        : {},
  }));
}

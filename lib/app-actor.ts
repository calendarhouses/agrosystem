/**
 * Поточний користувач системи (лише сервер).
 * Для типів / ROLE_LABEL_UK у клієнті — lib/app-actor-shared.ts.
 */

import "server-only";

import {
  formatActorLabel,
  isAppRole,
  type AppActor,
  type AppRole,
} from "@/lib/app-actor-shared";
import { createAuthServerSupabase } from "@/lib/supabase/auth-server";
import { createServiceSupabase } from "@/lib/supabase/server";

export type { AppActor, AppRole } from "@/lib/app-actor-shared";
export {
  ROLE_LABEL_UK,
  formatActorLabel,
  isAppRole,
} from "@/lib/app-actor-shared";

const FALLBACK: AppActor = {
  id: "",
  email: "",
  fullName: "Система",
  role: "admin",
  label: "Система",
};

/**
 * Хто зараз залогінений. Якщо профілю ще немає — будуємо з email/metadata.
 */
export async function getCurrentActor(): Promise<AppActor> {
  try {
    const auth = await createAuthServerSupabase();
    const {
      data: { user },
    } = await auth.auth.getUser();
    if (!user) return { ...FALLBACK, label: "Користувач" };

    const supabase = createServiceSupabase();
    const { data: profile } = await supabase
      .from("profiles")
      .select("id, email, full_name, role")
      .eq("id", user.id)
      .maybeSingle();

    if (profile && isAppRole(profile.role)) {
      const fullName = String(profile.full_name || "").trim() || "Користувач";
      const role = profile.role;
      return {
        id: user.id,
        email: String(profile.email || user.email || ""),
        fullName,
        role,
        label: formatActorLabel(role, fullName),
      };
    }

    const meta = user.user_metadata as Record<string, unknown> | undefined;
    const fullName =
      (typeof meta?.full_name === "string" && meta.full_name.trim()) ||
      (typeof meta?.name === "string" && meta.name.trim()) ||
      user.email?.split("@")[0] ||
      "Користувач";
    const roleFromMeta = meta?.role;
    const role: AppRole = isAppRole(roleFromMeta) ? roleFromMeta : "agronomist";

    return {
      id: user.id,
      email: user.email ?? "",
      fullName,
      role,
      label: formatActorLabel(role, fullName),
    };
  } catch {
    return { ...FALLBACK, label: "Користувач" };
  }
}

/** Поля для insert у таблиці з actor_id / actor_name */
export function actorCreateColumns(actor: AppActor): {
  actor_id: string | null;
  actor_name: string;
} {
  return {
    actor_id: actor.id || null,
    actor_name: actor.label,
  };
}

export function actorUpdateColumns(actor: AppActor): {
  updated_by_id: string | null;
  updated_by_name: string;
} {
  return {
    updated_by_id: actor.id || null,
    updated_by_name: actor.label,
  };
}

export function actorCloseColumns(actor: AppActor): {
  closed_by_id: string | null;
  closed_by_name: string;
} {
  return {
    closed_by_id: actor.id || null,
    closed_by_name: actor.label,
  };
}

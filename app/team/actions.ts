"use server";

import { listActivityLog, type ActivityLogRow } from "@/lib/activity-log";
import { getCurrentActor, type AppActor } from "@/lib/app-actor";
import {
  displayLoginFromEmail,
  normalizeLoginToEmail,
} from "@/lib/login-identity";
import { createAuthServerSupabase } from "@/lib/supabase/auth-server";
import { createServiceSupabase } from "@/lib/supabase/server";

export type ProfileActionResult =
  | { ok: true; login?: string; email?: string }
  | { ok: false; error: string };

export async function getMyProfileAction(): Promise<AppActor | null> {
  const actor = await getCurrentActor();
  if (!actor.id) return null;
  return actor;
}

export async function listRecentActivityAction(input?: {
  limit?: number;
}): Promise<ActivityLogRow[]> {
  return listActivityLog({ limit: input?.limit ?? 60 });
}

/** Оновити логін (Auth email + profiles.email) — діє одразу для наступного входу. */
export async function updateMyLoginAction(
  rawLogin: string
): Promise<ProfileActionResult> {
  const actor = await getCurrentActor();
  if (!actor.id) return { ok: false, error: "Не авторизовано" };

  const email = normalizeLoginToEmail(rawLogin);
  if (!email) return { ok: false, error: "Введіть логін" };
  if (email.length > 120) return { ok: false, error: "Занадто довгий логін" };

  const current = actor.email.trim().toLowerCase();
  if (email === current) {
    return {
      ok: true,
      login: displayLoginFromEmail(email),
      email,
    };
  }

  const service = createServiceSupabase();
  const { data: clash } = await service
    .from("profiles")
    .select("id")
    .ilike("email", email)
    .neq("id", actor.id)
    .maybeSingle();
  if (clash) {
    return { ok: false, error: "Такий логін уже зайнятий" };
  }

  // Service-role: миттєва зміна email без confirmation (локальні логіни команди)
  const { error: authError } = await service.auth.admin.updateUserById(
    actor.id,
    { email, email_confirm: true }
  );
  if (authError) {
    return {
      ok: false,
      error:
        /already|exists|registered/i.test(authError.message)
          ? "Такий логін уже зайнятий"
          : authError.message,
    };
  }

  const { error: profileError } = await service
    .from("profiles")
    .update({ email, updated_at: new Date().toISOString() })
    .eq("id", actor.id);
  if (profileError) {
    return { ok: false, error: profileError.message };
  }

  try {
    const auth = await createAuthServerSupabase();
    await auth.auth.refreshSession();
  } catch {
    /* сесія може лишитись зі старим JWT — auth.users уже з новим email для входу */
  }

  return {
    ok: true,
    login: displayLoginFromEmail(email),
    email,
  };
}

/** Змінити пароль — новий пароль одразу для входу. */
export async function updateMyPasswordAction(
  newPassword: string
): Promise<ProfileActionResult> {
  const actor = await getCurrentActor();
  if (!actor.id) return { ok: false, error: "Не авторизовано" };

  const password = newPassword.trim();
  if (password.length < 8) {
    return { ok: false, error: "Пароль має бути щонайменше 8 символів" };
  }
  if (password.length > 72) {
    return { ok: false, error: "Пароль занадто довгий" };
  }

  const auth = await createAuthServerSupabase();
  const { error } = await auth.auth.updateUser({ password });
  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true };
}

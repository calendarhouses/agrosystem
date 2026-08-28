"use server";

import { redirect } from "next/navigation";

import { logActivity } from "@/lib/activity-log";
import { getCurrentActor } from "@/lib/app-actor";
import { normalizeLoginToEmail } from "@/lib/login-identity";
import { createAuthServerSupabase } from "@/lib/supabase/auth-server";

export type AuthActionResult =
  | { ok: true }
  | { ok: false; error: string };

export async function loginWithPassword(
  login: string,
  password: string
): Promise<AuthActionResult> {
  const email = normalizeLoginToEmail(login);
  if (!email || !password) {
    return { ok: false, error: "Введіть логін і пароль" };
  }

  const supabase = await createAuthServerSupabase();
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    return {
      ok: false,
      error:
        error.message === "Invalid login credentials"
          ? "Невірний логін або пароль"
          : error.message,
    };
  }

  const actor = await getCurrentActor();
  await logActivity({
    actor,
    action: "login",
    entityType: "session",
    entityId: actor.id || null,
    summary: `${actor.label} увійшов у систему`,
  });

  return { ok: true };
}

export async function logoutAction(): Promise<void> {
  const supabase = await createAuthServerSupabase();
  await supabase.auth.signOut();
  redirect("/login");
}

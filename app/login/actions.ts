"use server";

import { redirect } from "next/navigation";

import { createAuthServerSupabase } from "@/lib/supabase/auth-server";

export type AuthActionResult =
  | { ok: true }
  | { ok: false; error: string };

export async function loginWithPassword(
  email: string,
  password: string
): Promise<AuthActionResult> {
  const trimmedEmail = email.trim().toLowerCase();
  if (!trimmedEmail || !password) {
    return { ok: false, error: "Введіть email і пароль" };
  }

  const supabase = await createAuthServerSupabase();
  const { error } = await supabase.auth.signInWithPassword({
    email: trimmedEmail,
    password,
  });

  if (error) {
    return {
      ok: false,
      error:
        error.message === "Invalid login credentials"
          ? "Невірний email або пароль"
          : error.message,
    };
  }

  return { ok: true };
}

export async function logoutAction(): Promise<void> {
  const supabase = await createAuthServerSupabase();
  await supabase.auth.signOut();
  redirect("/login");
}

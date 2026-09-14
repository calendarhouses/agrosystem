/**
 * Хто бачить LEVADIUS (сайдбар / мобільний тригер, /copilot, /api/agent).
 *
 * За замовчуванням — будь-який залогінений акаунт.
 * Обмежити (екстрене): LEVADIUS_ALLOWED_EMAILS=admin@…,other@…
 * (на клієнті — NEXT_PUBLIC_LEVADIUS_ALLOWED_EMAILS з тим самим списком).
 * Значення `*` або `all` у env = усі залогінені (як дефолт).
 */

import {
  displayLoginFromEmail,
  normalizeLoginToEmail,
} from "@/lib/login-identity";

function allowedEntries(): string[] | null {
  const raw =
    (typeof process !== "undefined" &&
      (process.env.NEXT_PUBLIC_LEVADIUS_ALLOWED_EMAILS ||
        process.env.LEVADIUS_ALLOWED_EMAILS)) ||
    "";
  const fromEnv = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (fromEnv.length === 0) return null;
  if (fromEnv.some((e) => e === "*" || e === "all")) return null;
  return fromEnv;
}

export function canAccessLevadius(actor: {
  id?: string | null;
  email?: string | null;
} | null): boolean {
  if (!actor?.id) return false;

  const allowlist = allowedEntries();
  if (!allowlist) return true;

  const email = (actor.email ?? "").trim().toLowerCase();
  if (!email) return false;
  const login = displayLoginFromEmail(email).toLowerCase();
  return allowlist.some((entry) => {
    const asEmail = normalizeLoginToEmail(entry);
    return entry === email || entry === login || asEmail === email;
  });
}

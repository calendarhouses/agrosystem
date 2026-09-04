/**
 * Хто бачить LEVADIUS (FAB, /copilot, /api/agent).
 * За замовчуванням — лише admin (Назар).
 * Розширити: LEVADIUS_ALLOWED_EMAILS=admin@agrosystem.local,other@…
 * (на клієнті — NEXT_PUBLIC_LEVADIUS_ALLOWED_EMAILS з тим самим списком).
 */

import {
  displayLoginFromEmail,
  normalizeLoginToEmail,
} from "@/lib/login-identity";

const DEFAULT_ALLOWED = ["admin@agrosystem.local", "admin"] as const;

function allowedEntries(): string[] {
  const raw =
    (typeof process !== "undefined" &&
      (process.env.NEXT_PUBLIC_LEVADIUS_ALLOWED_EMAILS ||
        process.env.LEVADIUS_ALLOWED_EMAILS)) ||
    "";
  const fromEnv = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return fromEnv.length > 0 ? fromEnv : [...DEFAULT_ALLOWED];
}

export function canAccessLevadius(actor: {
  id?: string | null;
  email?: string | null;
} | null): boolean {
  if (!actor?.id) return false;
  const email = (actor.email ?? "").trim().toLowerCase();
  if (!email) return false;
  const login = displayLoginFromEmail(email).toLowerCase();
  return allowedEntries().some((entry) => {
    const asEmail = normalizeLoginToEmail(entry);
    return entry === email || entry === login || asEmail === email;
  });
}

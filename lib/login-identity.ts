/**
 * Короткі логіни команди → email у Supabase Auth.
 * У формі входу можна писати Owner / Agronomist / Accountant.
 */

export const TEAM_LOGIN_DOMAIN = "agrosystem.local";

/** Короткий логін (без @) → внутрішний email */
export const TEAM_LOGIN_ALIASES: Record<string, string> = {
  owner: `owner@${TEAM_LOGIN_DOMAIN}`,
  agronomist: `agronomist@${TEAM_LOGIN_DOMAIN}`,
  accountant: `accountant@${TEAM_LOGIN_DOMAIN}`,
};

/**
 * «Owner» → owner@agrosystem.local
 * звичайний email лишається як є (для адміна).
 */
export function normalizeLoginToEmail(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return "";
  if (trimmed.includes("@")) return trimmed;
  return TEAM_LOGIN_ALIASES[trimmed] ?? `${trimmed}@${TEAM_LOGIN_DOMAIN}`;
}

/** owner@agrosystem.local → Owner (для UI) */
export function displayLoginFromEmail(email: string): string {
  const lower = email.trim().toLowerCase();
  for (const [alias, full] of Object.entries(TEAM_LOGIN_ALIASES)) {
    if (full === lower) {
      return alias.charAt(0).toUpperCase() + alias.slice(1);
    }
  }
  if (lower.endsWith(`@${TEAM_LOGIN_DOMAIN}`)) {
    const local = lower.slice(0, -(TEAM_LOGIN_DOMAIN.length + 1));
    return local.charAt(0).toUpperCase() + local.slice(1);
  }
  return email;
}

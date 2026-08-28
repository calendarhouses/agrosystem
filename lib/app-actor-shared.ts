/**
 * Типи й лейбли ролей — безпечно для Client Components.
 * Серверний getCurrentActor — у lib/app-actor.ts.
 */

export type AppRole = "admin" | "owner" | "agronomist" | "accountant";

export type AppActor = {
  id: string;
  email: string;
  fullName: string;
  role: AppRole;
  /** Підпис для UI / журналу — лише імʼя, напр. «Юрій» */
  label: string;
};

export const ROLE_LABEL_UK: Record<AppRole, string> = {
  admin: "Адмін",
  owner: "Власник",
  agronomist: "Агроном",
  accountant: "Бухгалтер",
};

export function isAppRole(value: unknown): value is AppRole {
  return (
    value === "admin" ||
    value === "owner" ||
    value === "agronomist" ||
    value === "accountant"
  );
}

/** Підпис у журналах і на операціях — тільки імʼя. */
export function formatActorLabel(_role: AppRole, fullName: string): string {
  return fullName.trim() || "Користувач";
}

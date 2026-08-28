/**
 * Створює / оновлює профілі команди в Supabase Auth + public.profiles.
 *
 * Запуск:
 *   npm run seed:team
 *
 * Логіни (крім адміна): Owner / Agronomist / Accountant
 * Адмін — існуючий email, без змін пароля.
 *
 * Паролі лише з env (див. docs/pc-access.md):
 *   TEAM_OWNER_PASSWORD
 *   TEAM_AGRONOMIST_PASSWORD
 *   TEAM_ACCOUNTANT_PASSWORD
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

import {
  TEAM_LOGIN_ALIASES,
  normalizeLoginToEmail,
} from "../lib/login-identity";

type AppRole = "admin" | "owner" | "agronomist" | "accountant";

type TeamMember = {
  /** Що вводять у формі: Owner або повний email адміна */
  login: string;
  fullName: string;
  role: AppRole;
  bindExistingOnly?: boolean;
  password?: string;
  /** Старі email, які треба прибрати після міграції логінів */
  legacyEmails?: string[];
};

function loadEnvLocal() {
  const path = resolve(process.cwd(), ".env.local");
  if (!existsSync(path)) return;
  const raw = readFileSync(path, "utf8");
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvLocal();

function requireTeamPassword(envKey: string, login: string): string {
  const value = process.env[envKey]?.trim();
  if (!value || value.length < 8) {
    throw new Error(
      `Для seed потрібен ${envKey} (≥8 символів) у .env.local — логін «${login}». Див. docs/pc-access.md`
    );
  }
  return value;
}

const TEAM: TeamMember[] = [
  {
    login: "admin@agrosystem.local",
    fullName: "Назар",
    role: "admin",
    bindExistingOnly: true,
  },
  {
    login: "Owner",
    fullName: "Ігор",
    role: "owner",
    password: requireTeamPassword("TEAM_OWNER_PASSWORD", "Owner"),
    legacyEmails: ["igor@agrosystem.local"],
  },
  {
    login: "Agronomist",
    fullName: "Юрій",
    role: "agronomist",
    password: requireTeamPassword("TEAM_AGRONOMIST_PASSWORD", "Agronomist"),
    legacyEmails: ["yuriy@agrosystem.local"],
  },
  {
    login: "Accountant",
    fullName: "Сергій",
    role: "accountant",
    password: requireTeamPassword("TEAM_ACCOUNTANT_PASSWORD", "Accountant"),
    legacyEmails: ["serhiy@agrosystem.local"],
  },
];

const ROLE_UK: Record<AppRole, string> = {
  admin: "Адмін",
  owner: "Власник",
  agronomist: "Агроном",
  accountant: "Бухгалтер",
};

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceKey) {
    throw new Error(
      "Потрібні NEXT_PUBLIC_SUPABASE_URL і SUPABASE_SERVICE_ROLE_KEY у .env.local"
    );
  }

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: listed, error: listError } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 200,
  });
  if (listError) throw listError;

  const byEmail = new Map(
    (listed.users ?? []).map((u) => [u.email?.toLowerCase() ?? "", u])
  );

  let adminUser = byEmail.get("admin@agrosystem.local");
  if (!adminUser) {
    // існуючий єдиний / перший не-командний акаунт
    const teamEmails = new Set(Object.values(TEAM_LOGIN_ALIASES));
    for (const u of listed.users ?? []) {
      const e = u.email?.toLowerCase() ?? "";
      if (
        e &&
        !teamEmails.has(e) &&
        !e.startsWith("igor@") &&
        !e.startsWith("yuriy@") &&
        !e.startsWith("serhiy@")
      ) {
        adminUser = u;
        break;
      }
    }
  }
  if (adminUser) {
    console.log(`→ Адмін: ${adminUser.email}`);
  }

  console.log("\n=== Команда AgroSystem ===\n");

  for (const member of TEAM) {
    const authEmail = normalizeLoginToEmail(member.login);
    let user = byEmail.get(authEmail);

    if (member.bindExistingOnly) {
      user = adminUser ?? user;
      if (!user) {
        console.warn("⚠ Адмін не знайдений — пропуск");
        continue;
      }
    } else {
      // Прибрати старі логіни igor@ / yuriy@ / …
      for (const legacy of member.legacyEmails ?? []) {
        const old = byEmail.get(legacy.toLowerCase());
        if (old && old.id !== user?.id) {
          await admin.auth.admin.deleteUser(old.id);
          byEmail.delete(legacy.toLowerCase());
          console.log(`· Видалено старий логін ${legacy}`);
        }
      }

      if (!user) {
        if (!member.password) {
          console.warn(`⚠ Немає пароля для ${member.login}`);
          continue;
        }
        const { data: created, error } = await admin.auth.admin.createUser({
          email: authEmail,
          password: member.password,
          email_confirm: true,
          user_metadata: {
            full_name: member.fullName,
            role: member.role,
            login: member.login,
          },
        });
        if (error || !created.user) {
          console.error(`✗ Створення ${member.login}:`, error?.message);
          continue;
        }
        user = created.user;
        byEmail.set(authEmail, user);
        console.log(`✓ Створено ${member.fullName} (${ROLE_UK[member.role]})`);
      } else if (member.password) {
        await admin.auth.admin.updateUserById(user.id, {
          password: member.password,
          email_confirm: true,
          user_metadata: {
            full_name: member.fullName,
            role: member.role,
            login: member.login,
          },
        });
        console.log(`· Оновлено пароль / профіль: ${member.login}`);
      }
    }

    if (!user) continue;

    const { error: upsertError } = await admin.from("profiles").upsert(
      {
        id: user.id,
        email: (user.email ?? authEmail).toLowerCase(),
        full_name: member.fullName,
        role: member.role,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" }
    );

    if (upsertError) {
      console.error(`✗ profiles ${member.login}:`, upsertError.message);
      continue;
    }

    if (!member.bindExistingOnly) {
      await admin.auth.admin.updateUserById(user.id, {
        user_metadata: {
          full_name: member.fullName,
          role: member.role,
          login: member.login,
        },
      });
    } else {
      await admin.auth.admin.updateUserById(user.id, {
        user_metadata: {
          full_name: member.fullName,
          role: member.role,
        },
      });
    }

    console.log(
      `✓ ${member.fullName}: логін «${member.bindExistingOnly ? user.email : member.login}»${
        member.password ? " · пароль оновлено з env" : ""
      }`
    );
  }

  console.log("\nГотово.\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

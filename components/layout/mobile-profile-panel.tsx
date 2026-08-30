"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  ChevronLeft,
  KeyRound,
  Loader2,
  Lock,
  Save,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";

import {
  updateMyLoginAction,
  updateMyPasswordAction,
} from "@/app/team/actions";
import { ROLE_LABEL_UK, type AppActor } from "@/lib/app-actor-shared";
import { displayLoginFromEmail } from "@/lib/login-identity";
import { cn } from "@/lib/utils";

type MobileProfilePanelProps = {
  me: AppActor;
  onBack: () => void;
  onUpdated: (next: AppActor) => void;
  backLabel?: string;
};

export function MobileProfilePanel({
  me,
  onBack,
  onUpdated,
  backLabel = "Назад",
}: MobileProfilePanelProps) {
  const [login, setLogin] = useState(() => displayLoginFromEmail(me.email));
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [pendingLogin, setPendingLogin] = useState(false);
  const [pendingPassword, setPendingPassword] = useState(false);

  useEffect(() => {
    setLogin(displayLoginFromEmail(me.email));
  }, [me.email]);

  const loginDirty =
    login.trim().length > 0 &&
    displayLoginFromEmail(login.trim()).toLowerCase() !==
      displayLoginFromEmail(me.email).toLowerCase();

  async function saveLogin() {
    setPendingLogin(true);
    try {
      const res = await updateMyLoginAction(login);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      const nextEmail = res.email ?? me.email;
      onUpdated({ ...me, email: nextEmail });
      if (res.login) setLogin(res.login);
      toast.success("Логін оновлено — новий вхід уже з ним");
    } finally {
      setPendingLogin(false);
    }
  }

  async function savePassword() {
    if (password !== password2) {
      toast.error("Паролі не збігаються");
      return;
    }
    setPendingPassword(true);
    try {
      const res = await updateMyPasswordAction(password);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setPassword("");
      setPassword2("");
      setPasswordOpen(false);
      toast.success("Пароль змінено — надалі входьте з новим");
    } finally {
      setPendingPassword(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-zinc-800 px-4 pb-4 pr-14 pt-1">
        <button
          type="button"
          onClick={onBack}
          className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-zinc-400 active:text-zinc-200"
        >
          <ChevronLeft className="h-4 w-4" />
          {backLabel}
        </button>
        <h2 className="text-lg font-bold text-zinc-50">Профіль</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Дані входу оновлюються одразу після збереження
        </p>
      </div>

      <div className="space-y-4 px-4 py-4 pb-[calc(1rem+var(--safe-bottom))]">
        <div className="flex items-center gap-3 rounded-2xl border border-zinc-800 bg-zinc-900/80 px-3 py-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-full border border-[#C05621]/35 bg-gradient-to-br from-[#C05621]/30 to-[#9c4221]/20 text-base font-bold text-[#E8A87C]">
            {me.fullName.slice(0, 1).toUpperCase()}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-zinc-100">
              {me.fullName}
            </p>
            <p className="truncate text-xs text-zinc-500">
              {ROLE_LABEL_UK[me.role]}
            </p>
          </div>
        </div>

        <Field
          label="Імʼя"
          hint="Закрито для редагування"
          icon={<UserRound className="h-4 w-4" />}
        >
          <input
            value={me.fullName}
            readOnly
            disabled
            className={fieldInputClass(true)}
          />
        </Field>

        <Field
          label="Логін"
          hint="Можна змінити — для наступного входу"
          icon={<Lock className="h-4 w-4" />}
        >
          <div className="flex gap-2">
            <input
              value={login}
              onChange={(e) => setLogin(e.target.value)}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className={fieldInputClass(false)}
              placeholder="Логін"
            />
            <button
              type="button"
              disabled={!loginDirty || pendingLogin}
              onClick={() => void saveLogin()}
              className={cn(
                "inline-flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-xl px-3 text-sm font-semibold",
                loginDirty
                  ? "bg-[#C05621] text-white active:bg-[#a34a1c]"
                  : "bg-zinc-800 text-zinc-500"
              )}
            >
              {pendingLogin ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Зберегти
            </button>
          </div>
        </Field>

        <Field
          label="Посада"
          hint="Закрито для редагування"
          icon={<UserRound className="h-4 w-4" />}
        >
          <input
            value={ROLE_LABEL_UK[me.role]}
            readOnly
            disabled
            className={fieldInputClass(true)}
          />
        </Field>

        {!passwordOpen ? (
          <button
            type="button"
            onClick={() => setPasswordOpen(true)}
            className="flex w-full items-center gap-3 rounded-2xl border border-zinc-800 bg-zinc-900/80 px-3 py-3 text-left text-sm font-semibold text-zinc-100 active:bg-zinc-800"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-800 text-[#E8A87C]">
              <KeyRound className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block">Змінити пароль</span>
              <span className="block text-xs font-normal text-zinc-500">
                Новий пароль одразу для входу в систему
              </span>
            </span>
          </button>
        ) : (
          <div className="space-y-3 rounded-2xl border border-zinc-800 bg-zinc-900/80 p-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
              <KeyRound className="h-4 w-4 text-[#E8A87C]" />
              Новий пароль
            </div>
            <input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Новий пароль (мін. 8)"
              className={fieldInputClass(false)}
            />
            <input
              type="password"
              autoComplete="new-password"
              value={password2}
              onChange={(e) => setPassword2(e.target.value)}
              placeholder="Повторіть пароль"
              className={fieldInputClass(false)}
            />
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  setPasswordOpen(false);
                  setPassword("");
                  setPassword2("");
                }}
                className="h-11 flex-1 rounded-xl border border-zinc-700 bg-zinc-950 text-sm font-semibold text-zinc-300"
              >
                Скасувати
              </button>
              <button
                type="button"
                disabled={
                  pendingPassword ||
                  password.length < 8 ||
                  password !== password2
                }
                onClick={() => void savePassword()}
                className="inline-flex h-11 flex-[1.3] items-center justify-center gap-1.5 rounded-xl bg-[#C05621] text-sm font-semibold text-white disabled:opacity-50"
              >
                {pendingPassword ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                Зберегти пароль
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  icon,
  children,
}: {
  label: string;
  hint: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 px-0.5">
        <span className="text-zinc-500">{icon}</span>
        <div className="min-w-0">
          <p className="text-xs font-semibold tracking-wide text-zinc-300 uppercase">
            {label}
          </p>
          <p className="text-[11px] text-zinc-500">{hint}</p>
        </div>
      </div>
      {children}
    </div>
  );
}

function fieldInputClass(readOnly: boolean) {
  return cn(
    "h-11 w-full rounded-xl border px-3 text-sm outline-none",
    readOnly
      ? "cursor-not-allowed border-zinc-800 bg-zinc-900/50 text-zinc-400"
      : "border-zinc-700 bg-zinc-950 text-zinc-100 focus:border-[#C05621]/60"
  );
}

"use client";

import { useEffect, useState, type ReactNode } from "react";
import { KeyRound, Loader2, LogOut, Save } from "lucide-react";
import { toast } from "sonner";

import { logoutAction } from "@/app/login/actions";
import {
  updateMyLoginAction,
  updateMyPasswordAction,
} from "@/app/team/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ROLE_LABEL_UK, type AppActor } from "@/lib/app-actor-shared";
import { displayLoginFromEmail } from "@/lib/login-identity";
import { cn } from "@/lib/utils";

type ProfilePanelContentProps = {
  me: AppActor;
  onUpdated: (next: AppActor) => void;
  variant?: "dark" | "default";
  className?: string;
};

export function ProfilePanelContent({
  me,
  onUpdated,
  variant = "default",
  className,
}: ProfilePanelContentProps) {
  const dark = variant === "dark";
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
      toast.success("Логін оновлено");
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
      toast.success("Пароль змінено");
    } finally {
      setPendingPassword(false);
    }
  }

  const inputClass = dark
    ? "h-11 border-zinc-600 bg-zinc-900/90 px-3.5 text-base text-zinc-100 placeholder:text-zinc-600 disabled:cursor-default disabled:border-zinc-700 disabled:bg-zinc-900/70 disabled:text-zinc-300 disabled:opacity-100"
    : "h-11 bg-muted/40 px-3.5 text-base disabled:opacity-100";

  return (
    <div
      className={cn(
        "custom-scrollbar space-y-4 px-4 py-4",
        className
      )}
    >
      <div
        className={cn(
          "flex items-center gap-2.5 rounded-xl border px-3 py-2.5",
          dark
            ? "border-white/[0.08] bg-gradient-to-br from-white/[0.06] to-white/[0.02]"
            : "border-border/60 bg-muted/30"
        )}
      >
        <span
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-sm font-bold",
            dark
              ? "border-[#C05621]/35 bg-gradient-to-br from-[#C05621]/30 to-[#9c4221]/20 text-[#E8A87C]"
              : "border-primary/25 bg-primary/10 text-primary"
          )}
        >
          {me.fullName.slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0">
          <p
            className={cn(
              "truncate text-sm font-semibold",
              dark ? "text-zinc-100" : "text-foreground"
            )}
          >
            {me.fullName}
          </p>
          <p
            className={cn(
              "truncate text-xs",
              dark ? "text-zinc-500" : "text-muted-foreground"
            )}
          >
            {ROLE_LABEL_UK[me.role]}
          </p>
        </div>
      </div>

      <Field label="Імʼя" dark={dark}>
        <Input
          value={me.fullName}
          readOnly
          disabled
          className={inputClass}
        />
      </Field>

      <Field label="Логін" dark={dark}>
        <div className="flex gap-2">
          <Input
            value={login}
            onChange={(e) => setLogin(e.target.value)}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="Логін"
            className={inputClass}
          />
          <Button
            type="button"
            size="sm"
            disabled={!loginDirty || pendingLogin}
            onClick={() => void saveLogin()}
            className={cn(
              "h-11 shrink-0 px-3",
              dark &&
                "border border-emerald-500/30 bg-emerald-600/90 text-white hover:bg-emerald-600 hover:ring-2 hover:ring-emerald-500/40 disabled:opacity-40"
            )}
          >
            {pendingLogin ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            <span className="sr-only sm:not-sr-only sm:ml-1">Зберегти</span>
          </Button>
        </div>
      </Field>

      <Field label="Посада" dark={dark}>
        <Input
          value={ROLE_LABEL_UK[me.role]}
          readOnly
          disabled
          className={inputClass}
        />
      </Field>

      {!passwordOpen ? (
        <button
          type="button"
          onClick={() => setPasswordOpen(true)}
          className={cn(
            "flex h-auto w-full items-center gap-2.5 rounded-xl border px-3.5 py-3 text-left transition-colors",
            dark
              ? "border-zinc-700 bg-zinc-900/60 text-zinc-200 hover:border-zinc-600 hover:bg-zinc-800/80 hover:ring-1 hover:ring-emerald-500/30"
              : "border-border bg-background hover:bg-muted/40"
          )}
        >
          <span
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-lg",
              dark ? "bg-zinc-800 text-[#E8A87C]" : "bg-muted text-primary"
            )}
          >
            <KeyRound className="h-4 w-4" />
          </span>
          <span className="text-sm font-medium">Змінити пароль</span>
        </button>
      ) : (
        <div
          className={cn(
            "space-y-3 rounded-xl border p-3.5",
            dark
              ? "border-zinc-700 bg-zinc-900/50"
              : "border-border/60 bg-muted/20"
          )}
        >
          <p
            className={cn(
              "text-sm font-medium",
              dark ? "text-zinc-200" : "text-foreground"
            )}
          >
            Новий пароль
          </p>
          <Input
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Мін. 8 символів"
            className={inputClass}
          />
          <Input
            type="password"
            autoComplete="new-password"
            value={password2}
            onChange={(e) => setPassword2(e.target.value)}
            placeholder="Повторіть пароль"
            className={inputClass}
          />
          <div className="flex gap-2 pt-0.5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={cn(
                "flex-1",
                dark && "border-zinc-600 bg-transparent text-zinc-300 hover:bg-zinc-800"
              )}
              onClick={() => {
                setPasswordOpen(false);
                setPassword("");
                setPassword2("");
              }}
            >
              Скасувати
            </Button>
            <Button
              type="button"
              size="sm"
              className={cn(
                "flex-[1.3]",
                dark &&
                  "bg-emerald-600 hover:bg-emerald-500 hover:ring-2 hover:ring-emerald-500/40"
              )}
              disabled={
                pendingPassword ||
                password.length < 8 ||
                password !== password2
              }
              onClick={() => void savePassword()}
            >
              {pendingPassword ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Зберегти
            </Button>
          </div>
        </div>
      )}

      <div
        className={cn(
          "pt-1",
          dark ? "border-t border-zinc-700/80" : "border-t border-border/60"
        )}
      >
        <form action={logoutAction}>
          <button
            type="submit"
            className={cn(
              "mt-3 flex h-auto w-full items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors",
              dark
                ? "border-rose-500/25 bg-rose-500/[0.08] text-rose-200 hover:border-rose-500/40 hover:bg-rose-500/15 hover:ring-1 hover:ring-rose-500/30"
                : "border-destructive/20 bg-destructive/5 text-destructive hover:bg-destructive/10"
            )}
          >
            <span
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-lg",
                dark ? "bg-rose-500/15 text-rose-300" : "bg-destructive/10"
              )}
            >
              <LogOut className="h-4 w-4" />
            </span>
            <span className="text-sm font-medium">Вийти</span>
          </button>
        </form>
      </div>
    </div>
  );
}

function Field({
  label,
  dark,
  children,
}: {
  label: string;
  dark: boolean;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label
        className={cn(
          "text-[10px] font-semibold tracking-wider uppercase",
          dark ? "text-zinc-500" : "text-muted-foreground"
        )}
      >
        {label}
      </Label>
      {children}
    </div>
  );
}

type ProfilePopoverProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  me: AppActor;
  onUpdated: (next: AppActor) => void;
  triggerClassName?: string;
  triggerAriaLabel?: string;
  collapsed?: boolean;
  children: React.ReactNode;
};

/** Профіль на desktop — преміальний popover у колір сайдбару */
export function ProfilePopover({
  open,
  onOpenChange,
  me,
  onUpdated,
  triggerClassName,
  triggerAriaLabel,
  collapsed,
  children,
}: ProfilePopoverProps) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        type="button"
        aria-label={triggerAriaLabel}
        className={cn(
          "w-full text-left outline-none transition-colors",
          triggerClassName
        )}
      >
        {children}
      </PopoverTrigger>
      <PopoverContent
        side="right"
        align={collapsed ? "center" : "end"}
        sideOffset={10}
        alignOffset={collapsed ? 0 : -6}
        sheetOnMobile={false}
        className={cn(
          "w-[288px] gap-0 overflow-hidden rounded-xl border border-zinc-600",
          "bg-zinc-800 p-0 text-zinc-200 shadow-2xl ring-1 ring-black/25"
        )}
      >
        <div className="border-b border-zinc-700/80 px-4 py-2.5">
          <p className="text-sm font-semibold text-zinc-100">Профіль</p>
        </div>
        <ProfilePanelContent
          me={me}
          onUpdated={onUpdated}
          variant="dark"
          className="max-h-[min(70vh,420px)] overflow-y-auto"
        />
      </PopoverContent>
    </Popover>
  );
}

/** @deprecated Desktop uses ProfilePopover */
export function ProfileSheet(props: ProfilePopoverProps) {
  return <ProfilePopover {...props} />;
}

type MobileProfilePanelProps = {
  me: AppActor;
  onUpdated: (next: AppActor) => void;
};

/** Профіль у мобільному drawer «Інше» */
export function MobileProfilePanel({
  me,
  onUpdated,
}: MobileProfilePanelProps) {
  return (
    <div className="pb-[calc(0.75rem+var(--safe-bottom))]">
      <div className="border-b border-zinc-800 px-4 pb-3 pr-14 pt-1">
        <h2 className="text-lg font-bold text-zinc-50">Профіль</h2>
      </div>
      <ProfilePanelContent
        me={me}
        onUpdated={onUpdated}
        variant="dark"
        className="px-4 py-4"
      />
    </div>
  );
}

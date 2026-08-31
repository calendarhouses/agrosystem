"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ChevronLeft, KeyRound, Loader2, Save } from "lucide-react";
import { toast } from "sonner";

import {
  updateMyLoginAction,
  updateMyPasswordAction,
} from "@/app/team/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ROLE_LABEL_UK, type AppActor } from "@/lib/app-actor-shared";
import { displayLoginFromEmail } from "@/lib/login-identity";

type ProfilePanelContentProps = {
  me: AppActor;
  onUpdated: (next: AppActor) => void;
};

export function ProfilePanelContent({ me, onUpdated }: ProfilePanelContentProps) {
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

  return (
    <div className="custom-scrollbar flex-1 space-y-4 overflow-y-auto px-5 py-4">
      <div className="flex items-center gap-3 rounded-xl border border-border/60 bg-muted/30 px-3 py-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-full border border-primary/25 bg-primary/10 text-sm font-bold text-primary">
          {me.fullName.slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">
            {me.fullName}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {ROLE_LABEL_UK[me.role]}
          </p>
        </div>
      </div>

      <Field label="Імʼя">
        <Input value={me.fullName} readOnly disabled className="bg-muted/40" />
      </Field>

      <Field label="Логін">
        <div className="flex gap-2">
          <Input
            value={login}
            onChange={(e) => setLogin(e.target.value)}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="Логін"
          />
          <Button
            type="button"
            disabled={!loginDirty || pendingLogin}
            onClick={() => void saveLogin()}
            className="shrink-0"
          >
            {pendingLogin ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Зберегти
          </Button>
        </div>
      </Field>

      <Field label="Посада">
        <Input
          value={ROLE_LABEL_UK[me.role]}
          readOnly
          disabled
          className="bg-muted/40"
        />
      </Field>

      {!passwordOpen ? (
        <Button
          type="button"
          variant="outline"
          className="h-auto w-full justify-start gap-3 px-3 py-3"
          onClick={() => setPasswordOpen(true)}
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted text-primary">
            <KeyRound className="h-4 w-4" />
          </span>
          <span className="text-sm font-medium">Змінити пароль</span>
        </Button>
      ) : (
        <div className="space-y-3 rounded-xl border border-border/60 bg-muted/20 p-3">
          <p className="text-sm font-medium text-foreground">Новий пароль</p>
          <Input
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Мін. 8 символів"
          />
          <Input
            type="password"
            autoComplete="new-password"
            value={password2}
            onChange={(e) => setPassword2(e.target.value)}
            placeholder="Повторіть пароль"
          />
          <div className="flex gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
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
              className="flex-[1.3]"
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
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {label}
      </Label>
      {children}
    </div>
  );
}

type ProfileSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  me: AppActor;
  onUpdated: (next: AppActor) => void;
};

/** Профіль на desktop — стандартна бічна шторка як у решті системи */
export function ProfileSheet({
  open,
  onOpenChange,
  me,
  onUpdated,
}: ProfileSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 overflow-hidden sm:max-w-md"
      >
        <SheetHeader className="border-b border-border/60 px-5 py-4">
          <SheetTitle>Профіль</SheetTitle>
          <SheetDescription className="sr-only">
            Налаштування облікового запису
          </SheetDescription>
        </SheetHeader>
        <ProfilePanelContent me={me} onUpdated={onUpdated} />
      </SheetContent>
    </Sheet>
  );
}

type MobileProfilePanelProps = {
  me: AppActor;
  onBack: () => void;
  onUpdated: (next: AppActor) => void;
  backLabel?: string;
};

/** Профіль у мобільному drawer «Інше» */
export function MobileProfilePanel({
  me,
  onBack,
  onUpdated,
  backLabel = "Назад",
}: MobileProfilePanelProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-zinc-800 px-4 pb-3 pr-14 pt-1">
        <button
          type="button"
          onClick={onBack}
          className="mb-2 inline-flex items-center gap-1.5 text-sm font-medium text-zinc-400 active:text-zinc-200"
        >
          <ChevronLeft className="h-4 w-4" />
          {backLabel}
        </button>
        <h2 className="text-lg font-bold text-zinc-50">Профіль</h2>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto bg-zinc-950 pb-[calc(1rem+var(--safe-bottom))] [&_label]:text-zinc-400 [&_input]:border-zinc-700 [&_input]:bg-zinc-900 [&_input:disabled]:text-zinc-500">
        <ProfilePanelContent me={me} onUpdated={onUpdated} />
      </div>
    </div>
  );
}

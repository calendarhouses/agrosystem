"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { Loader2, Lock, Sprout, UserRound } from "lucide-react";

import { loginWithPassword } from "@/app/login/actions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = searchParams.get("next") || "/";
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await loginWithPassword(login, password);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.replace(nextPath.startsWith("/") ? nextPath : "/");
      router.refresh();
    });
  }

  return (
    <Card className="w-full max-w-md border-[#E5DFD3] bg-white/95 shadow-xl ring-1 ring-black/5 backdrop-blur-sm">
      <CardHeader className="space-y-4 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-[#276749] to-[#1f5239] text-white shadow-lg shadow-[#276749]/25">
          <Sprout className="h-7 w-7" strokeWidth={1.75} />
        </div>
        <div>
          <CardTitle className="text-2xl font-extrabold tracking-tight text-zinc-900">
            LEVADA SYSTEM
          </CardTitle>
          <CardDescription className="mt-1.5 text-zinc-500">
            Увійдіть, щоб відкрити операційну панель господарства
          </CardDescription>
        </div>
      </CardHeader>

      <form onSubmit={onSubmit}>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="login" className="text-zinc-700">
              Логін
            </Label>
            <div className="relative">
              <UserRound className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-zinc-400" />
              <Input
                id="login"
                type="text"
                autoComplete="username"
                required
                value={login}
                onChange={(e) => setLogin(e.target.value)}
                placeholder="Логін"
                className="h-11 pl-10"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="password" className="text-zinc-700">
              Пароль
            </Label>
            <div className="relative">
              <Lock className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-zinc-400" />
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="h-11 pl-10"
              />
            </div>
          </div>

          {error ? (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          ) : null}
        </CardContent>

        <CardFooter className="flex-col gap-3 border-0 bg-transparent pb-6">
          <Button
            type="submit"
            disabled={pending}
            className="h-11 w-full bg-[#276749] text-sm font-bold text-white hover:bg-[#1f5239]"
          >
            {pending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Вхід…
              </>
            ) : (
              "Увійти"
            )}
          </Button>
          <p className="text-center text-[11px] text-zinc-400">
            Доступ лише для авторизованих користувачів господарства
          </p>
        </CardFooter>
      </form>
    </Card>
  );
}

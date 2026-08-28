"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Sprout } from "lucide-react";

import { Button } from "@/components/ui/button";
import { IosInstallGuide } from "@/components/pwa/ios-install-guide";
import {
  APP_BRAND_NAME,
  isMobileUserAgent,
  isStandaloneDisplayMode,
  markInstallPromptCompleted,
  markInstallPromptDismissed,
  shouldShowInstallPrompt,
} from "@/lib/pwa";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export function InstallPrompt() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = searchParams.get("next") || "/login";
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [installing, setInstalling] = useState<"ios" | "android" | null>(null);
  const [iosGuideOpen, setIosGuideOpen] = useState(false);

  useEffect(() => {
    if (!isMobileUserAgent()) {
      router.replace(nextPath.startsWith("/") ? nextPath : "/login");
      return;
    }
    if (isStandaloneDisplayMode()) {
      router.replace(nextPath.startsWith("/") ? nextPath : "/login");
    }
  }, [nextPath, router]);

  useEffect(() => {
    function onBeforeInstallPrompt(event: Event) {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    }
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    };
  }, []);

  function goNext() {
    router.replace(nextPath.startsWith("/") ? nextPath : "/login");
  }

  function onSkip() {
    markInstallPromptDismissed();
    goNext();
  }

  async function onInstallAndroid() {
    setInstalling("android");
    try {
      if (deferredPrompt) {
        await deferredPrompt.prompt();
        const choice = await deferredPrompt.userChoice;
        if (choice.outcome === "accepted") {
          markInstallPromptCompleted();
          return;
        }
      }
    } finally {
      setInstalling(null);
      setDeferredPrompt(null);
    }
  }

  function onInstallIos() {
    setIosGuideOpen(true);
  }

  function onIosGuideClose() {
    setIosGuideOpen(false);
    markInstallPromptCompleted();
  }

  return (
    <>
      <IosInstallGuide open={iosGuideOpen} onClose={onIosGuideClose} />

      <div className="relative flex min-h-dvh flex-col overflow-hidden bg-[#F4F1EA] text-zinc-900">
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(39,103,73,0.14),_transparent_55%),radial-gradient(ellipse_at_bottom_right,_rgba(192,86,33,0.1),_transparent_50%)]"
        aria-hidden
      />

      <div className="relative mx-auto flex w-full max-w-lg flex-1 flex-col px-5 pb-8 pt-[max(2.5rem,env(safe-area-inset-top))]">
        <div className="flex flex-col items-center text-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-[1.75rem] bg-gradient-to-br from-[#276749] to-[#1f5239] text-white shadow-xl shadow-[#276749]/25">
            <Sprout className="h-10 w-10" strokeWidth={1.75} />
          </div>
          <h1 className="mt-6 text-2xl font-extrabold tracking-tight sm:text-3xl">
            Встановіть {APP_BRAND_NAME}
          </h1>
          <p className="mt-3 max-w-sm text-sm leading-relaxed text-zinc-600">
            Встановіть застосунок на телефон — швидкий доступ до полів, техніки
            та складу без адресного рядка браузера.
          </p>
        </div>

        <div className="mt-auto space-y-3 pt-10">
          <Button
            type="button"
            size="lg"
            className="h-12 w-full rounded-2xl bg-[#276749] text-base font-semibold text-white hover:bg-[#1f5239]"
            disabled={installing != null}
            onClick={onInstallIos}
          >
            Встановити для iOS
          </Button>

          <Button
            type="button"
            size="lg"
            className="h-12 w-full rounded-2xl bg-[#276749] text-base font-semibold text-white hover:bg-[#1f5239]"
            disabled={installing != null}
            onClick={() => void onInstallAndroid()}
          >
            {installing === "android" ? "Встановлення…" : "Встановити для Android"}
          </Button>

          <Button
            type="button"
            size="lg"
            variant="secondary"
            className="h-12 w-full rounded-2xl border border-[#E5DFD3] bg-zinc-200/80 text-base font-semibold text-zinc-700 hover:bg-zinc-300/80"
            disabled={installing != null}
            onClick={onSkip}
          >
            Пропустити зараз
          </Button>
        </div>
      </div>
      </div>
    </>
  );
}

/** Редірект з /login на /install при першому візиті (лише mobile). */
export function LoginInstallRedirect() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!isMobileUserAgent()) return;
    if (!shouldShowInstallPrompt()) return;
    const next = searchParams.toString();
    const qs = next ? `?${next}` : "";
    router.replace(`/install${qs}`);
  }, [router, searchParams]);

  return null;
}

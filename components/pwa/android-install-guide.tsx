"use client";

import { useEffect, useRef, useState } from "react";
import { Download, MoreVertical, Plus, X } from "lucide-react";

import {
  APP_BRAND_NAME,
  detectAndroidBrowser,
  isStandaloneDisplayMode,
  onSystemSheetOpened,
  type AndroidBrowserKind,
} from "@/lib/pwa";
import { Button } from "@/components/ui/button";

type AndroidInstallGuideProps = {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
};

type ManualStep = {
  title: string;
  text: string;
  hint: string;
};

function manualSteps(browser: AndroidBrowserKind): ManualStep[] {
  if (browser === "samsung") {
    return [
      {
        title: "Крок 1 з 3",
        text: "Натисніть три крапки (⋮) у меню браузера.",
        hint: "Наступний крок зʼявиться автоматично",
      },
      {
        title: "Крок 2 з 3",
        text: "У списку оберіть «Додати сторінку».",
        hint: "Пункт з іконкою «+»",
      },
      {
        title: "Крок 3 з 3",
        text: "Натисніть «На головний екран» і підтвердіть.",
        hint: `Після цього ${APP_BRAND_NAME} зʼявиться на екрані телефону`,
      },
    ];
  }

  return [
    {
      title: "Крок 1 з 2",
      text: "Натисніть три крапки (⋮) у меню браузера.",
      hint: "Наступний крок зʼявиться автоматично",
    },
    {
      title: "Крок 2 з 2",
      text: "Оберіть «Встановити застосунок» або «Додати на головний екран».",
      hint: `Після цього ${APP_BRAND_NAME} зʼявиться на екрані телефону`,
    },
  ];
}

export function AndroidInstallGuide({ open, onClose, onDone }: AndroidInstallGuideProps) {
  const browser = detectAndroidBrowser();
  const steps = manualSteps(browser);
  const [step, setStep] = useState(0);
  const stepRef = useRef(0);
  const hideCountRef = useRef(0);

  useEffect(() => {
    stepRef.current = step;
  }, [step]);

  useEffect(() => {
    if (!open) {
      setStep(0);
      hideCountRef.current = 0;
      return;
    }
    if (isStandaloneDisplayMode()) {
      onDone();
    }
  }, [open, onDone]);

  useEffect(() => {
    if (!open) return;

    return onSystemSheetOpened(() => {
      hideCountRef.current += 1;
      const next = Math.min(stepRef.current + 1, steps.length - 1);
      setStep(next);
    });
  }, [open, steps.length]);

  useEffect(() => {
    if (!open) return;
    const interval = window.setInterval(() => {
      if (isStandaloneDisplayMode()) onDone();
    }, 800);
    return () => window.clearInterval(interval);
  }, [open, onDone]);

  if (!open) return null;

  const current = steps[step];
  const isLast = step === steps.length - 1;

  function handleClose() {
    setStep(0);
    hideCountRef.current = 0;
    onClose();
  }

  function handleDone() {
    setStep(0);
    hideCountRef.current = 0;
    onDone();
  }

  return (
    <>
      <div className="pointer-events-none fixed inset-0 z-[90] bg-black/30" aria-hidden />

      {step === 0 ? (
        <div className="pointer-events-none fixed top-[max(3.5rem,env(safe-area-inset-top))] right-4 z-[91]">
          <div className="relative">
            <span className="absolute -inset-2 animate-ping rounded-full bg-white/25" />
            <div className="relative flex h-11 w-11 items-center justify-center rounded-full border-2 border-white bg-zinc-900/80 text-white shadow-lg">
              <MoreVertical className="h-5 w-5" />
            </div>
          </div>
        </div>
      ) : null}

      <div
        className="fixed inset-x-0 top-0 z-[100] px-4 pt-[max(0.75rem,env(safe-area-inset-top))]"
        role="dialog"
        aria-modal="true"
        aria-label="Встановлення на Android"
      >
        <div className="mx-auto w-full max-w-md overflow-hidden rounded-2xl border border-white/20 bg-zinc-950/92 text-white shadow-2xl backdrop-blur-xl">
          <div className="flex items-start justify-between gap-3 border-b border-white/10 px-4 py-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold tracking-wide text-[#8fd4a8] uppercase">
                {current.title}
              </p>
              <p className="mt-1 text-[15px] leading-snug font-bold">{current.text}</p>
              <p className="mt-1.5 text-xs leading-relaxed text-white/65">{current.hint}</p>
            </div>
            <button
              type="button"
              onClick={handleClose}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-white"
              aria-label="Закрити"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {browser === "samsung" && step === 1 ? (
            <div className="space-y-0.5 p-2 text-sm">
              <div className="rounded-lg px-3 py-2 text-white/35">Історія</div>
              <div className="rounded-lg px-3 py-2 text-white/35">Завантаження</div>
              <div className="flex items-center gap-2 rounded-lg bg-[#276749] px-3 py-2.5 font-bold text-white ring-2 ring-white/30">
                <Plus className="h-4 w-4 shrink-0" />
                Додати сторінку
              </div>
              <div className="rounded-lg px-3 py-2 text-white/35">Налаштування</div>
            </div>
          ) : null}

          {browser !== "samsung" && step === 1 ? (
            <div className="space-y-0.5 p-2 text-sm">
              <div className="rounded-lg px-3 py-2 text-white/35">Історія</div>
              <div className="flex items-center gap-2 rounded-lg bg-[#276749] px-3 py-2.5 font-bold text-white ring-2 ring-white/30">
                <Download className="h-4 w-4 shrink-0" />
                Встановити застосунок
              </div>
              <div className="rounded-lg px-3 py-2 text-white/35">Налаштування</div>
            </div>
          ) : null}

          {browser === "samsung" && step === 2 ? (
            <div className="p-3 text-sm">
              <div className="flex items-center gap-2 rounded-lg bg-[#276749] px-3 py-2.5 font-bold text-white ring-2 ring-white/30">
                На головний екран
              </div>
            </div>
          ) : null}

          {isLast ? (
            <div className="border-t border-white/10 p-3">
              <Button
                type="button"
                className="h-11 w-full rounded-xl bg-[#276749] font-semibold text-white hover:bg-[#1f5239]"
                onClick={handleDone}
              >
                Готово, зрозуміло
              </Button>
            </div>
          ) : (
            <div className="border-t border-white/10 p-3">
              <Button
                type="button"
                variant="secondary"
                className="h-10 w-full rounded-xl bg-white/10 text-sm text-white hover:bg-white/20"
                onClick={() => setStep((s) => Math.min(s + 1, steps.length - 1))}
              >
                Далі вручну
              </Button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

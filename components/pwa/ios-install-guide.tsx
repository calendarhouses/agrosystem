"use client";

import { useEffect, useRef, useState } from "react";
import { PlusSquare, X } from "lucide-react";

import { APP_BRAND_NAME, isStandaloneDisplayMode, onSystemSheetOpened } from "@/lib/pwa";
import { Button } from "@/components/ui/button";

type IosInstallGuideProps = {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
};

const STEPS = [
  {
    title: "Крок 1 з 3",
    text: "Внизу Safari натисніть «Поділитися» (квадрат зі стрілкою вгору).",
    hint: "Наступний крок зʼявиться автоматично",
  },
  {
    title: "Крок 2 з 3",
    text: "Прокрутіть меню вниз і натисніть «На Початковий екран».",
    hint: "Пункт нижче «Пошук на сторінці»",
  },
  {
    title: "Крок 3 з 3",
    text: `Перевірте назву «${APP_BRAND_NAME}» і натисніть «Додати» справа вгорі.`,
    hint: "Після цього іконка зʼявиться на головному екрані",
  },
] as const;

export function IosInstallGuide({ open, onClose, onDone }: IosInstallGuideProps) {
  const [step, setStep] = useState(0);
  const [sheetOpen, setSheetOpen] = useState(false);
  const stepRef = useRef(0);
  const hideCountRef = useRef(0);

  useEffect(() => {
    stepRef.current = step;
  }, [step]);

  useEffect(() => {
    if (!open) {
      setStep(0);
      setSheetOpen(false);
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
      setSheetOpen(true);

      if (hideCountRef.current === 1 && stepRef.current === 0) {
        setStep(1);
        return;
      }
      if (hideCountRef.current >= 2 && stepRef.current === 1) {
        setStep(2);
      }
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const interval = window.setInterval(() => {
      if (isStandaloneDisplayMode()) {
        onDone();
      }
    }, 800);

    return () => window.clearInterval(interval);
  }, [open, onDone]);

  if (!open) return null;

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  function handleClose() {
    setStep(0);
    setSheetOpen(false);
    hideCountRef.current = 0;
    onClose();
  }

  function handleDone() {
    setStep(0);
    setSheetOpen(false);
    hideCountRef.current = 0;
    onDone();
  }

  return (
    <>
      {/* Легке затемнення — не заважає меню Safari */}
      <div
        className={
          sheetOpen
            ? "pointer-events-none fixed inset-0 z-[90] bg-black/20"
            : "pointer-events-none fixed inset-0 z-[90] bg-black/55"
        }
        aria-hidden
      />

      {/* Крок 1: стрілка до реальної кнопки Safari внизу */}
      {step === 0 && !sheetOpen ? (
        <div
          className="pointer-events-none fixed inset-x-0 bottom-0 z-[91] pb-[max(0.5rem,env(safe-area-inset-bottom))]"
          aria-hidden
        >
          <div className="flex flex-col items-center">
            <svg
              viewBox="0 0 48 80"
              className="mb-2 h-16 w-12 animate-ios-guide-bounce text-white drop-shadow-lg"
            >
              <path
                d="M24 4 C24 4 24 52 24 58 M24 58 L14 46 M24 58 L34 46"
                fill="none"
                stroke="currentColor"
                strokeWidth="3.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <div className="h-12 w-28 rounded-full bg-white/25 shadow-[0_0_24px_rgba(255,255,255,0.35)]" />
          </div>
        </div>
      ) : null}

      {/* Інструкція — завжди зверху, видно над меню Safari */}
      <div
        className="fixed inset-x-0 top-0 z-[100] px-4 pt-[max(0.75rem,env(safe-area-inset-top))]"
        role="dialog"
        aria-modal="true"
        aria-label="Встановлення на iOS"
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

          {step === 1 ? (
            <div className="space-y-0.5 p-2 text-sm">
              <div className="rounded-lg px-3 py-2 text-white/35">Скопіювати</div>
              <div className="rounded-lg px-3 py-2 text-white/35">До Читанки</div>
              <div className="rounded-lg px-3 py-2 text-white/35">Додати закладку</div>
              <div className="rounded-lg px-3 py-2 text-white/35">До улюблених</div>
              <div className="rounded-lg px-3 py-2 text-white/35">Пошук на сторінці</div>
              <div className="flex items-center gap-2 rounded-lg bg-[#276749] px-3 py-2.5 font-bold text-white ring-2 ring-white/30">
                <PlusSquare className="h-4 w-4 shrink-0" />
                На Початковий екран
              </div>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="p-3">
              <div className="flex items-center justify-between rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm">
                <span className="text-white/50">Скасувати</span>
                <span className="font-bold text-[#8fd4a8]">Додати</span>
              </div>
              <div className="mt-3 flex flex-col items-center py-2">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-[#276749] to-[#1f5239] text-base font-extrabold">
                  LS
                </div>
                <p className="mt-2 text-sm font-bold">{APP_BRAND_NAME}</p>
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
          ) : null}
        </div>
      </div>
    </>
  );
}

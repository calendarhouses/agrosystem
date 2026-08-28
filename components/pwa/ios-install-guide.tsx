"use client";

import { useState } from "react";
import { PlusSquare, Share, X } from "lucide-react";

import { APP_BRAND_NAME } from "@/lib/pwa";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type IosInstallGuideProps = {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
};

const STEPS = [
  {
    title: "Крок 1 з 3",
    text: "Внизу екрана в Safari натисніть кнопку «Поділитися» (квадрат зі стрілкою вгору).",
    hint: "Вона зазвичай по центру внизу",
  },
  {
    title: "Крок 2 з 3",
    text: "У відкритому меню прокрутіть вниз і оберіть «На Початковий екран».",
    hint: "Може бути іконка «+» біля назви",
  },
  {
    title: "Крок 3 з 3",
    text: `Перевірте назву «${APP_BRAND_NAME}» і натисніть «Додати» у правому верхньому куті.`,
    hint: "Після цього іконка зʼявиться на головному екрані",
  },
] as const;

export function IosInstallGuide({ open, onClose, onDone }: IosInstallGuideProps) {
  const [step, setStep] = useState(0);

  if (!open) return null;

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  function handleClose() {
    setStep(0);
    onClose();
  }

  function handleDone() {
    setStep(0);
    onDone();
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col bg-black/80 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Встановлення на iOS"
    >
      <div className="flex items-center justify-between px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-2">
        <p className="text-sm font-semibold text-white/80">{current.title}</p>
        <button
          type="button"
          onClick={handleClose}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-white"
          aria-label="Закрити"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="flex flex-1 flex-col px-5 pb-6">
        <div className="mx-auto mt-2 w-full max-w-md rounded-3xl border border-white/15 bg-white/10 p-5 text-white backdrop-blur-md">
          <p className="text-lg leading-snug font-bold">{current.text}</p>
          <p className="mt-2 text-sm text-white/70">{current.hint}</p>
        </div>

        <div className="relative mx-auto mt-8 flex w-full max-w-md flex-1 items-end justify-center pb-[max(1rem,env(safe-area-inset-bottom))]">
          {step === 0 ? (
            <div className="flex w-full flex-col items-center">
              <svg
                viewBox="0 0 48 80"
                className="mb-3 h-14 w-10 animate-ios-guide-bounce text-white"
                aria-hidden
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
              <div className="relative">
                <span className="absolute -inset-3 animate-ping rounded-full bg-white/20" />
                <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl border-2 border-white bg-white/15">
                  <Share className="h-6 w-6 text-white" />
                </div>
              </div>
              <p className="mt-3 text-center text-xs font-medium text-white/60">
                Кнопка «Поділитися» в Safari
              </p>
            </div>
          ) : null}

          {step === 1 ? (
            <div className="w-full overflow-hidden rounded-2xl border border-white/20 bg-zinc-900/90 shadow-2xl">
              <div className="border-b border-white/10 px-4 py-3 text-center text-xs text-white/50">
                Меню «Поділитися»
              </div>
              <div className="space-y-1 p-2">
                <div className="rounded-xl px-3 py-2.5 text-sm text-white/40">Скопіювати</div>
                <div className="rounded-xl px-3 py-2.5 text-sm text-white/40">Зберегти</div>
                <div className="flex items-center gap-3 rounded-xl bg-[#276749] px-3 py-3 text-sm font-bold text-white ring-2 ring-white/40">
                  <PlusSquare className="h-5 w-5 shrink-0" />
                  На Початковий екран
                </div>
              </div>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="w-full overflow-hidden rounded-2xl border border-white/20 bg-zinc-900/90 shadow-2xl">
              <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
                <span className="text-sm text-white/50">Скасувати</span>
                <span className="text-sm font-bold text-white">Додати</span>
              </div>
              <div className="flex flex-col items-center px-4 py-6">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-[#276749] to-[#1f5239] text-lg font-extrabold text-white">
                  LS
                </div>
                <p className="mt-3 text-center text-base font-bold text-white">
                  {APP_BRAND_NAME}
                </p>
                <p className="mt-1 text-center text-xs text-white/50">
                  На Початковий екран
                </p>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="border-t border-white/10 bg-black/40 px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto flex w-full max-w-md gap-2">
          {step > 0 ? (
            <Button
              type="button"
              variant="secondary"
              className="h-12 flex-1 rounded-2xl bg-white/15 text-white hover:bg-white/25"
              onClick={() => setStep((s) => s - 1)}
            >
              Назад
            </Button>
          ) : null}
          <Button
            type="button"
            className={cn(
              "h-12 rounded-2xl bg-[#276749] text-base font-semibold text-white hover:bg-[#1f5239]",
              step > 0 ? "flex-1" : "w-full"
            )}
            onClick={() => {
              if (isLast) {
                handleDone();
                return;
              }
              setStep((s) => s + 1);
            }}
          >
            {isLast ? "Готово, зрозуміло" : "Далі"}
          </Button>
        </div>
      </div>
    </div>
  );
}

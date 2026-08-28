"use client";

import { useState } from "react";
import { Download, MoreVertical, X } from "lucide-react";

import { APP_BRAND_NAME } from "@/lib/pwa";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type AndroidInstallGuideProps = {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
  nativeAvailable: boolean;
  onTryNative: () => Promise<boolean>;
};

const MANUAL_STEPS = [
  {
    title: "Крок 1 з 2",
    text: "У правому верхньому куті Chrome натисніть три крапки (меню браузера).",
    hint: "Якщо кнопки немає — потягніть сторінку вниз і спробуйте ще раз",
  },
  {
    title: "Крок 2 з 2",
    text: "У меню оберіть «Встановити застосунок» або «Додати на головний екран».",
    hint: `Після цього ${APP_BRAND_NAME} зʼявиться на головному екрані`,
  },
] as const;

export function AndroidInstallGuide({
  open,
  onClose,
  onDone,
  nativeAvailable,
  onTryNative,
}: AndroidInstallGuideProps) {
  const [step, setStep] = useState(0);
  const [trying, setTrying] = useState(false);

  if (!open) return null;

  const isManual = !nativeAvailable;
  const current = isManual ? MANUAL_STEPS[step] : null;
  const isLastManual = isManual && step === MANUAL_STEPS.length - 1;

  function handleClose() {
    setStep(0);
    onClose();
  }

  function handleDone() {
    setStep(0);
    onDone();
  }

  async function handleNativeInstall() {
    setTrying(true);
    try {
      const accepted = await onTryNative();
      if (accepted) {
        handleDone();
      }
    } finally {
      setTrying(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col bg-black/80 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Встановлення на Android"
    >
      <div className="flex items-center justify-between px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-2">
        <p className="text-sm font-semibold text-white/80">
          {isManual ? current?.title : "Встановлення"}
        </p>
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
        {nativeAvailable ? (
          <div className="mx-auto mt-4 w-full max-w-md rounded-3xl border border-white/15 bg-white/10 p-5 text-white backdrop-blur-md">
            <p className="text-lg leading-snug font-bold">
              Натисніть «Встановити» — Chrome додасть {APP_BRAND_NAME} на головний
              екран.
            </p>
            <p className="mt-2 text-sm text-white/70">
              Це займе кілька секунд. Після встановлення відкривайте з іконки на
              екрані телефону.
            </p>
            <div className="mt-6 flex justify-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-[#276749] to-[#1f5239] text-lg font-extrabold text-white">
                LS
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="mx-auto mt-2 w-full max-w-md rounded-3xl border border-white/15 bg-white/10 p-5 text-white backdrop-blur-md">
              <p className="text-lg leading-snug font-bold">{current?.text}</p>
              <p className="mt-2 text-sm text-white/70">{current?.hint}</p>
            </div>

            <div className="relative mx-auto mt-8 flex w-full max-w-md flex-1 items-center justify-center">
              {step === 0 ? (
                <div className="flex w-full flex-col items-end">
                  <div className="relative mr-2">
                    <span className="absolute -inset-3 animate-ping rounded-full bg-white/20" />
                    <div className="relative flex h-12 w-12 items-center justify-center rounded-full border-2 border-white bg-white/15">
                      <MoreVertical className="h-6 w-6 text-white" />
                    </div>
                  </div>
                  <p className="mt-3 w-full text-right text-xs font-medium text-white/60">
                    Меню Chrome (⋮)
                  </p>
                </div>
              ) : null}

              {step === 1 ? (
                <div className="w-full overflow-hidden rounded-2xl border border-white/20 bg-zinc-900/90 shadow-2xl">
                  <div className="border-b border-white/10 px-4 py-3 text-center text-xs text-white/50">
                    Меню Chrome
                  </div>
                  <div className="space-y-1 p-2">
                    <div className="rounded-xl px-3 py-2.5 text-sm text-white/40">
                      Історія
                    </div>
                    <div className="flex items-center gap-3 rounded-xl bg-[#276749] px-3 py-3 text-sm font-bold text-white ring-2 ring-white/40">
                      <Download className="h-5 w-5 shrink-0" />
                      Встановити застосунок
                    </div>
                    <div className="rounded-xl px-3 py-2.5 text-sm text-white/40">
                      Налаштування
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </>
        )}
      </div>

      <div className="border-t border-white/10 bg-black/40 px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto flex w-full max-w-md gap-2">
          {nativeAvailable ? (
            <>
              <Button
                type="button"
                variant="secondary"
                className="h-12 flex-1 rounded-2xl bg-white/15 text-white hover:bg-white/25"
                onClick={handleClose}
              >
                Пізніше
              </Button>
              <Button
                type="button"
                disabled={trying}
                className="h-12 flex-1 rounded-2xl bg-[#276749] text-base font-semibold text-white hover:bg-[#1f5239]"
                onClick={() => void handleNativeInstall()}
              >
                {trying ? "Відкриваємо…" : "Встановити"}
              </Button>
            </>
          ) : (
            <>
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
                  if (isLastManual) {
                    handleDone();
                    return;
                  }
                  setStep((s) => s + 1);
                }}
              >
                {isLastManual ? "Готово, зрозуміло" : "Далі"}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

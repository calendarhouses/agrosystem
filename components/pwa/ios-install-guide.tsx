"use client";

import { Share, X } from "lucide-react";

import { cn } from "@/lib/utils";

type IosInstallGuideProps = {
  open: boolean;
  onClose: () => void;
};

/** Візуальний підказувач для Safari: стрілка до «Поділитися» без текстових інструкцій. */
export function IosInstallGuide({ open, onClose }: IosInstallGuideProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-label="Встановлення на iOS"
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/75 backdrop-blur-[2px]"
        onClick={onClose}
        aria-label="Закрити"
      />

      <button
        type="button"
        onClick={onClose}
        className="absolute top-[max(1rem,env(safe-area-inset-top))] right-4 z-[102] flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur-sm transition-colors hover:bg-white/25"
        aria-label="Закрити"
      >
        <X className="h-5 w-5" />
      </button>

      {/* Підсвітка зони Safari toolbar */}
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-white/10 to-transparent"
        aria-hidden
      />

      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 bottom-0 z-[101]",
          "pb-[max(0.75rem,env(safe-area-inset-bottom))]"
        )}
      >
        {/* Стрілка */}
        <div className="flex flex-col items-center">
          <svg
            viewBox="0 0 48 80"
            className="h-16 w-12 animate-ios-guide-bounce text-white drop-shadow-[0_4px_12px_rgba(0,0,0,0.45)]"
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

          {/* Пульсуюча іконка Share (як у Safari) */}
          <div className="relative mt-1">
            <span
              className="absolute -inset-4 animate-ping rounded-full bg-white/25"
              aria-hidden
            />
            <span
              className="absolute -inset-2 animate-pulse rounded-2xl bg-white/20"
              aria-hidden
            />
            <div className="relative flex h-[3.25rem] w-[3.25rem] items-center justify-center rounded-2xl border-2 border-white/90 bg-white/15 text-white shadow-[0_8px_32px_rgba(0,0,0,0.35)] backdrop-blur-md">
              <Share className="h-6 w-6" strokeWidth={2} />
            </div>
          </div>

          {/* Підсвітка смуги toolbar */}
          <div
            className="mt-4 h-1 w-28 rounded-full bg-white/40 shadow-[0_0_24px_rgba(255,255,255,0.35)]"
            aria-hidden
          />
        </div>
      </div>
    </div>
  );
}

"use client";

import type { LucideIcon } from "lucide-react";
import {
  ArrowDown,
  Check,
  ChevronLeft,
  Download,
  MoreVertical,
  Plus,
  PlusSquare,
  Share,
  Smartphone,
  Sprout,
} from "lucide-react";

import { APP_BRAND_NAME } from "@/lib/pwa";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type InstallGuidePlatform = "ios" | "android";

type PlatformInstallGuideProps = {
  platform: InstallGuidePlatform | null;
  onClose: () => void;
  onDone: () => void;
};

type StepDef = {
  title: string;
  text: string;
  icon: LucideIcon;
  visual?: React.ReactNode;
};

function AppIcon({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const box =
    size === "lg"
      ? "h-16 w-16 rounded-[1.35rem]"
      : size === "sm"
        ? "h-11 w-11 rounded-xl"
        : "h-14 w-14 rounded-2xl";
  const icon =
    size === "lg" ? "h-8 w-8" : size === "sm" ? "h-5 w-5" : "h-7 w-7";

  return (
    <div
      className={cn(
        box,
        "flex items-center justify-center bg-gradient-to-br from-[#276749] to-[#1f5239] text-white shadow-lg shadow-[#276749]/30 ring-1 ring-white/20"
      )}
    >
      <Sprout className={icon} strokeWidth={1.75} />
    </div>
  );
}

function StepArrow() {
  return (
    <div className="flex justify-center py-2" aria-hidden>
      <div className="flex flex-col items-center gap-0.5">
        <div className="h-5 w-px bg-gradient-to-b from-white/0 via-[#C05621]/60 to-white/0" />
        <ArrowDown className="h-4 w-4 text-[#E8A87C]/80" strokeWidth={2.5} />
      </div>
    </div>
  );
}

function StepCard({
  index,
  title,
  text,
  icon: Icon,
  visual,
}: StepDef & { index: number }) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-3xl border border-white/10",
        "bg-white/[0.06] p-4 shadow-[0_8px_32px_rgba(0,0,0,0.35)] backdrop-blur-2xl"
      )}
    >
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent"
        aria-hidden
      />
      <div className="flex gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#C05621]/90 to-[#9c4221]/90 text-sm font-bold text-white shadow-md shadow-[#C05621]/20">
          {index}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-[#276749]/30 bg-[#276749]/15 text-[#8fd4a8]">
              <Icon className="h-5 w-5" strokeWidth={1.75} />
            </span>
            <div className="min-w-0">
              <p className="text-[15px] font-bold tracking-tight text-zinc-50">
                {title}
              </p>
              <p className="mt-1.5 text-sm leading-relaxed text-zinc-400">
                {text}
              </p>
            </div>
          </div>
          {visual ? <div className="mt-4">{visual}</div> : null}
        </div>
      </div>
    </div>
  );
}

function MenuMock({
  highlight,
  items,
}: {
  highlight: string;
  items: string[];
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/30 text-sm shadow-inner">
      {items.map((item) => (
        <div
          key={item}
          className={cn(
            "border-b border-white/[0.06] px-3.5 py-2.5 last:border-0",
            item === highlight
              ? "bg-gradient-to-r from-[#276749] to-[#1f5239] font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]"
              : "text-zinc-500"
          )}
        >
          {item}
        </div>
      ))}
    </div>
  );
}

const IOS_STEPS: StepDef[] = [
  {
    title: "Відкрийте «Поділитися»",
    text: "У Safari внизу екрана натисніть кнопку з квадратом і стрілкою вгору. Вона зазвичай по центру панелі.",
    icon: Share,
    visual: (
      <div className="flex flex-col items-center rounded-2xl border border-dashed border-white/15 bg-white/[0.04] py-5">
        <div className="relative">
          <span className="absolute -inset-3 animate-pulse rounded-full bg-[#276749]/20" />
          <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl border border-white/25 bg-white/10 text-white backdrop-blur-sm">
            <Share className="h-7 w-7" strokeWidth={1.75} />
          </div>
        </div>
        <p className="mt-3 text-xs font-semibold tracking-wide text-zinc-400 uppercase">
          Поділитися · Safari
        </p>
      </div>
    ),
  },
  {
    title: "Оберіть «На Початковий екран»",
    text: "У меню прокрутіть список вниз і натисніть «На Початковий екран» (іконка «+» у квадраті).",
    icon: PlusSquare,
    visual: (
      <MenuMock
        items={[
          "Скопіювати",
          "До Читанки",
          "Додати закладку",
          "До улюблених",
          "Пошук на сторінці",
          "На Початковий екран",
        ]}
        highlight="На Початковий екран"
      />
    ),
  },
  {
    title: "Підтвердіть «Додати»",
    text: `Перевірте назву «${APP_BRAND_NAME}» і натисніть «Додати» у правому верхньому куті. Іконка зʼявиться на головному екрані.`,
    icon: Check,
    visual: (
      <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/35 shadow-inner">
        <div className="flex items-center justify-between border-b border-white/[0.08] px-4 py-2.5 text-sm">
          <span className="text-zinc-500">Скасувати</span>
          <span className="font-bold text-[#8fd4a8]">Додати</span>
        </div>
        <div className="flex flex-col items-center px-4 py-5">
          <AppIcon />
          <p className="mt-3 text-sm font-bold text-zinc-100">{APP_BRAND_NAME}</p>
          <p className="mt-1 text-[11px] text-zinc-500">На Початковий екран</p>
        </div>
      </div>
    ),
  },
];

const ANDROID_CHROME_STEPS: StepDef[] = [
  {
    title: "Відкрийте меню браузера",
    text: "У правому верхньому куті Chrome натисніть три крапки (⋮).",
    icon: MoreVertical,
    visual: (
      <div className="flex justify-end pr-1">
        <div className="relative">
          <span className="absolute -inset-2 animate-pulse rounded-full bg-[#276749]/20" />
          <div className="relative flex h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white shadow-lg backdrop-blur-sm">
            <MoreVertical className="h-5 w-5" />
          </div>
        </div>
      </div>
    ),
  },
  {
    title: "Встановіть застосунок",
    text: "У списку оберіть «Встановити застосунок» або «Додати на головний екран». Підтвердіть встановлення.",
    icon: Download,
    visual: (
      <MenuMock
        items={["Історія", "Завантаження", "Встановити застосунок", "Налаштування"]}
        highlight="Встановити застосунок"
      />
    ),
  },
];

const ANDROID_SAMSUNG_STEPS: StepDef[] = [
  {
    title: "Відкрийте меню браузера",
    text: "Натисніть три крапки (⋮) або іконку меню в панелі браузера.",
    icon: MoreVertical,
    visual: (
      <div className="flex justify-end pr-1">
        <div className="relative">
          <span className="absolute -inset-2 animate-pulse rounded-full bg-[#276749]/20" />
          <div className="relative flex h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white shadow-lg backdrop-blur-sm">
            <MoreVertical className="h-5 w-5" />
          </div>
        </div>
      </div>
    ),
  },
  {
    title: "Оберіть «Додати сторінку»",
    text: "У меню знайдіть пункт «Додати сторінку» (іконка «+») і натисніть його.",
    icon: Plus,
    visual: (
      <MenuMock
        items={["Історія", "Завантаження", "Додати сторінку", "Налаштування"]}
        highlight="Додати сторінку"
      />
    ),
  },
  {
    title: "Додайте на головний екран",
    text: "Натисніть «На головний екран» і підтвердіть. Після цього відкривайте LEVADA з іконки на екрані телефону.",
    icon: Smartphone,
    visual: (
      <MenuMock
        items={["Закладки", "На головний екран", "Скасувати"]}
        highlight="На головний екран"
      />
    ),
  },
];

function StepList({ steps }: { steps: StepDef[] }) {
  return (
    <div className="space-y-0">
      {steps.map((step, i) => (
        <div key={step.title}>
          <StepCard index={i + 1} {...step} />
          {i < steps.length - 1 ? <StepArrow /> : null}
        </div>
      ))}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-3 flex items-center gap-2 text-xs font-bold tracking-[0.14em] text-zinc-500 uppercase">
      <span className="h-px flex-1 bg-gradient-to-r from-white/0 to-white/15" />
      <span>{children}</span>
      <span className="h-px flex-1 bg-gradient-to-l from-white/0 to-white/15" />
    </p>
  );
}

export function PlatformInstallGuide({
  platform,
  onClose,
  onDone,
}: PlatformInstallGuideProps) {
  if (!platform) return null;

  const isIos = platform === "ios";

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-zinc-950 text-zinc-100">
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(39,103,73,0.18),_transparent_55%),radial-gradient(ellipse_at_bottom_right,_rgba(192,86,33,0.12),_transparent_50%)]"
        aria-hidden
      />

      <header className="relative shrink-0 border-b border-white/[0.08] bg-zinc-950/80 px-4 py-3 backdrop-blur-2xl pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="mx-auto flex w-full max-w-lg items-center gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-zinc-300 transition-colors hover:bg-white/10"
            aria-label="Назад"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <AppIcon size="sm" />
            <div className="min-w-0">
              <h2 className="truncate text-lg font-extrabold tracking-tight text-zinc-50">
                {isIos ? "iPhone · Safari" : "Android"}
              </h2>
              <p className="text-xs text-zinc-500">
                {isIos ? "3 кроки до встановлення" : "Оберіть свій браузер"}
              </p>
            </div>
          </div>
        </div>
      </header>

      <div className="relative min-h-0 flex-1 overflow-y-auto px-4 py-5">
        <div className="mx-auto w-full max-w-lg space-y-6">
          {isIos ? (
            <StepList steps={IOS_STEPS} />
          ) : (
            <>
              <section>
                <SectionLabel>Google Chrome</SectionLabel>
                <StepList steps={ANDROID_CHROME_STEPS} />
              </section>

              <SectionLabel>або Samsung Internet</SectionLabel>

              <section>
                <StepList steps={ANDROID_SAMSUNG_STEPS} />
              </section>
            </>
          )}
        </div>
      </div>

      <footer className="relative shrink-0 border-t border-white/[0.08] bg-zinc-950/90 px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur-2xl">
        <div className="mx-auto w-full max-w-lg">
          <Button
            type="button"
            className="h-12 w-full rounded-2xl bg-gradient-to-r from-[#276749] to-[#1f5239] text-base font-semibold text-white shadow-lg shadow-[#276749]/25 hover:from-[#2d7a54] hover:to-[#245f42]"
            onClick={onDone}
          >
            Зрозуміло, продовжити
          </Button>
        </div>
      </footer>
    </div>
  );
}

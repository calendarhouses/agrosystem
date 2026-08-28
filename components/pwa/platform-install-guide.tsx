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

function StepArrow() {
  return (
    <div className="flex justify-center py-1" aria-hidden>
      <ArrowDown className="h-5 w-5 text-[#276749]/50" strokeWidth={2.5} />
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
    <div className="rounded-2xl border border-[#E5DFD3] bg-white p-4 shadow-sm">
      <div className="flex gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#276749] text-sm font-bold text-white">
          {index}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#276749]/10 text-[#276749]">
              <Icon className="h-5 w-5" strokeWidth={2} />
            </span>
            <div className="min-w-0">
              <p className="font-bold text-zinc-900">{title}</p>
              <p className="mt-1 text-sm leading-relaxed text-zinc-600">{text}</p>
            </div>
          </div>
          {visual ? <div className="mt-3">{visual}</div> : null}
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
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50 text-sm">
      {items.map((item) => (
        <div
          key={item}
          className={cn(
            "border-b border-zinc-100 px-3 py-2.5 last:border-0",
            item === highlight
              ? "bg-[#276749] font-semibold text-white"
              : "text-zinc-400"
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
      <div className="flex flex-col items-center rounded-xl border border-dashed border-[#E5DFD3] bg-[#F4F1EA]/60 py-4">
        <Share className="h-8 w-8 text-[#276749]" strokeWidth={1.75} />
        <p className="mt-2 text-xs font-medium text-zinc-500">Поділитися · Safari</p>
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
      <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3">
        <div className="flex items-center justify-between text-sm">
          <span className="text-zinc-400">Скасувати</span>
          <span className="font-bold text-[#276749]">Додати</span>
        </div>
        <div className="mt-3 flex flex-col items-center py-2">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-[#276749] to-[#1f5239] text-base font-extrabold text-white">
            LS
          </div>
          <p className="mt-2 text-sm font-bold text-zinc-800">{APP_BRAND_NAME}</p>
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
      <div className="flex justify-end pr-2">
        <div className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-[#276749]/30 bg-white shadow-sm">
          <MoreVertical className="h-5 w-5 text-[#276749]" />
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
      <div className="flex justify-end pr-2">
        <div className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-[#276749]/30 bg-white shadow-sm">
          <MoreVertical className="h-5 w-5 text-[#276749]" />
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
      <MenuMock items={["Закладки", "На головний екран", "Скасувати"]} highlight="На головний екран" />
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

export function PlatformInstallGuide({
  platform,
  onClose,
  onDone,
}: PlatformInstallGuideProps) {
  if (!platform) return null;

  const isIos = platform === "ios";

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-[#F4F1EA]">
      <header className="shrink-0 border-b border-[#E5DFD3] bg-white/90 px-4 py-3 backdrop-blur-md pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="mx-auto flex w-full max-w-lg items-center gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-full text-zinc-600 hover:bg-zinc-100"
            aria-label="Назад"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-extrabold text-zinc-900">
              {isIos ? "iPhone (Safari)" : "Android"}
            </h2>
            <p className="text-xs text-zinc-500">
              {isIos ? "3 кроки" : "Оберіть свій браузер"}
            </p>
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
        <div className="mx-auto w-full max-w-lg space-y-6">
          {isIos ? (
            <StepList steps={IOS_STEPS} />
          ) : (
            <>
              <section>
                <p className="mb-3 text-sm font-bold text-zinc-800">Google Chrome</p>
                <StepList steps={ANDROID_CHROME_STEPS} />
              </section>

              <div className="relative py-2">
                <div className="absolute inset-0 flex items-center" aria-hidden>
                  <div className="w-full border-t border-[#E5DFD3]" />
                </div>
                <p className="relative mx-auto w-fit bg-[#F4F1EA] px-3 text-xs font-semibold text-zinc-400 uppercase">
                  або Samsung Internet
                </p>
              </div>

              <section>
                <StepList steps={ANDROID_SAMSUNG_STEPS} />
              </section>
            </>
          )}
        </div>
      </div>

      <footer className="shrink-0 border-t border-[#E5DFD3] bg-white/95 px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur-md">
        <div className="mx-auto w-full max-w-lg">
          <Button
            type="button"
            className="h-12 w-full rounded-2xl bg-[#276749] text-base font-semibold text-white hover:bg-[#1f5239]"
            onClick={onDone}
          >
            Зрозуміло, продовжити
          </Button>
        </div>
      </footer>
    </div>
  );
}

"use client";

import { ChevronRight, PackageMinus, Plus, Search, Tractor } from "lucide-react";

import {
  OperationsPanelShell,
  OperationsSheetHeader,
  useOpsSurface,
} from "@/components/dashboard/operations-sheet-chrome";
import type { FieldTimelineField } from "@/lib/field-timeline";
import { cn } from "@/lib/utils";

type OperationsFieldAddSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  field: FieldTimelineField | null;
  onAddOperation: () => void;
  onAddInventory: () => void;
  onAddScouting: () => void;
};

function ActionCard({
  title,
  description,
  icon: Icon,
  accent,
  onClick,
}: {
  title: string;
  description: string;
  icon: typeof Tractor;
  accent: "orange" | "emerald" | "sky";
  onClick: () => void;
}) {
  const light = useOpsSurface() === "light";
  const accentStyles =
    accent === "orange"
      ? {
          border: "border-orange-500/20",
          glow: "from-orange-500/15 via-orange-500/5",
          icon: "bg-orange-500/20 text-orange-300 ring-orange-500/25",
          hover: "hover:border-orange-500/35 hover:bg-orange-500/[0.08]",
        }
      : accent === "sky"
        ? {
            border: "border-sky-500/20",
            glow: "from-sky-500/15 via-sky-500/5",
            icon: "bg-sky-500/20 text-sky-300 ring-sky-500/25",
            hover: "hover:border-sky-500/35 hover:bg-sky-500/[0.08]",
          }
        : {
            border: "border-emerald-500/20",
            glow: "from-emerald-500/15 via-emerald-500/5",
            icon: "bg-emerald-500/20 text-emerald-300 ring-emerald-500/25",
            hover: "hover:border-emerald-500/35 hover:bg-emerald-500/[0.08]",
          };

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group relative w-full overflow-hidden rounded-3xl border p-4 text-left transition",
        light
          ? "border-[#E5DFD3]/90 bg-white/90 shadow-sm hover:border-[#276749]/20 hover:bg-white"
          : cn("bg-gradient-to-br to-transparent", accentStyles.border, accentStyles.glow, accentStyles.hover)
      )}
    >
      <div className="flex items-center gap-4">
        <span
          className={cn(
            "flex size-14 shrink-0 items-center justify-center rounded-2xl ring-1",
            accentStyles.icon
          )}
        >
          <Icon className="size-6" strokeWidth={1.8} />
        </span>
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              "text-base font-bold tracking-tight",
              light ? "text-zinc-900" : "text-zinc-50"
            )}
          >
            {title}
          </p>
          <p
            className={cn(
              "mt-1 text-sm leading-snug",
              light ? "text-zinc-500" : "text-zinc-400"
            )}
          >
            {description}
          </p>
        </div>
        <ChevronRight
          className={cn(
            "size-5 shrink-0 transition group-hover:translate-x-0.5",
            light ? "text-zinc-400 group-hover:text-zinc-600" : "text-zinc-600 group-hover:text-zinc-300"
          )}
        />
      </div>
    </button>
  );
}

export function OperationsFieldAddSheet({
  open,
  onOpenChange,
  field,
  onAddOperation,
  onAddInventory,
  onAddScouting,
}: OperationsFieldAddSheetProps) {
  return (
    <OperationsPanelShell
      open={open}
      onOpenChange={onOpenChange}
      title="Додати позицію"
    >
      <OperationsSheetHeader
        icon={Plus}
        accent="emerald"
        title="Додати позицію"
        description={
          field ? (
            <>
              {field.name}
              {field.crop ? ` · ${field.crop}` : ""}
            </>
          ) : (
            "Оберіть тип запису для хронології поля"
          )
        }
      />

      <div className="space-y-3 px-4 py-4 pb-[max(1.5rem,var(--safe-bottom))]">
        <ActionCard
          accent="orange"
          icon={Tractor}
          title="Наряд техніки"
          description="Виконана робота: тип, техніка, площа, паливо"
          onClick={() => {
            onOpenChange(false);
            onAddOperation();
          }}
        />
        <ActionCard
          accent="emerald"
          icon={PackageMinus}
          title="Списання ТМЦ"
          description="ЗЗР, добрива, насіння та інші матеріали на поле"
          onClick={() => {
            onOpenChange(false);
            onAddInventory();
          }}
        />
        <ActionCard
          accent="sky"
          icon={Search}
          title="Скаутинг"
          description="Фото з поля та нотатки агронома для хронології"
          onClick={() => {
            onOpenChange(false);
            onAddScouting();
          }}
        />
      </div>
    </OperationsPanelShell>
  );
}

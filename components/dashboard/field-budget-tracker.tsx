"use client";

import { useEffect, useState, useTransition } from "react";
import { Check, Loader2, Pencil, Target, X } from "lucide-react";

import { updateFieldPlannedBudget } from "@/app/admin/fields/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  attachFieldBudget,
  type LiveFieldEconomics,
} from "@/lib/field-analytics";
import { cn } from "@/lib/utils";

function formatUah(value: number): string {
  return new Intl.NumberFormat("uk-UA", {
    maximumFractionDigits: 0,
  }).format(Math.round(value));
}

function burnTone(pct: number | null): {
  bar: string;
  track: string;
  label: string;
  text: string;
} {
  if (pct == null) {
    return {
      bar: "bg-zinc-300",
      track: "bg-zinc-100",
      label: "text-zinc-500",
      text: "Бюджет не задано",
    };
  }
  if (pct > 100) {
    return {
      bar: "bg-red-500",
      track: "bg-red-100",
      label: "text-red-700",
      text: "Перевитрата",
    };
  }
  if (pct >= 75) {
    return {
      bar: "bg-amber-500",
      track: "bg-amber-100",
      label: "text-amber-800",
      text: "Увага",
    };
  }
  return {
    bar: "bg-[#276749]",
    track: "bg-[#276749]/15",
    label: "text-[#276749]",
    text: "В межах плану",
  };
}

export type FieldBudgetTrackerProps = {
  fieldId: string;
  economics: LiveFieldEconomics;
  onEconomicsChange: (next: LiveFieldEconomics) => void;
  className?: string;
};

export function FieldBudgetTracker({
  fieldId,
  economics,
  onEconomicsChange,
  className,
}: FieldBudgetTrackerProps) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const areaHa = economics.areaHa > 0 ? economics.areaHa : 0;
  const hasBudget =
    economics.plannedBudgetPerHa != null &&
    economics.totalPlannedBudget != null &&
    economics.totalPlannedBudget > 0;
  const pct = economics.budgetUsedPercentage;
  const tone = burnTone(hasBudget ? pct : null);
  const barWidth = hasBudget ? Math.min(100, Math.max(0, pct ?? 0)) : 0;

  function beginEdit() {
    setValue(
      economics.plannedBudgetPerHa != null
        ? String(Math.round(economics.plannedBudgetPerHa))
        : ""
    );
    setError(null);
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setError(null);
    setValue("");
  }

  useEffect(() => {
    if (editing) return;
    setValue(
      economics.plannedBudgetPerHa != null
        ? String(Math.round(economics.plannedBudgetPerHa))
        : ""
    );
  }, [editing, economics.plannedBudgetPerHa]);

  function submit() {
    const raw = value.replace(/\s/g, "").replace(",", ".");
    if (!raw.trim()) {
      setError("Введіть суму ₴/га");
      return;
    }
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) {
      setError("Некоректна сума");
      return;
    }

    const previous = economics;
    const optimistic = attachFieldBudget(economics, areaHa, n > 0 ? n : null);
    onEconomicsChange(optimistic);
    setEditing(false);

    startTransition(async () => {
      const res = await updateFieldPlannedBudget(fieldId, n > 0 ? n : null);
      if (!res.ok) {
        onEconomicsChange(previous);
        setError(res.error);
        setEditing(true);
      }
    });
  }

  const previewTotal =
    areaHa > 0 && Number(value.replace(/\s/g, "").replace(",", ".")) > 0
      ? Math.round(Number(value.replace(/\s/g, "").replace(",", ".")) * areaHa)
      : null;

  return (
    <section
      className={cn(
        "rounded-2xl border border-[#E5DFD3] bg-white p-4 shadow-sm",
        className
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#276749]/10 text-[#276749]">
            <Target className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold tracking-[0.12em] text-zinc-500 uppercase">
              Бюджет поля
            </p>
            {editing ? (
              <div className="mt-1.5 space-y-1">
                <div className="flex items-center gap-1.5">
                  <div className="relative min-w-0 flex-1">
                    <Input
                      inputMode="decimal"
                      value={value}
                      onChange={(e) => setValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          submit();
                        }
                        if (e.key === "Escape") {
                          e.preventDefault();
                          cancelEdit();
                        }
                      }}
                      placeholder="15000"
                      className="h-9 pr-12 tabular-nums"
                      autoFocus
                      disabled={pending}
                    />
                    <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-[10px] font-medium text-zinc-400">
                      ₴/га
                    </span>
                  </div>
                  <Button
                    type="button"
                    size="icon-sm"
                    onClick={submit}
                    disabled={pending}
                    className="shrink-0 bg-[#276749] text-white hover:bg-[#22543d]"
                    aria-label="Зберегти бюджет"
                  >
                    {pending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Check className="h-3.5 w-3.5" />
                    )}
                  </Button>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="outline"
                    onClick={cancelEdit}
                    disabled={pending}
                    className="shrink-0"
                    aria-label="Скасувати"
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
                {previewTotal != null ? (
                  <p className="text-[11px] tabular-nums text-zinc-500">
                    Разом на поле ≈ {formatUah(previewTotal)} ₴
                  </p>
                ) : null}
                {error ? (
                  <p className="text-[11px] font-medium text-red-600">{error}</p>
                ) : null}
              </div>
            ) : hasBudget ? (
              <p className="mt-0.5 text-xs tabular-nums text-zinc-500">
                План {formatUah(economics.plannedBudgetPerHa!)} ₴/га
              </p>
            ) : null}
          </div>
        </div>

        {!editing ? (
          <button
            type="button"
            onClick={beginEdit}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-zinc-200 text-zinc-500 transition hover:bg-zinc-50 hover:text-zinc-800"
            aria-label="Редагувати бюджет"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>

      {!hasBudget && !editing ? (
        <button
          type="button"
          onClick={beginEdit}
          className={cn(
            "mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-[#276749]/35",
            "bg-[#276749]/5 px-3 py-3 text-sm font-semibold text-[#276749]",
            "transition hover:bg-[#276749]/10"
          )}
        >
          <Target className="h-4 w-4" />
          Встановити плановий бюджет
        </button>
      ) : hasBudget && !editing ? (
        <div className="mt-3.5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-[13px] leading-snug text-zinc-700">
              Використано{" "}
              <span className="font-bold tabular-nums text-zinc-900">
                {formatUah(economics.totalSpentUah)} ₴
              </span>{" "}
              із{" "}
              <span className="font-semibold tabular-nums text-zinc-700">
                {formatUah(economics.totalPlannedBudget!)} ₴
              </span>{" "}
              <span className={cn("font-bold tabular-nums", tone.label)}>
                ({pct != null ? `${pct}%` : "—"})
              </span>
            </p>
            <span
              className={cn(
                "rounded-md px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase",
                tone.label,
                pct != null && pct > 100
                  ? "bg-red-50"
                  : pct != null && pct >= 75
                    ? "bg-amber-50"
                    : "bg-emerald-50"
              )}
            >
              {tone.text}
            </span>
          </div>

          <div
            className={cn(
              "mt-2.5 h-2.5 w-full overflow-hidden rounded-full",
              tone.track
            )}
            role="progressbar"
            aria-valuenow={Math.round(barWidth)}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className={cn(
                "h-full rounded-full transition-all duration-500 ease-out",
                tone.bar
              )}
              style={{ width: `${barWidth}%` }}
            />
          </div>
        </div>
      ) : null}
    </section>
  );
}

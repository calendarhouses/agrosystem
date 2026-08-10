"use client";

import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import {
  CheckCircle2,
  ChevronLeft,
  Fuel,
  Loader2,
  MapPinned,
  Tractor,
  Wallet,
} from "lucide-react";

import { Label } from "@/components/ui/label";
import type { FieldGeometry } from "@/lib/farm-fields";
import {
  estimateAreaHaFromTrack,
} from "@/lib/field-operations";
import type { FieldTechVisit } from "@/lib/field-tech-history";
import { cn } from "@/lib/utils";

export type CloseableOperation = {
  id: string;
  type: string;
  crop: string;
  machinery?: string;
  implement?: string;
  date?: string;
  time?: string;
  occurredAt?: string;
  seasonYear?: number;
  /** Запланована / поточна площа наряду (те, що на картці) */
  areaDone: number;
  areaTotal: number;
  fuelUsed: number;
  wage: number;
  status: "completed" | "in_progress" | "planned";
  agronomistComment?: string;
  wialonUnitId?: number | null;
  implementWidthM?: number | null;
  trackerDistanceKm?: number | null;
  trackerWorkHours?: number | null;
  trackerFuelL?: number | null;
};

export type ClosedOperationPayload = {
  areaDone: number;
  fuelUsed: number;
  wage: number;
  agronomistComment: string;
  status: "completed";
  exportStatus: "pending";
  trackerDistanceKm?: number | null;
  trackerWorkHours?: number | null;
  trackerFuelL?: number | null;
  wialonUnitId?: number | null;
  implementWidthM?: number | null;
};

type TrackerSuggestion = {
  distanceKm: number;
  workHours: number;
  fuelL: number | null;
  areaHa: number | null;
  loading: boolean;
  error: string | null;
};

type OperationClosePanelProps = {
  op: CloseableOperation;
  fieldId?: string | null;
  fieldKey?: string | null;
  fieldName?: string | null;
  fieldGeometry?: FieldGeometry | null;
  onBack: () => void;
  onConfirm: (payload: ClosedOperationPayload) => void;
};

function parseNum(value: string): number {
  return Number(value.replace(",", ".").trim());
}

function formatNum(value: number, digits = 2): string {
  return value.toLocaleString("uk-UA", {
    maximumFractionDigits: digits,
    minimumFractionDigits: Number.isInteger(value) ? 0 : Math.min(digits, 2),
  });
}

function dayUnixRange(occurredAt?: string): { from: number; to: number } {
  const base = occurredAt
    ? new Date(`${occurredAt}T12:00:00`)
    : new Date();
  const start = new Date(base);
  start.setHours(0, 0, 0, 0);
  const end = new Date(base);
  end.setHours(23, 59, 59, 999);
  const now = Date.now();
  return {
    from: Math.floor(start.getTime() / 1000),
    to: Math.floor(Math.min(end.getTime(), now) / 1000),
  };
}

function MetricDelta({
  fact,
  plan,
  unit,
}: {
  fact: number;
  plan: number;
  unit: string;
}) {
  if (!Number.isFinite(fact) || !Number.isFinite(plan)) return null;
  const delta = Math.round((fact - plan) * 10) / 10;
  if (Math.abs(delta) < 0.05) {
    return <span className="text-xs font-medium text-zinc-500">за планом</span>;
  }
  if (delta > 0) {
    return (
      <span className="text-xs font-semibold text-rose-600">
        +{formatNum(delta, 1)} {unit}
      </span>
    );
  }
  return (
    <span className="text-xs font-semibold text-emerald-600">
      {formatNum(delta, 1)} {unit}
    </span>
  );
}

function planFromOperation(op: CloseableOperation) {
  const areaPlan = op.areaDone > 0 ? op.areaDone : op.areaTotal;
  return {
    areaPlan,
    fuelPlan: op.fuelUsed,
    wagePlan: op.wage,
  };
}

export function OperationClosePanel({
  op,
  fieldId,
  fieldKey,
  fieldName,
  fieldGeometry = null,
  onBack,
  onConfirm,
}: OperationClosePanelProps) {
  const { areaPlan, fuelPlan, wagePlan } = planFromOperation(op);

  const [areaFact, setAreaFact] = useState(String(areaPlan));
  const [fuelFact, setFuelFact] = useState(String(fuelPlan));
  const [wageFact, setWageFact] = useState(String(wagePlan));
  const [comment, setComment] = useState(op.agronomistComment ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [tracker, setTracker] = useState<TrackerSuggestion>({
    distanceKm: op.trackerDistanceKm ?? 0,
    workHours: op.trackerWorkHours ?? 0,
    fuelL: op.trackerFuelL ?? null,
    areaHa: null,
    loading: false,
    error: null,
  });

  useEffect(() => {
    const next = planFromOperation(op);
    setAreaFact(String(next.areaPlan));
    setFuelFact(String(next.fuelPlan));
    setWageFact(String(next.wagePlan));
    setComment(op.agronomistComment ?? "");
    setError(null);
    setSaving(false);
  }, [op]);

  useEffect(() => {
    const unitId = op.wialonUnitId;
    if (unitId == null || !fieldGeometry) {
      const width = op.implementWidthM;
      const dist = op.trackerDistanceKm ?? 0;
      const areaHa =
        width && dist > 0
          ? estimateAreaHaFromTrack(dist, width, op.areaTotal)
          : null;
      setTracker({
        distanceKm: dist,
        workHours: op.trackerWorkHours ?? 0,
        fuelL: op.trackerFuelL ?? null,
        areaHa,
        loading: false,
        error: null,
      });
      return;
    }

    let cancelled = false;
    const { from, to } = dayUnixRange(op.occurredAt);
    setTracker((prev) => ({ ...prev, loading: true, error: null }));

    async function load() {
      try {
        const [historyRes, trackRes] = await Promise.all([
          fetch("/api/wialon/field-history", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              geometry: fieldGeometry,
              units: [{ id: unitId, name: op.machinery || String(unitId) }],
              from,
              to,
            }),
          }),
          fetch(
            `/api/wialon/track?unitId=${unitId}&from=${from}&to=${to}&analytics=1`
          ),
        ]);

        let distanceKm = 0;
        let workHours = 0;

        if (historyRes.ok) {
          const hist = (await historyRes.json()) as {
            visits?: FieldTechVisit[];
          };
          for (const visit of hist.visits ?? []) {
            distanceKm += visit.distanceKm ?? 0;
            workHours += Math.max(0, (visit.endUnix - visit.startUnix) / 3600);
          }
        }

        let fuelL: number | null = null;
        if (trackRes.ok) {
          const trackBody = (await trackRes.json()) as {
            analytics?: {
              summary?: {
                fuelDelta?: number | null;
                workHours?: number;
                distanceKm?: number;
              };
            };
          };
          const summary = trackBody.analytics?.summary;
          if (summary?.fuelDelta != null && Number.isFinite(summary.fuelDelta)) {
            fuelL = Math.abs(summary.fuelDelta);
          }
          // Якщо візитів у полі немає — не підміняємо денним треком усього дня
          if (distanceKm <= 0 && (summary?.distanceKm ?? 0) > 0) {
            // лишаємо 0 по полю; fuel може бути з усього дня — не нав'язуємо
          }
        }

        distanceKm = Math.round(distanceKm * 10) / 10;
        workHours = Math.round(workHours * 10) / 10;
        const width = op.implementWidthM;
        const areaHa =
          width && distanceKm > 0
            ? estimateAreaHaFromTrack(distanceKm, width, op.areaTotal)
            : null;

        if (cancelled) return;

        setTracker({
          distanceKm,
          workHours,
          fuelL,
          areaHa,
          loading: false,
          error: null,
        });

        if (areaHa != null && areaHa > 0) {
          setAreaFact(String(areaHa));
        }
        if (fuelL != null && fuelL > 0) {
          setFuelFact(String(Math.round(fuelL * 10) / 10));
        }
      } catch {
        if (!cancelled) {
          setTracker((prev) => ({
            ...prev,
            loading: false,
            error: "Не вдалося зчитати трек",
          }));
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [
    op.wialonUnitId,
    op.occurredAt,
    op.machinery,
    op.implementWidthM,
    op.areaTotal,
    op.trackerDistanceKm,
    op.trackerWorkHours,
    op.trackerFuelL,
    fieldGeometry,
  ]);

  const areaFactNum = useMemo(() => parseNum(areaFact), [areaFact]);
  const fuelFactNum = useMemo(() => parseNum(fuelFact), [fuelFact]);
  const wageFactNum = useMemo(() => parseNum(wageFact), [wageFact]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;

    const area = areaFactNum;
    const fuel = fuelFactNum;
    const wage = wageFactNum;

    if (!Number.isFinite(area) || area <= 0) {
      setError("Вкажіть фактичну оброблену площу");
      return;
    }
    if (!Number.isFinite(fuel) || fuel < 0) {
      setError("Перевірте витрату палива");
      return;
    }
    if (!Number.isFinite(wage) || wage < 0) {
      setError("Перевірте зарплату");
      return;
    }

    const payload: ClosedOperationPayload = {
      areaDone: Math.round(area * 100) / 100,
      fuelUsed: Math.round(fuel * 10) / 10,
      wage: Math.round(wage),
      agronomistComment: comment.trim(),
      status: "completed",
      exportStatus: "pending",
      trackerDistanceKm: tracker.distanceKm || null,
      trackerWorkHours: tracker.workHours || null,
      trackerFuelL: tracker.fuelL,
      wialonUnitId: op.wialonUnitId ?? null,
      implementWidthM: op.implementWidthM ?? null,
    };

    setSaving(true);
    setError(null);

    try {
      const res = await fetch("/api/field-operations/close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientKey: op.id,
          fieldKey: fieldKey ?? null,
          fieldId: fieldId ?? null,
          workType: op.type,
          crop: op.crop,
          machinery: op.machinery,
          implement: op.implement,
          occurredAt: op.occurredAt,
          timeLabel: op.time,
          seasonYear: op.seasonYear,
          areaTotal: op.areaTotal,
          areaPlan,
          areaFact: payload.areaDone,
          fuelPlan,
          fuelFact: payload.fuelUsed,
          wagePlan,
          wageFact: payload.wage,
          agronomistComment: payload.agronomistComment,
          wialonUnitId: payload.wialonUnitId,
          implementWidthM: payload.implementWidthM,
          trackerDistanceKm: payload.trackerDistanceKm,
          trackerWorkHours: payload.trackerWorkHours,
          trackerFuelL: payload.trackerFuelL,
        }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        if (res.status !== 503) {
          setError(body?.error ?? "Не вдалося зберегти в базу");
          setSaving(false);
          return;
        }
      }

      onConfirm(payload);
    } catch {
      setError("Помилка мережі під час збереження");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="relative overflow-hidden border-b border-[#E5DFD3]/80 bg-gradient-to-br from-emerald-50 via-[#F4F1EA] to-[#EDE8DF] px-6 py-5">
          <div
            className="pointer-events-none absolute -top-16 right-0 h-40 w-40 rounded-full bg-emerald-400/15 blur-3xl"
            aria-hidden
          />
          <button
            type="button"
            onClick={onBack}
            className="relative mb-3 inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-zinc-600 transition-colors hover:bg-white/70 hover:text-zinc-900"
          >
            <ChevronLeft className="h-4 w-4" />
            Назад до поля
          </button>
          <div className="relative">
            <p className="mb-1.5 inline-flex items-center gap-1.5 rounded-full border border-emerald-200/80 bg-white/85 px-2.5 py-1 text-[10px] font-semibold tracking-wider text-emerald-700 uppercase">
              <CheckCircle2 className="h-3 w-3" />
              Підтвердження агронома
            </p>
            <h2 className="text-xl font-extrabold tracking-tight text-zinc-900">
              {op.type}
              {op.crop ? (
                <>
                  <span className="font-semibold text-zinc-400"> · </span>
                  <span className="font-bold text-zinc-700">{op.crop}</span>
                </>
              ) : null}
            </h2>
            <p className="mt-1 text-sm text-zinc-600">
              {fieldName ? `${fieldName} · ` : ""}
              звірка план / факт (далі — чорновик 1С)
            </p>
          </div>
        </div>

        <div className="space-y-4 px-6 py-5 pb-6">
          {(op.machinery || op.implement) && (
            <div className="flex items-center gap-3 rounded-2xl border border-[#E5DFD3] bg-white px-4 py-3 shadow-sm">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
                <Tractor className="h-5 w-5" strokeWidth={1.8} />
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-zinc-900">
                  {op.machinery || "Техніка"}
                </p>
                <p className="truncate text-xs text-zinc-500">
                  {op.implement || "—"}
                  {op.implementWidthM
                    ? ` · ${formatNum(op.implementWidthM, 1)} м`
                    : ""}
                  {op.date ? ` · ${op.date}` : ""}
                </p>
              </div>
            </div>
          )}

          <section className="overflow-hidden rounded-2xl border border-[#E5DFD3] bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-[#E5DFD3]/80 bg-[#FAFAF8] px-4 py-2.5">
              <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.1em] text-zinc-500 uppercase">
                <MapPinned className="h-3.5 w-3.5" />
                Дані з трекера
              </p>
              {tracker.loading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-400" />
              ) : null}
            </div>
            {tracker.error ? (
              <p className="px-4 py-3 text-xs text-amber-700">{tracker.error}</p>
            ) : (
              <div className="grid grid-cols-3 divide-x divide-[#E5DFD3]">
                <div className="px-3 py-3 text-center">
                  <p className="text-[10px] font-semibold tracking-wider text-zinc-400 uppercase">
                    Км у полі
                  </p>
                  <p className="mt-1 text-lg font-bold tabular-nums text-zinc-900">
                    {formatNum(tracker.distanceKm, 1)}
                  </p>
                </div>
                <div className="px-3 py-3 text-center">
                  <p className="text-[10px] font-semibold tracking-wider text-zinc-400 uppercase">
                    Години
                  </p>
                  <p className="mt-1 text-lg font-bold tabular-nums text-zinc-900">
                    {formatNum(tracker.workHours, 1)}
                  </p>
                </div>
                <div className="px-3 py-3 text-center">
                  <p className="text-[10px] font-semibold tracking-wider text-zinc-400 uppercase">
                    Оцінка га
                  </p>
                  <p className="mt-1 text-lg font-bold tabular-nums text-zinc-900">
                    {tracker.areaHa != null ? formatNum(tracker.areaHa) : "—"}
                  </p>
                </div>
              </div>
            )}
            <p className="border-t border-[#E5DFD3]/80 px-4 py-2 text-[11px] text-zinc-500">
              Оцінка: км × ширина знаряддя / 10. Можна змінити факти нижче.
              {tracker.fuelL != null
                ? ` Паливо з датчика: ${formatNum(tracker.fuelL, 1)} л.`
                : ""}
            </p>
          </section>

          <section className="overflow-hidden rounded-2xl border border-[#E5DFD3] bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-[#E5DFD3]/80 bg-[#FAFAF8] px-4 py-2.5">
              <p className="text-[11px] font-semibold tracking-[0.1em] text-zinc-500 uppercase">
                Оброблена площа
              </p>
              <MetricDelta fact={areaFactNum} plan={areaPlan} unit="га" />
            </div>
            <div className="grid grid-cols-2 gap-0 divide-x divide-[#E5DFD3]">
              <div className="bg-zinc-50/80 px-4 py-4">
                <p className="text-[10px] font-semibold tracking-wider text-zinc-400 uppercase">
                  План
                </p>
                <p className="mt-2 text-2xl font-bold tabular-nums text-zinc-500">
                  {formatNum(areaPlan)}
                  <span className="ml-1 text-sm font-semibold">га</span>
                </p>
              </div>
              <div className="px-4 py-4">
                <p className="text-[10px] font-semibold tracking-wider text-emerald-600 uppercase">
                  Факт
                </p>
                <div className="mt-1 flex items-baseline gap-1.5">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={areaFact}
                    onChange={(e) => setAreaFact(e.target.value)}
                    className={cn(
                      "w-full min-w-0 border-0 bg-transparent p-0",
                      "text-2xl font-bold tabular-nums text-zinc-900",
                      "outline-none",
                      "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    )}
                  />
                  <span className="shrink-0 text-sm font-semibold text-zinc-400">
                    га
                  </span>
                </div>
              </div>
            </div>
          </section>

          <section className="overflow-hidden rounded-2xl border border-[#E5DFD3] bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-[#E5DFD3]/80 bg-[#FAFAF8] px-4 py-2.5">
              <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.1em] text-zinc-500 uppercase">
                <Fuel className="h-3.5 w-3.5" />
                Паливо
              </p>
              <MetricDelta fact={fuelFactNum} plan={fuelPlan} unit="л" />
            </div>
            <div className="grid grid-cols-2 gap-0 divide-x divide-[#E5DFD3]">
              <div className="bg-zinc-50/80 px-4 py-4">
                <p className="text-[10px] font-semibold tracking-wider text-zinc-400 uppercase">
                  План
                </p>
                <p className="mt-2 text-2xl font-bold tabular-nums text-zinc-500">
                  {formatNum(fuelPlan, 0)}
                  <span className="ml-1 text-sm font-semibold">л</span>
                </p>
              </div>
              <div className="px-4 py-4">
                <p className="text-[10px] font-semibold tracking-wider text-emerald-600 uppercase">
                  Факт
                </p>
                <div className="mt-1 flex items-baseline gap-1.5">
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    value={fuelFact}
                    onChange={(e) => setFuelFact(e.target.value)}
                    className={cn(
                      "w-full min-w-0 border-0 bg-transparent p-0",
                      "text-2xl font-bold tabular-nums text-zinc-900",
                      "outline-none",
                      "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    )}
                  />
                  <span className="shrink-0 text-sm font-semibold text-zinc-400">
                    л
                  </span>
                </div>
              </div>
            </div>
          </section>

          <section className="overflow-hidden rounded-2xl border border-[#E5DFD3] bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-[#E5DFD3]/80 bg-[#FAFAF8] px-4 py-2.5">
              <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.1em] text-zinc-500 uppercase">
                <Wallet className="h-3.5 w-3.5" />
                Оплата
              </p>
              <MetricDelta fact={wageFactNum} plan={wagePlan} unit="₴" />
            </div>
            <div className="grid grid-cols-2 gap-0 divide-x divide-[#E5DFD3]">
              <div className="bg-zinc-50/80 px-4 py-4">
                <p className="text-[10px] font-semibold tracking-wider text-zinc-400 uppercase">
                  План
                </p>
                <p className="mt-2 text-2xl font-bold tabular-nums text-zinc-500">
                  {formatNum(wagePlan, 0)}
                  <span className="ml-1 text-sm font-semibold">₴</span>
                </p>
              </div>
              <div className="px-4 py-4">
                <p className="text-[10px] font-semibold tracking-wider text-emerald-600 uppercase">
                  Факт
                </p>
                <div className="mt-1 flex items-baseline gap-1.5">
                  <input
                    type="number"
                    step="1"
                    min="0"
                    value={wageFact}
                    onChange={(e) => setWageFact(e.target.value)}
                    className={cn(
                      "w-full min-w-0 border-0 bg-transparent p-0",
                      "text-2xl font-bold tabular-nums text-zinc-900",
                      "outline-none",
                      "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    )}
                  />
                  <span className="shrink-0 text-sm font-semibold text-zinc-400">
                    ₴
                  </span>
                </div>
              </div>
            </div>
          </section>

          <div className="space-y-2">
            <Label className="text-[11px] font-semibold tracking-[0.08em] text-zinc-500 uppercase">
              Коментар агронома
            </Label>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={3}
              placeholder="Зауваження до наряду…"
              className={cn(
                "w-full resize-none rounded-xl border border-[#E5DFD3] bg-white px-3 py-2.5",
                "text-sm text-zinc-900 outline-none",
                "focus-visible:border-[#276749]/45 focus-visible:ring-2 focus-visible:ring-[#276749]/15"
              )}
            />
          </div>

          {error ? (
            <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {error}
            </p>
          ) : null}
        </div>
      </div>

      <div className="shrink-0 border-t border-[#E5DFD3] bg-gradient-to-t from-[#EDE8DF] to-[#F4F1EA] px-6 py-4">
        <button
          type="submit"
          disabled={saving}
          className={cn(
            "inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl",
            "bg-[#276749] text-sm font-semibold text-white",
            "transition hover:brightness-105 disabled:opacity-60"
          )}
        >
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <CheckCircle2 className="h-4 w-4" />
          )}
          Підтвердити факт
        </button>
      </div>
    </form>
  );
}

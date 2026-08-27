"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import { uk } from "date-fns/locale";
import {
  CheckCircle2,
  Loader2,
  MapPin,
  Radar,
  RefreshCw,
  Tractor,
  XCircle,
} from "lucide-react";

import {
  dismissRadarRefueling,
  getUnrecordedRefuelings,
} from "@/app/fuel/actions";
import {
  FuelSheetHeader,
  fuelFieldLabelClass,
  fuelPrimaryBtnClass,
  fuelSelectTriggerClass,
  fuelSheetBodyClass,
  fuelSheetContentClass,
} from "@/components/dashboard/fuel-sheet-chrome";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
} from "@/components/ui/sheet";
import {
  UNRECORDED_LOOKBACK_HOURS,
  type UnrecordedRefueling,
} from "@/lib/fuel-unrecorded-refuelings";
import type { FuelStorage } from "@/lib/fuel-storages";
import { cn } from "@/lib/utils";

const POLL_MS = 5 * 60 * 1000;

function eventKey(event: UnrecordedRefueling): string {
  return `${event.unitId}:${event.time}:${Math.round(event.volume * 100)}`;
}

function defaultMobileId(storages: FuelStorage[]): string {
  return (
    storages.find((s) => s.type === "mobile")?.id ??
    storages[0]?.id ??
    ""
  );
}

function formatEventTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return format(date, "HH:mm", { locale: uk });
}

function formatEventDay(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return format(date, "d MMM", { locale: uk });
}

function formatLiters(n: number): string {
  return Math.round(n).toLocaleString("uk-UA");
}

type Props = {
  storages: FuelStorage[];
  /** Після успішного «Схвалити» — оновити склади / журнал */
  onApproved?: () => void;
  /**
   * compact — приглушений рядок
   * commandBar — кнопка в Command Bar («Радар: Чисто» / «Знайдено N»)
   */
  variant?: "standalone" | "compact" | "commandBar";
  className?: string;
};

export function FuelRefuelRadar({
  storages,
  onApproved,
  variant = "standalone",
  className,
}: Props) {
  const [events, setEvents] = useState<UnrecordedRefueling[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sourceByKey, setSourceByKey] = useState<Record<string, string>>({});
  const [litersByKey, setLitersByKey] = useState<Record<string, string>>({});
  const [approvingKey, setApprovingKey] = useState<string | null>(null);
  const [dismissingKey, setDismissingKey] = useState<string | null>(null);
  const [rowError, setRowError] = useState<Record<string, string>>({});

  const storagesRef = useRef(storages);
  storagesRef.current = storages;

  const mobileDefault = useMemo(
    () => defaultMobileId(storages),
    [storages]
  );

  const scan = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getUnrecordedRefuelings({
        lookbackHours: UNRECORDED_LOOKBACK_HOURS,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const defaultId = defaultMobileId(storagesRef.current);
      setEvents(result.data);
      setSourceByKey((prev) => {
        const next = { ...prev };
        for (const event of result.data) {
          const key = eventKey(event);
          if (!next[key]) next[key] = defaultId;
        }
        return next;
      });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Помилка сканування трекерів"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void scan();
    const id = window.setInterval(() => {
      void scan();
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [scan]);

  useEffect(() => {
    if (!mobileDefault) return;
    setSourceByKey((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const event of events) {
        const key = eventKey(event);
        if (!next[key]) {
          next[key] = mobileDefault;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [mobileDefault, events]);

  /** Оператор може виправити обʼєм: ДУТ інколи занижує на «сходинках» */
  const litersFor = useCallback(
    (event: UnrecordedRefueling): number => {
      const raw = litersByKey[eventKey(event)];
      if (raw == null || raw.trim() === "") return event.volume;
      const parsed = Number(raw.replace(",", "."));
      return Number.isFinite(parsed) && parsed > 0 ? parsed : event.volume;
    },
    [litersByKey]
  );

  const dismiss = useCallback(
    async (event: UnrecordedRefueling) => {
      const key = eventKey(event);
      setDismissingKey(key);
      setRowError((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      try {
        const result = await dismissRadarRefueling({
          unitId: event.unitId,
          timeIso: event.timeIso,
          volumeLiters: event.volume,
        });
        if (!result.ok) throw new Error(result.error);
        setEvents((prev) => prev.filter((e) => eventKey(e) !== key));
      } catch (err) {
        setRowError((prev) => ({
          ...prev,
          [key]:
            err instanceof Error ? err.message : "Не вдалося відхилити подію",
        }));
      } finally {
        setDismissingKey(null);
      }
    },
    []
  );

  const approve = useCallback(
    async (event: UnrecordedRefueling) => {
      const key = eventKey(event);
      const fromStorageId = sourceByKey[key] || mobileDefault;
      if (!fromStorageId) {
        setRowError((prev) => ({
          ...prev,
          [key]: "Оберіть склад-джерело (бензовоз)",
        }));
        return;
      }
      const amountLiters = litersFor(event);
      if (!(amountLiters > 0)) {
        setRowError((prev) => ({
          ...prev,
          [key]: "Вкажіть обʼєм більше нуля",
        }));
        return;
      }

      setApprovingKey(key);
      setRowError((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });

      try {
        const response = await fetch("/api/fuel/transactions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            transactionType: "outbound",
            amountLiters,
            fromStorageId,
            wialonUnitId: event.unitId,
            hasFuelSensor: true,
            sensorSourced: true,
            transactionDate: event.timeIso,
            operatorName: "Wialon Radar",
          }),
        });
        const data = (await response.json()) as {
          ok?: boolean;
          error?: string;
        };
        if (!response.ok || !data.ok) {
          throw new Error(data.error || "Не вдалося створити заправку");
        }

        setEvents((prev) => prev.filter((e) => eventKey(e) !== key));
        onApproved?.();
      } catch (err) {
        setRowError((prev) => ({
          ...prev,
          [key]:
            err instanceof Error ? err.message : "Помилка створення транзакції",
        }));
      } finally {
        setApprovingKey(null);
      }
    },
    [sourceByKey, mobileDefault, onApproved, litersFor]
  );

  const count = events.length;
  const hasAlerts = count > 0;
  const isCompact = variant === "compact";
  const isCommandBar = variant === "commandBar";

  const sheet = (
    <Sheet open={drawerOpen} onOpenChange={setDrawerOpen} modal={false}>
      <SheetContent
        side="right"
        showOverlay={false}
        className={fuelSheetContentClass}
      >
        <FuelSheetHeader
          icon={Radar}
          accent="amber"
          title="Необліковані заправки"
          description="Стрибки ДУТ за останні 7 днів · схваліть і спишемо зі складу"
          meta={
            hasAlerts ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-500/10 px-2.5 py-1 text-[11px] font-semibold text-rose-800 ring-1 ring-rose-500/15">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-75" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-rose-500" />
                </span>
                Знайдено {count}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-800 ring-1 ring-emerald-500/15">
                Чисто · немає розбіжностей
              </span>
            )
          }
        />

        <div className={cn(fuelSheetBodyClass, "gap-3")}>
          {events.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-zinc-200/70 bg-white/80 py-12 text-center shadow-sm">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 ring-1 ring-emerald-500/20">
                <CheckCircle2 className="h-6 w-6" />
              </div>
              <p className="text-sm font-semibold text-zinc-800">
                Список порожній
              </p>
              <p className="max-w-[14rem] text-xs leading-relaxed text-zinc-500">
                Усі виявлені заправки вже схвалені або обліковані в журналі
              </p>
              <Button
                type="button"
                variant="secondary"
                onClick={() => void scan()}
                disabled={loading}
                className="mt-1 h-9 gap-2 rounded-xl text-xs font-semibold"
              >
                {loading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                Сканувати ще раз
              </Button>
            </div>
          ) : (
            <ul className="space-y-3">
              {events.map((event) => {
                const key = eventKey(event);
                const sourceId = sourceByKey[key] || mobileDefault;
                const busy = approvingKey === key;
                const rejecting = dismissingKey === key;
                const amount = litersFor(event);
                const edited = Math.abs(amount - event.volume) > 0.05;
                const donor = storages.find((s) => s.id === sourceId);
                const insufficient =
                  donor != null && donor.currentVolume + 0.001 < amount;

                return (
                  <li
                    key={key}
                    className="overflow-hidden rounded-2xl border border-zinc-200/80 bg-white shadow-[0_1px_2px_rgba(24,24,27,0.04),0_10px_28px_-14px_rgba(24,24,27,0.16)]"
                  >
                    <div className="flex items-start gap-3 border-b border-zinc-100 bg-gradient-to-br from-zinc-50/80 to-white px-4 py-3.5">
                      <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-600 text-white shadow-md shadow-emerald-600/25">
                        <Tractor className="h-5 w-5" strokeWidth={1.8} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[15px] font-bold tracking-tight text-zinc-900">
                          {event.equipmentName}
                        </p>
                        {event.location.label ||
                        (event.location.lat != null &&
                          event.location.lng != null) ? (
                          <p className="mt-1 flex items-center gap-1 text-[11px] text-zinc-500">
                            <MapPin className="h-3 w-3 shrink-0 text-zinc-400" />
                            <span className="truncate">
                              {event.location.label ??
                                `${event.location.lat?.toFixed(5)}, ${event.location.lng?.toFixed(5)}`}
                            </span>
                          </p>
                        ) : (
                          <p className="mt-1 text-[11px] text-zinc-400">
                            Локація GPS недоступна
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 px-4 pt-3">
                      <div className="rounded-xl border border-zinc-100 bg-zinc-50/80 px-3 py-2.5">
                        <p className="text-[10px] font-semibold tracking-[0.08em] text-zinc-400 uppercase">
                          Час
                        </p>
                        <p className="mt-0.5 text-sm font-bold tabular-nums text-zinc-900">
                          {formatEventTime(event.timeIso)}
                        </p>
                        {formatEventDay(event.timeIso) ? (
                          <p className="text-[11px] text-zinc-500">
                            {formatEventDay(event.timeIso)}
                          </p>
                        ) : null}
                      </div>
                      <div className="rounded-xl border border-emerald-100 bg-emerald-50/70 px-3 py-2">
                        <label
                          htmlFor={`radar-liters-${key}`}
                          className="text-[10px] font-semibold tracking-[0.08em] text-emerald-700/70 uppercase"
                        >
                          Обʼєм
                        </label>
                        <div className="mt-0.5 flex items-baseline gap-1">
                          <input
                            id={`radar-liters-${key}`}
                            type="number"
                            inputMode="decimal"
                            min={0}
                            step="0.1"
                            value={litersByKey[key] ?? String(event.volume)}
                            onChange={(e) =>
                              setLitersByKey((prev) => ({
                                ...prev,
                                [key]: e.target.value,
                              }))
                            }
                            className="w-full min-w-0 border-0 bg-transparent p-0 text-sm font-bold tabular-nums text-emerald-900 outline-none focus:ring-0"
                          />
                          <span className="text-sm font-bold text-emerald-800">
                            л
                          </span>
                        </div>
                        <p className="text-[11px] text-emerald-700/70">
                          {edited
                            ? `ДУТ показав ${formatLiters(event.volume)} л`
                            : "ДУТ · можна виправити"}
                        </p>
                      </div>
                    </div>

                    <div className="space-y-1.5 px-4 pt-3">
                      <label className={fuelFieldLabelClass}>Джерело</label>
                      <Select
                        items={storages.map((s) => ({
                          value: s.id,
                          label: s.name,
                        }))}
                        value={sourceId || null}
                        onValueChange={(v) => {
                          if (typeof v === "string" && v) {
                            setSourceByKey((prev) => ({ ...prev, [key]: v }));
                          }
                        }}
                      >
                        <SelectTrigger className={fuelSelectTriggerClass}>
                          <SelectValue placeholder="Оберіть склад">
                            {donor
                              ? `${donor.name}${donor.type === "mobile" ? " · бензовоз" : ""}`
                              : null}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent className="z-[80] rounded-2xl border border-zinc-200 bg-white p-1.5 text-zinc-900 shadow-lg">
                          {storages.length === 0 ? (
                            <SelectItem value="__none" disabled>
                              Немає складів
                            </SelectItem>
                          ) : (
                            storages.map((s) => (
                              <SelectItem
                                key={s.id}
                                value={s.id}
                                className="cursor-pointer rounded-xl px-3 py-2.5"
                              >
                                <div className="flex min-w-0 flex-col gap-0.5">
                                  <span className="truncate font-semibold text-zinc-900">
                                    {s.name}
                                  </span>
                                  <span className="text-xs text-zinc-500">
                                    {s.type === "mobile"
                                      ? "Бензовоз"
                                      : "Стаціонарний"}
                                    {" · "}
                                    {formatLiters(s.currentVolume)} л
                                  </span>
                                </div>
                              </SelectItem>
                            ))
                          )}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="px-4 pt-2 pb-4">
                      {insufficient ? (
                        <p className="mb-2 text-xs font-medium text-rose-600">
                          Недостатньо палива в джерелі (
                          {formatLiters(donor?.currentVolume ?? 0)} л)
                        </p>
                      ) : null}
                      {rowError[key] ? (
                        <p className="mb-2 text-xs font-medium text-rose-600">
                          {rowError[key]}
                        </p>
                      ) : null}

                      <div className="flex gap-2">
                        <Button
                          type="button"
                          disabled={
                            busy ||
                            rejecting ||
                            !sourceId ||
                            insufficient ||
                            storages.length === 0
                          }
                          onClick={() => void approve(event)}
                          className={cn(
                            fuelPrimaryBtnClass,
                            "h-11 flex-1 bg-emerald-600 hover:bg-emerald-700 shadow-emerald-600/30"
                          )}
                        >
                          {busy ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <CheckCircle2 className="mr-2 h-4 w-4" />
                          )}
                          Схвалити
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          disabled={busy || rejecting}
                          onClick={() => void dismiss(event)}
                          title="Хибне спрацювання ДУТ — прибрати з радара"
                          className="h-11 gap-2 rounded-xl border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-600 hover:bg-zinc-50 hover:text-rose-700"
                        >
                          {rejecting ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <XCircle className="h-4 w-4" />
                          )}
                          Відхилити
                        </Button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );

  if (isCommandBar) {
    return (
      <div className={cn("flex w-full flex-1 flex-col", className)}>
        <Button
          type="button"
          disabled={loading && !hasAlerts}
          onClick={() => {
            if (hasAlerts) setDrawerOpen(true);
            else void scan();
          }}
          className={cn(
            "h-auto min-h-14 w-full flex-1 flex-col items-start justify-center gap-0.5 rounded-2xl px-4 py-3",
            "text-left shadow-sm",
            hasAlerts
              ? "border border-rose-200/80 bg-gradient-to-br from-rose-50 to-white text-rose-950 hover:from-rose-100/90"
              : "border border-zinc-200/80 bg-gradient-to-br from-zinc-50 to-white text-zinc-800 hover:from-zinc-100/80"
          )}
        >
          <span className="inline-flex items-center gap-2 text-sm font-bold">
            <span
              className={cn(
                "relative inline-flex h-7 w-7 items-center justify-center rounded-xl text-white shadow-sm",
                hasAlerts ? "bg-rose-600" : "bg-zinc-700"
              )}
            >
              <Radar className="h-3.5 w-3.5" strokeWidth={2} />
              {hasAlerts ? (
                <span className="absolute -top-0.5 -right-0.5 flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-rose-300" />
                </span>
              ) : null}
            </span>
            {loading && !hasAlerts
              ? "Сканування…"
              : hasAlerts
                ? `Радар: ${count}`
                : "Радар: Чисто"}
          </span>
          <span
            className={cn(
              "pl-9 text-[11px] font-medium",
              hasAlerts ? "text-rose-800/70" : "text-zinc-500"
            )}
          >
            {hasAlerts ? "Необліковані заправки" : "Останні 7 днів"}
          </span>
        </Button>
        {error ? (
          <p className="mt-1 max-w-[12rem] text-right text-[10px] text-rose-600">
            {error}
          </p>
        ) : null}
        {sheet}
      </div>
    );
  }

  if (isCompact) {
    return (
      <div className={cn("min-w-0", className)}>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              if (hasAlerts) setDrawerOpen(true);
              else void scan();
            }}
            className={cn(
              "inline-flex min-w-0 items-center gap-2 rounded-lg px-1.5 py-1 text-left transition",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/30",
              hasAlerts
                ? "text-amber-800 hover:bg-amber-500/10"
                : "text-muted-foreground hover:text-zinc-600"
            )}
          >
            <span className="relative inline-flex h-5 w-5 shrink-0 items-center justify-center">
              <Radar
                className={cn(
                  "h-4 w-4",
                  hasAlerts ? "text-amber-600" : "text-muted-foreground"
                )}
                strokeWidth={2}
              />
              {hasAlerts ? (
                <span className="absolute -top-0.5 -right-0.5 flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-orange-500" />
                </span>
              ) : null}
            </span>
            <span className="min-w-0 text-xs leading-snug">
              {loading && !hasAlerts ? (
                <span className="inline-flex items-center gap-1.5">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Сканування…
                </span>
              ) : hasAlerts ? (
                <span className="font-semibold text-amber-900">
                  Wialon: необліковані заправки ({count})
                </span>
              ) : (
                <span>Радар Заправок · усе обліковано</span>
              )}
            </span>
          </button>

          <button
            type="button"
            title="Сканувати трекери"
            disabled={loading}
            onClick={() => void scan()}
            className={cn(
              "inline-flex h-7 w-7 items-center justify-center rounded-md",
              "text-muted-foreground transition hover:bg-zinc-900/5 hover:text-zinc-700",
              "disabled:opacity-50"
            )}
          >
            <RefreshCw
              className={cn("h-3.5 w-3.5", loading && "animate-spin")}
            />
            <span className="sr-only">Сканувати трекери</span>
          </button>
        </div>

        {error ? (
          <p className="mt-1 text-[11px] text-rose-600">{error}</p>
        ) : null}

        {sheet}
      </div>
    );
  }

  return (
    <section className={cn("mb-6 space-y-3", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-amber-100 text-amber-800">
            <Radar className="h-4 w-4" strokeWidth={2} />
          </span>
          <div>
            <p className="text-sm font-semibold text-zinc-900">
              Радар Заправок
            </p>
            <p className="text-[11px] text-zinc-500">
              Zero-Data Entry · Wialon ДУТ · автоскан кожні 5 хв
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={loading}
          onClick={() => void scan()}
          className="h-9 gap-2 rounded-xl border-zinc-200 bg-white/80 text-xs font-semibold"
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          Сканувати трекери
        </Button>
      </div>

      {error ? (
        <p className="text-xs font-medium text-rose-600">{error}</p>
      ) : null}

      {hasAlerts ? (
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          className={cn(
            "w-full rounded-2xl border border-amber-300/90 bg-gradient-to-br from-amber-50 via-orange-50 to-white",
            "px-4 py-3.5 text-left shadow-sm transition",
            "hover:border-amber-400 hover:shadow-md",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/35"
          )}
        >
          <p className="text-sm font-semibold text-amber-950">
            📡 Wialon виявив необліковані заправки ({count})
          </p>
          <p className="mt-0.5 text-xs text-amber-900/75">
            Натисніть, щоб переглянути та схвалити списання з бензовоза
          </p>
        </button>
      ) : !loading && !error ? (
        <p className="text-xs text-muted-foreground">
          Необлікованих заправок немає — усі події ДУТ зіставлені з журналом
        </p>
      ) : null}

      {sheet}
    </section>
  );
}

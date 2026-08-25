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
} from "lucide-react";

import { getUnrecordedRefuelings } from "@/app/fuel/actions";
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
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { UnrecordedRefueling } from "@/lib/fuel-unrecorded-refuelings";
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
  const [approvingKey, setApprovingKey] = useState<string | null>(null);
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
      const result = await getUnrecordedRefuelings({ lookbackHours: 48 });
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
            amountLiters: event.volume,
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
    [sourceByKey, mobileDefault, onApproved]
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
        className={cn(
          "w-full gap-0 overflow-hidden border-l border-zinc-200/80 bg-background p-0 shadow-xl sm:max-w-md",
          "[&_[data-slot=sheet-close]]:text-zinc-500"
        )}
      >
        <SheetHeader className="shrink-0 border-b border-border/50 px-5 py-4 pr-12">
          <SheetTitle className="flex items-center gap-2 text-base font-bold text-zinc-900">
            <Radar className="h-4 w-4 text-amber-600" />
            Необліковані заправки
          </SheetTitle>
          <SheetDescription className="text-xs text-muted-foreground">
            Wialon ДУТ · видно залишки складів під час схвалення
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {events.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <CheckCircle2 className="h-8 w-8 text-emerald-500" />
              <p className="text-sm font-medium text-zinc-800">
                Список порожній
              </p>
              <p className="text-xs text-zinc-500">
                Усі виявлені заправки вже схвалені або обліковані
              </p>
            </div>
          ) : (
            <ul className="space-y-3">
              {events.map((event) => {
                const key = eventKey(event);
                const sourceId = sourceByKey[key] || mobileDefault;
                const busy = approvingKey === key;
                const donor = storages.find((s) => s.id === sourceId);
                const insufficient =
                  donor != null && donor.currentVolume + 0.001 < event.volume;

                return (
                  <li
                    key={key}
                    className="rounded-2xl border border-zinc-200/90 bg-white p-4 shadow-sm"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <Tractor className="h-4 w-4 shrink-0 text-emerald-600" />
                          <p className="truncate text-sm font-semibold text-zinc-900">
                            {event.equipmentName}
                          </p>
                        </div>
                        <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
                          <span>
                            Час:{" "}
                            <span className="font-semibold tabular-nums text-zinc-800">
                              {formatEventTime(event.timeIso)}
                            </span>
                            {formatEventDay(event.timeIso) ? (
                              <span className="text-zinc-400">
                                {" "}
                                · {formatEventDay(event.timeIso)}
                              </span>
                            ) : null}
                          </span>
                          <span>
                            Обʼєм:{" "}
                            <span className="font-semibold tabular-nums text-emerald-700">
                              +{formatLiters(event.volume)} л
                            </span>
                          </span>
                        </p>
                        {event.location.label ||
                        (event.location.lat != null &&
                          event.location.lng != null) ? (
                          <p className="mt-1 flex items-center gap-1 text-[11px] text-zinc-400">
                            <MapPin className="h-3 w-3 shrink-0" />
                            <span className="truncate">
                              {event.location.label ??
                                `${event.location.lat?.toFixed(5)}, ${event.location.lng?.toFixed(5)}`}
                            </span>
                          </p>
                        ) : null}
                      </div>
                    </div>

                    <div className="mt-3 space-y-1.5">
                      <label className="text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
                        Джерело
                      </label>
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
                        <SelectTrigger
                          className={cn(
                            "h-11 w-full min-w-0 rounded-xl border border-zinc-200 bg-zinc-50 px-3",
                            "text-sm font-medium text-zinc-900",
                            "outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-900/10"
                          )}
                        >
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

                    {insufficient ? (
                      <p className="mt-2 text-xs font-medium text-rose-600">
                        Недостатньо палива в джерелі (
                        {formatLiters(donor?.currentVolume ?? 0)} л)
                      </p>
                    ) : null}
                    {rowError[key] ? (
                      <p className="mt-2 text-xs font-medium text-rose-600">
                        {rowError[key]}
                      </p>
                    ) : null}

                    <Button
                      type="button"
                      disabled={
                        busy ||
                        !sourceId ||
                        insufficient ||
                        storages.length === 0
                      }
                      onClick={() => void approve(event)}
                      className={cn(
                        "mt-3 h-10 w-full rounded-xl bg-emerald-600 text-sm font-semibold text-white",
                        "hover:bg-emerald-700",
                        "disabled:opacity-60"
                      )}
                    >
                      {busy ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <CheckCircle2 className="mr-2 h-4 w-4" />
                      )}
                      Схвалити
                    </Button>
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
      <div className={cn("shrink-0", className)}>
        <Button
          type="button"
          variant="secondary"
          disabled={loading && !hasAlerts}
          onClick={() => {
            if (hasAlerts) setDrawerOpen(true);
            else void scan();
          }}
          className={cn(
            "relative h-10 gap-2 rounded-xl px-3.5 text-sm font-semibold",
            hasAlerts
              ? "bg-rose-500/10 text-rose-800 hover:bg-rose-500/15 hover:text-rose-900"
              : "text-muted-foreground hover:text-zinc-700"
          )}
        >
          <span className="relative inline-flex h-4 w-4 shrink-0 items-center justify-center">
            <Radar className="h-4 w-4" strokeWidth={2} />
            {hasAlerts ? (
              <span className="absolute -top-0.5 -right-0.5 flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-rose-500" />
              </span>
            ) : null}
          </span>
          {loading && !hasAlerts ? (
            <span className="inline-flex items-center gap-1.5">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Сканування…
            </span>
          ) : hasAlerts ? (
            `Радар: Знайдено ${count}`
          ) : (
            "Радар: Чисто"
          )}
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

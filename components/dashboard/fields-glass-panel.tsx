"use client";

import { useMemo, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Activity,
  ChevronDown,
  ChevronUp,
  Focus,
  Map as MapIcon,
  Search,
} from "lucide-react";

import { COMMAND_CENTER_GLASS_PANEL_CLASS } from "@/lib/equipment-command-center-layout";
import type { MapFieldItem } from "@/lib/map-fields";
import { formatCountPlural } from "@/lib/plural";
import { cn } from "@/lib/utils";

type FieldsGlassPanelProps = {
  fields: MapFieldItem[];
  loading: boolean;
  selectedId: string | null;
  hoveredId: string | null;
  editingFieldId: string | null;
  totalHa: number;
  liveConnected: boolean;
  livePulse: boolean;
  statusHint: string | null;
  saveHint: string | null;
  budgetByFieldId?: Record<string, number | null>;
  mobileExpanded: boolean;
  onMobileExpandedChange: (v: boolean) => void;
  onSelect: (field: MapFieldItem) => void;
  onHover: (fieldId: string | null) => void;
  onFitAll: () => void;
};

function formatHa(areaHa: number) {
  return areaHa.toLocaleString("uk-UA", {
    maximumFractionDigits: 1,
    minimumFractionDigits: 0,
  });
}

function budgetTone(pct: number | null) {
  if (pct == null) {
    return {
      bar: "bg-zinc-300/80",
      fill: 0,
      text: "text-zinc-400",
      label: "—",
    };
  }
  const fill = Math.min(100, Math.max(0, pct));
  if (pct > 100) {
    return {
      bar: "bg-rose-500",
      fill: 100,
      text: "text-rose-600",
      label: `${Math.round(pct)}%`,
    };
  }
  if (pct >= 70) {
    return {
      bar: "bg-amber-400",
      fill,
      text: "text-amber-700",
      label: `${Math.round(pct)}%`,
    };
  }
  return {
    bar: "bg-emerald-500",
    fill,
    text: "text-emerald-700",
    label: `${Math.round(pct)}%`,
  };
}

/** Урочище: «Василиха №1» → «Василиха» */
function fieldGroupLabel(name: string): string {
  const trimmed = name.trim();
  const numbered = trimmed.match(/^(.*?)(?:\s*[№#N]\s*\d+)$/i);
  if (numbered && numbered[1].trim().length >= 2) {
    return numbered[1].trim();
  }
  const trailingDigits = trimmed.match(/^(.*?)(\d+)$/);
  if (
    trailingDigits &&
    trailingDigits[1].trim().length >= 3 &&
    trailingDigits[2].length <= 3
  ) {
    return trailingDigits[1].trim();
  }
  return trimmed;
}

function FieldRow({
  field,
  active,
  hovered,
  editing,
  budgetPct,
  onOpen,
  onHover,
}: {
  field: MapFieldItem;
  active: boolean;
  hovered: boolean;
  editing: boolean;
  budgetPct: number | null;
  onOpen: () => void;
  onHover: (id: string | null) => void;
}) {
  const tone = budgetTone(budgetPct);
  const crop = field.crop?.trim();

  return (
    <button
      type="button"
      onClick={onOpen}
      onMouseEnter={() => onHover(field.id)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(field.id)}
      onBlur={() => onHover(null)}
      className={cn(
        "group relative flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left transition-colors",
        active
          ? "bg-emerald-600/12 ring-1 ring-emerald-500/35"
          : hovered
            ? "bg-white/55"
            : "hover:bg-white/40"
      )}
    >
      <span
        className="h-8 w-[3px] shrink-0 rounded-full"
        style={{ backgroundColor: field.color }}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="truncate text-[13px] font-semibold tracking-tight text-zinc-900">
            {field.name}
            {editing ? (
              <span className="ml-1.5 text-[10px] font-medium text-amber-700">
                контур
              </span>
            ) : null}
          </p>
          <p className="shrink-0 text-[11px] font-semibold tabular-nums text-zinc-700">
            {formatHa(field.areaHa)}
            <span className="ml-0.5 font-medium text-zinc-400">га</span>
          </p>
        </div>
        <div className="mt-1 flex items-center gap-2">
          <p className="min-w-0 flex-1 truncate text-[10px] font-medium text-zinc-500">
            {crop && crop !== "—" ? crop : "Без культури"}
          </p>
          <div className="h-[3px] w-16 shrink-0 overflow-hidden rounded-full bg-zinc-200/80">
            <div
              className={cn("h-full rounded-full", tone.bar)}
              style={{ width: `${tone.fill}%` }}
            />
          </div>
          <span
            className={cn(
              "w-8 shrink-0 text-right text-[10px] font-bold tabular-nums",
              tone.text
            )}
            title={
              budgetPct == null
                ? "Бюджет не задано"
                : `Витрачено ${tone.label} бюджету`
            }
          >
            {tone.label}
          </span>
        </div>
      </div>
      <span
        className={cn("h-1.5 w-1.5 shrink-0 rounded-full", tone.bar)}
        aria-hidden
      />
    </button>
  );
}

export function FieldsGlassPanel({
  fields,
  loading,
  selectedId,
  hoveredId,
  editingFieldId,
  totalHa,
  liveConnected,
  livePulse,
  statusHint,
  saveHint,
  budgetByFieldId = {},
  mobileExpanded,
  onMobileExpandedChange,
  onSelect,
  onHover,
  onFitAll,
}: FieldsGlassPanelProps) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return fields;
    return fields.filter((field) => {
      const crop = field.crop?.toLowerCase() ?? "";
      return field.name.toLowerCase().includes(q) || crop.includes(q);
    });
  }, [fields, query]);

  const groups = useMemo(() => {
    const order: string[] = [];
    const map = new Map<string, MapFieldItem[]>();
    for (const field of filtered) {
      const label = fieldGroupLabel(field.name);
      if (!map.has(label)) {
        order.push(label);
        map.set(label, []);
      }
      map.get(label)!.push(field);
    }
    const clustered = order
      .map((label) => ({ label, items: map.get(label)! }))
      .filter((group) => group.items.length >= 2);
    const clusteredIds = new Set(
      clustered.flatMap((group) => group.items.map((item) => item.id))
    );
    const rest = filtered.filter((field) => !clusteredIds.has(field.id));
    return { clustered, rest };
  }, [filtered]);

  function budgetFor(field: MapFieldItem) {
    const key = (field.farmField?.id ?? field.id).toLowerCase();
    return budgetByFieldId[key] ?? null;
  }

  const listBody = (
    <div className="space-y-2.5">
      {groups.clustered.map((group) => {
        const groupHa = group.items.reduce((sum, field) => sum + field.areaHa, 0);
        const accent = group.items[0]?.color ?? "#276749";
        return (
          <section
            key={group.label}
            className="overflow-hidden rounded-2xl border border-white/40 bg-white/30 shadow-[0_8px_24px_-16px_rgba(24,24,27,0.45)]"
          >
            <div className="flex items-center gap-2.5 border-b border-white/35 bg-gradient-to-r from-white/70 to-white/25 px-2.5 py-2">
              <span
                className="h-7 w-1 shrink-0 rounded-full"
                style={{ backgroundColor: accent }}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-bold tracking-tight text-zinc-900">
                  {group.label}
                </p>
                <p className="text-[10px] font-medium tabular-nums text-zinc-500">
                  {formatCountPlural(group.items.length, [
                    "ділянка",
                    "ділянки",
                    "ділянок",
                  ])}
                  {" · "}
                  {formatHa(groupHa)} га
                </p>
              </div>
            </div>
            <div className="space-y-0.5 p-1">
              {group.items.map((field) => (
                <FieldRow
                  key={field.id}
                  field={field}
                  active={selectedId === field.id || editingFieldId === field.id}
                  hovered={hoveredId === field.id}
                  editing={editingFieldId === field.id}
                  budgetPct={budgetFor(field)}
                  onOpen={() => onSelect(field)}
                  onHover={onHover}
                />
              ))}
            </div>
          </section>
        );
      })}
      {groups.rest.length > 0 ? (
        groups.clustered.length > 0 ? (
          <section className="overflow-hidden rounded-2xl border border-white/40 bg-white/30 shadow-[0_8px_24px_-16px_rgba(24,24,27,0.45)]">
            <div className="flex items-center gap-2.5 border-b border-white/35 bg-gradient-to-r from-white/70 to-white/25 px-2.5 py-2">
              <span
                className="h-7 w-1 shrink-0 rounded-full bg-zinc-400"
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-bold tracking-tight text-zinc-900">
                  Інші ділянки
                </p>
                <p className="text-[10px] font-medium tabular-nums text-zinc-500">
                  {formatCountPlural(groups.rest.length, [
                    "ділянка",
                    "ділянки",
                    "ділянок",
                  ])}
                </p>
              </div>
            </div>
            <div className="space-y-0.5 p-1">
              {groups.rest.map((field) => (
                <FieldRow
                  key={field.id}
                  field={field}
                  active={selectedId === field.id || editingFieldId === field.id}
                  hovered={hoveredId === field.id}
                  editing={editingFieldId === field.id}
                  budgetPct={budgetFor(field)}
                  onOpen={() => onSelect(field)}
                  onHover={onHover}
                />
              ))}
            </div>
          </section>
        ) : (
          <div className="space-y-0.5">
            {groups.rest.map((field) => (
              <FieldRow
                key={field.id}
                field={field}
                active={selectedId === field.id || editingFieldId === field.id}
                hovered={hoveredId === field.id}
                editing={editingFieldId === field.id}
                budgetPct={budgetFor(field)}
                onOpen={() => onSelect(field)}
                onHover={onHover}
              />
            ))}
          </div>
        )
      ) : null}
    </div>
  );

  const list = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-white/30 px-3 py-3">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-600/90 text-white shadow-md">
            <MapIcon className="h-3.5 w-3.5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-extrabold tracking-tight text-zinc-900">
              Карта полів
            </p>
            <p className="truncate text-[10px] font-medium text-zinc-500">
              {loading
                ? "Завантаження ділянок…"
                : `${formatCountPlural(fields.length, ["ділянка", "ділянки", "ділянок"])} · ${totalHa.toLocaleString("uk-UA")} га`}
            </p>
          </div>
          <div
            className={cn(
              "inline-flex items-center gap-1 rounded-md px-1.5 py-1",
              liveConnected ? "bg-emerald-500/15" : "bg-zinc-200/60"
            )}
            title={
              liveConnected
                ? "Синхронізація з базою в реальному часі"
                : "Підключення до Realtime…"
            }
          >
            <span className="relative flex h-1.5 w-1.5">
              <span
                className={cn(
                  "absolute inline-flex h-full w-full rounded-full opacity-75",
                  liveConnected ? "bg-emerald-500" : "bg-zinc-400",
                  livePulse && liveConnected && "animate-ping"
                )}
              />
              <span
                className={cn(
                  "relative inline-flex h-1.5 w-1.5 rounded-full",
                  liveConnected ? "bg-emerald-500" : "bg-zinc-400"
                )}
              />
            </span>
            <Activity
              className={cn(
                "h-3 w-3",
                liveConnected ? "text-emerald-700" : "text-zinc-400"
              )}
            />
          </div>
          <button
            type="button"
            title="Показати всі на карті"
            onClick={onFitAll}
            className="rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-white/50 hover:text-zinc-800"
          >
            <Focus className="h-4 w-4" />
          </button>
        </div>
        <div className="relative mt-2.5">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Назва або культура"
            className="h-8 w-full rounded-lg border border-white/40 bg-white/45 pr-2.5 pl-8 text-xs font-medium text-zinc-800 outline-none placeholder:text-zinc-400 focus:border-emerald-400/50 focus:bg-white/70"
          />
        </div>
      </div>

      <div
        className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-2 py-2"
        onMouseLeave={() => onHover(null)}
      >
        {loading ? (
          <div className="space-y-2.5">
            {Array.from({ length: 3 }).map((_, group) => (
              <section
                key={group}
                className="overflow-hidden rounded-2xl border border-white/40 bg-white/30"
              >
                <div className="flex items-center gap-2.5 border-b border-white/35 px-2.5 py-2">
                  <span className="h-7 w-1 shrink-0 animate-pulse rounded-full bg-zinc-300/80" />
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="h-3 w-24 animate-pulse rounded bg-zinc-300/70" />
                    <div className="h-2 w-16 animate-pulse rounded bg-zinc-300/45" />
                  </div>
                </div>
                <div className="space-y-0.5 p-1">
                  {Array.from({ length: group === 2 ? 4 : 2 }).map((_, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-2.5 rounded-xl px-2 py-1.5"
                    >
                      <span className="h-8 w-[3px] shrink-0 animate-pulse rounded-full bg-zinc-300/70" />
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <div className="flex items-center justify-between gap-3">
                          <div className="h-3 w-28 animate-pulse rounded bg-zinc-300/70" />
                          <div className="h-3 w-10 animate-pulse rounded bg-zinc-300/50" />
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="h-2 w-16 animate-pulse rounded bg-zinc-300/45" />
                          <div className="h-[3px] min-w-0 flex-1 animate-pulse rounded-full bg-zinc-200/80" />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : fields.length === 0 ? (
          <p className="px-2 py-8 text-center text-xs font-medium text-zinc-500">
            Немає ділянок на карті. Намалюйте контур або перевірте Wialon.
          </p>
        ) : filtered.length === 0 ? (
          <p className="px-2 py-8 text-center text-xs font-medium text-zinc-500">
            Нічого не знайдено за «{query.trim()}».
          </p>
        ) : (
          listBody
        )}
      </div>

      {(saveHint || statusHint) && (
        <div className="shrink-0 border-t border-white/25 px-4 py-2.5">
          <p
            className={cn(
              "text-[11px] leading-snug",
              saveHint ? "text-amber-800" : "text-emerald-800"
            )}
          >
            {saveHint || statusHint}
          </p>
        </div>
      )}
    </div>
  );

  return (
    <>
      <aside
        className={cn(
          COMMAND_CENTER_GLASS_PANEL_CLASS,
          "left-3 w-[min(100%,400px)]"
        )}
      >
        {list}
      </aside>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 md:hidden">
        <div
          className={cn(
            "pointer-events-auto mx-2 mb-2 overflow-hidden rounded-t-2xl border border-white/40 shadow-2xl transition-[max-height] duration-300",
            "bg-background/85 backdrop-blur-2xl",
            mobileExpanded ? "max-h-[min(78vh,680px)]" : "max-h-14"
          )}
        >
          <button
            type="button"
            onClick={() => onMobileExpandedChange(!mobileExpanded)}
            className="flex w-full items-center justify-between border-b border-white/30 px-4 py-3"
          >
            <div className="flex items-center gap-2">
              <MapIcon className="h-4 w-4 text-emerald-700" />
              <span className="text-sm font-bold text-zinc-900">
                Поля ({fields.length})
              </span>
            </div>
            {mobileExpanded ? (
              <ChevronDown className="h-4 w-4 text-zinc-500" />
            ) : (
              <ChevronUp className="h-4 w-4 text-zinc-500" />
            )}
          </button>
          {mobileExpanded ? (
            <div className="flex h-[min(72vh,640px)] flex-col">{list}</div>
          ) : null}
        </div>
      </div>
    </>
  );
}

export function FieldsDetailGlassFrame({ children }: { children: ReactNode }) {
  return (
    <aside
      className={cn(
        "pointer-events-auto absolute z-20 flex flex-col overflow-hidden border border-white/30 bg-[#F4F1EA]/88 shadow-2xl backdrop-blur-2xl",
        "inset-x-2 bottom-2 h-[min(82vh,720px)] rounded-t-2xl",
        "md:inset-x-auto md:top-3 md:right-3 md:bottom-3 md:h-auto md:w-[min(100%,580px)] md:rounded-2xl"
      )}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key="field-detail"
          className="flex h-full min-h-0 flex-col"
          initial={{ x: 28, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 28, opacity: 0 }}
          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </aside>
  );
}

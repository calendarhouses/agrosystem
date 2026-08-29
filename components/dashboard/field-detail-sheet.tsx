"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  endOfDay,
  format,
  startOfDay,
  subDays,
} from "date-fns";
import { uk } from "date-fns/locale";
import type { DateRange } from "react-day-picker";
import {
  Calendar as CalendarIcon,
  CalendarPlus,
  ChartPie,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  Edit3,
  Fuel,
  History,
  Landmark,
  Leaf,
  PackageMinus,
  Pencil,
  Play,
  Settings2,
  Sprout,
  Tractor,
  Trash2,
  Wallet,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";

import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DatePicker } from "@/components/ui/date-picker";
import { TimePicker } from "@/components/ui/time-picker";
import { Button } from "@/components/ui/button";
import {
  deleteFieldOperation,
  estimateAreaHaFromTrack,
  listFieldOperations,
  upsertFieldOperation,
  type FieldOperation,
} from "@/lib/field-operations";
import type { FarmField, FieldGeometry } from "@/lib/farm-fields";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LiveFieldEconomicsPanel, useLiveFieldEconomics } from "@/components/dashboard/live-field-economics-panel";
import { QuickIssueSheet } from "@/components/dashboard/quick-issue-sheet";
import { FieldHistoryTimeline } from "@/components/dashboard/field-history-timeline";
import { FieldIntegrationsPanel } from "@/components/dashboard/field-integrations-panel";
import { FieldMicroclimate } from "@/components/dashboard/field-microclimate";
import {
  FieldPassportForm,
  normalizeFieldCrop,
} from "@/components/dashboard/field-passport-form";
import { FieldPassportQuickFix } from "@/components/dashboard/field-passport-quick-fix";
import { FieldTechHistoryPanel } from "@/components/dashboard/field-tech-history-panel";
import { SmartWeatherAlert } from "@/components/dashboard/smart-weather-alert";
import { OperationClosePanel } from "@/components/dashboard/operation-close-modal";
import type { CloseableOperation } from "@/components/dashboard/operation-close-modal";
import {
  listEquipmentForOps,
  listImplementsForOps,
  type ImplementOption,
} from "@/app/admin/equipment/actions";
import { getDieselPriceUah } from "@/app/fuel/actions";
import { getFieldEvents } from "@/app/admin/fields/actions";
import { useSeasonStore } from "@/lib/season-store";
import { currentAgroSeason } from "@/lib/season";
import type { Field } from "@/lib/dashboard-data";
import type { FieldEvent } from "@/lib/field-events";
import {
  estimatePlanFuelLiters,
  estimatePlanWageUah,
  fuelLitersPerHa,
  IMPLEMENT_PRESETS,
  IMPLEMENT_WIDTH_DEFAULTS,
  OPERATION_TYPES,
  WAGE_UAH_PER_HA,
  isSowingOperationType,
} from "@/lib/field-operation-norms";
import { formatUahCurrency } from "@/lib/fuel-price";
import { isFieldPassportComplete } from "@/lib/field-passport";
import { formatVisitClockHm } from "@/lib/field-tech-history";
import {
  findEquipmentOpsOption,
  mergeEquipmentOpsOptions,
  type EquipmentForOpsRow,
  type EquipmentOpsOption,
} from "@/lib/equipment-ops-options";
import type { WialonGeofenceProperties, WialonUnit } from "@/lib/wialon";
import type { HourlyForecastHour, WeatherSnapshot } from "@/lib/weather";
import type { FeatureCollection, Polygon } from "geojson";
import type { MapFieldSource } from "@/lib/map-fields";
import { toast } from "sonner";
import { SwipeableSheet } from "@/components/ui/swipe-sheet";
import { useIsMobile } from "@/lib/use-mobile";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

export type FieldHubTab = "overview" | "history" | "tech" | "settings";

type FieldDetailSheetProps = {
  field: Field | null;
  /** Стабільний ключ історії цього поля (farm:… / wialon:… / demo:…) */
  fieldKey?: string | null;
  /** Додаткові ключі (напр. wialon до створення паспорта) */
  legacyFieldKeys?: string[];
  /** UUID farm_fields для FK, якщо є */
  farmFieldId?: string | null;
  /** Геометрія для аналізу трека при закритті наряду */
  fieldGeometry?: FieldGeometry | null;
  fieldColor?: string | null;
  mapSource?: MapFieldSource;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** sheet — класичний оверлей; panel — вбудована права glass-панель */
  variant?: "sheet" | "panel";
  /** Мобільна шторка vaul — без SwipeableSheet, свайп вниз ззовні */
  embeddedInMobileDrawer?: boolean;
  /** «До списку» — горизонтальний перехід назад, не закриття на мапу */
  onBackToList?: () => void;
  initialTab?: FieldHubTab;
  /** Відкрити вкладку «Налаштування» з підтвердженням видалення (Delete на карті) */
  initialConfirmDelete?: boolean;
  /** Техніка з Wialon для вибору в плані робіт */
  units?: WialonUnit[];
  onPlanWork?: (op?: FieldOperation) => void;
  weather?: WeatherSnapshot | null;
  hourly?: HourlyForecastHour[] | null;
  weatherLoading?: boolean;
  weatherError?: string | null;
  passportMode?: "create" | "edit";
  passportBusy?: boolean;
  passportSavedFlash?: boolean;
  passportSaveHint?: string | null;
  passportName?: string;
  passportCrop?: string;
  passportAreaHa?: number;
  passportColor?: string;
  onPassportNameChange?: (value: string) => void;
  onPassportCropChange?: (value: string) => void;
  onPassportAreaHaChange?: (value: number) => void;
  onPassportColorChange?: (value: string) => void;
  onPassportSave?: () => void;
  onPassportDelete?: () => void;
  onEditGeometry?: () => void;
  /** Показати «Видалити» (збережений паспорт або чернетка контуру) */
  canDeleteField?: boolean;
  /** Інкремент при Realtime-оновленні з Supabase */
  realtimeVersion?: number;
  wialonZoneId?: string | null;
  wialonGeofences?: FeatureCollection<Polygon, WialonGeofenceProperties>;
  wialonLoading?: boolean;
  occupiedWialonZones?: Record<string, string>;
  onIntegrationsFieldUpdated?: (field: FarmField) => void;
};

type HistoryPeriod =
  | "Сьогодні"
  | "Вчора"
  | "Тиждень"
  | "Місяць"
  | "Сезон"
  | "custom";

const SEASON_OPTIONS = [2026, 2025, 2024] as const;
const PERIOD_OPTIONS: Exclude<HistoryPeriod, "custom" | "Сезон">[] = [
  "Сьогодні",
  "Вчора",
  "Тиждень",
  "Місяць",
];

const TAB_ITEMS = [
  {
    value: "overview",
    label: "Огляд",
    shortLabel: "Огляд",
    icon: ChartPie,
  },
  {
    value: "history",
    label: "Історія & Економіка",
    shortLabel: "Історія",
    icon: History,
  },
  {
    value: "tech",
    label: "Техніка",
    shortLabel: "Техніка",
    icon: Tractor,
  },
  {
    value: "settings",
    label: "Налаштування",
    shortLabel: "Налашт.",
    icon: Settings2,
  },
] as const satisfies ReadonlyArray<{
  value: FieldHubTab;
  label: string;
  shortLabel: string;
  icon: typeof ChartPie;
}>;

function HubTabPanel({
  tab,
  activeTab,
  children,
  className,
}: {
  tab: FieldHubTab;
  activeTab: FieldHubTab;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      {activeTab === tab ? (
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          className={className}
        >
          {children}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

/** Агросезон: 1 березня → кінець лютого наступного року (повний діапазон для історії). */
function getSeasonRange(seasonYear: number): {
  start: Date;
  end: Date;
} {
  return {
    start: startOfDay(new Date(seasonYear, 2, 1)),
    end: endOfDay(new Date(seasonYear + 1, 2, 0)),
  };
}

function getPeriodRange(
  period: HistoryPeriod,
  seasonYear: number,
  customRange?: DateRange
): { start: Date; end: Date } {
  const now = new Date();
  if (period === "Сезон") {
    return getSeasonRange(seasonYear);
  }
  if (period === "custom" && customRange?.from) {
    return {
      start: startOfDay(customRange.from),
      end: endOfDay(customRange.to ?? customRange.from),
    };
  }
  if (period === "Вчора") {
    const day = subDays(now, 1);
    return { start: startOfDay(day), end: endOfDay(day) };
  }
  if (period === "Тиждень") {
    return { start: startOfDay(subDays(now, 6)), end: endOfDay(now) };
  }
  if (period === "Місяць") {
    return { start: startOfDay(subDays(now, 29)), end: endOfDay(now) };
  }
  return { start: startOfDay(now), end: endOfDay(now) };
}

function formatOpDateLabel(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return format(d, "d MMMM", { locale: uk });
}

function formatUah(value: number) {
  return formatUahCurrency(value);
}

function statusMeta(status: FieldOperation["status"]) {
  if (status === "completed") {
    return { label: "Виконано", className: "bg-zinc-100 text-zinc-600" };
  }
  if (status === "planned") {
    return {
      label: "Заплановано",
      className: "bg-sky-50 text-sky-700 ring-1 ring-sky-100",
    };
  }
  return { label: "В роботі", className: "bg-amber-50 text-amber-700" };
}

type OperationCardProps = {
  op: FieldOperation;
  onStart: (op: FieldOperation) => void;
  onEdit: (op: FieldOperation) => void;
  onDelete: (op: FieldOperation) => void;
  onComplete: (op: FieldOperation) => void;
  onCorrect?: (op: FieldOperation) => void;
};

function OperationCard({
  op,
  onStart,
  onEdit,
  onDelete,
  onComplete,
  onCorrect,
}: OperationCardProps) {
  const pct =
    op.areaTotal > 0 ? Math.round((op.areaDone / op.areaTotal) * 100) : 0;
  const fuelPerHa =
    op.areaDone > 0 ? (op.fuelUsed / op.areaDone).toFixed(1) : "—";
  const status = statusMeta(op.status);
  const isPlanned = op.status === "planned";
  const isInProgress = op.status === "in_progress";
  const isCompleted = op.status === "completed";

  return (
    <article
      className={cn(
        "mb-3 overflow-hidden rounded-2xl border bg-white shadow-sm transition-shadow hover:shadow-md",
        isPlanned
          ? "border-sky-200/80 ring-1 ring-sky-50"
          : isInProgress
            ? "border-amber-200/70 ring-1 ring-amber-50"
            : "border-zinc-200/90"
      )}
    >
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div
              className={cn(
                "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
                isPlanned
                  ? "bg-sky-50 text-sky-600"
                  : isInProgress
                    ? "bg-amber-50 text-amber-600"
                    : "bg-emerald-50 text-emerald-600"
              )}
            >
              <Tractor className="h-5 w-5" strokeWidth={1.8} />
            </div>
            <div className="min-w-0">
              <h4 className="truncate text-[15px] font-bold tracking-tight text-zinc-900">
                {op.type}
                <span className="font-semibold text-zinc-400"> · </span>
                <span className="font-semibold text-zinc-700">{op.crop}</span>
              </h4>
              <p className="mt-0.5 text-xs text-zinc-500">
                {op.date}
                <span className="mx-1.5 text-zinc-300">·</span>
                {op.time}
              </p>
            </div>
          </div>

          <span
            className={cn(
              "shrink-0 rounded-lg px-2 py-1 text-[11px] font-semibold",
              status.className
            )}
          >
            {status.label}
          </span>
        </div>

        <div className="mt-3 flex items-center gap-2 rounded-xl bg-zinc-50 px-3 py-2.5">
          <p className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-800">
            {op.machinery}
          </p>
          <span className="shrink-0 text-zinc-300" aria-hidden>
            ·
          </span>
          <p className="min-w-0 flex-1 truncate text-sm text-zinc-500">
            {op.implement}
          </p>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2">
          <div className="rounded-xl border border-zinc-100 bg-zinc-50/80 px-2.5 py-2.5 text-center">
            <p className="text-[10px] font-semibold tracking-wider text-zinc-400 uppercase">
              Площа
            </p>
            <p className="mt-1 text-sm font-bold tabular-nums text-zinc-900">
              {op.areaDone}
              <span className="text-[11px] font-semibold text-zinc-400">
                {" "}
                га
              </span>
            </p>
            <div className="mx-auto mt-1.5 h-1 w-full max-w-[72px] overflow-hidden rounded-full bg-zinc-200">
              <div
                className={cn(
                  "h-full rounded-full",
                  isPlanned ? "bg-sky-400" : "bg-emerald-500"
                )}
                style={{ width: `${Math.min(100, isPlanned ? 0 : pct)}%` }}
              />
            </div>
            <p
              className={cn(
                "mt-1 text-[11px] font-medium",
                isPlanned ? "text-sky-600" : "text-emerald-600"
              )}
            >
              {isPlanned ? "план" : `${pct}%`}
            </p>
          </div>

          <div className="rounded-xl border border-zinc-100 bg-zinc-50/80 px-2.5 py-2.5 text-center">
            <p className="inline-flex items-center justify-center gap-1 text-[10px] font-semibold tracking-wider text-zinc-400 uppercase">
              <Fuel className="h-3 w-3" />
              Паливо
            </p>
            <p className="mt-1 text-sm font-bold tabular-nums text-zinc-900">
              {fuelPerHa}
              <span className="text-[11px] font-semibold text-zinc-400">
                {" "}
                л/га
              </span>
            </p>
            <p className="mt-1.5 text-[11px] tabular-nums text-zinc-500">
              {op.fuelUsed.toLocaleString("uk-UA")} л{" "}
              {isPlanned ? "план" : "факт"}
            </p>
          </div>

          <div className="rounded-xl border border-zinc-100 bg-zinc-50/80 px-2.5 py-2.5 text-center">
            <p className="inline-flex items-center justify-center gap-1 text-[10px] font-semibold tracking-wider text-zinc-400 uppercase">
              <Wallet className="h-3 w-3" />
              Оплата
            </p>
            <p className="mt-1 text-sm font-bold tabular-nums text-zinc-900">
              {formatUah(op.wage)}
            </p>
            <p className="mt-1.5 text-[11px] text-zinc-500">механізатор</p>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 border-t border-zinc-100/90 bg-gradient-to-b from-[#FAFAF8] to-white px-3 py-2.5">
        {isPlanned ? (
          <button
            type="button"
            onClick={() => onStart(op)}
            className={cn(
              "inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl px-3 text-sm font-bold text-white",
              "bg-gradient-to-r from-[#1f5239] via-[#276749] to-[#2f7a52]",
              "shadow-[0_8px_20px_-8px_rgba(39,103,73,0.55)]",
              "transition-all hover:-translate-y-px hover:brightness-105 active:translate-y-0"
            )}
          >
            <Play className="h-4 w-4 fill-current" />
            Почати роботу
          </button>
        ) : null}

        {isInProgress ? (
          <button
            type="button"
            onClick={() => onComplete(op)}
            className={cn(
              "inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl px-3 text-sm font-bold text-white",
              "bg-gradient-to-r from-[#1f5239] via-[#276749] to-[#2f7a52]",
              "shadow-[0_8px_20px_-8px_rgba(39,103,73,0.55)]",
              "transition-all hover:-translate-y-px hover:brightness-105 active:translate-y-0"
            )}
          >
            <CheckCircle2 className="h-4 w-4" />
            Завершити
          </button>
        ) : null}

        {isCompleted && onCorrect ? (
          <button
            type="button"
            onClick={() => onCorrect(op)}
            className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-[#C9D4CA] bg-white px-3 text-sm font-semibold text-zinc-800 shadow-sm transition-colors hover:bg-zinc-50"
          >
            <Edit3 className="h-4 w-4 text-zinc-500" />
            Коригувати
          </button>
        ) : null}

        {!isCompleted ? (
          <button
            type="button"
            onClick={() => onEdit(op)}
            className="inline-flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-3.5 text-sm font-semibold text-zinc-700 shadow-sm transition-colors hover:bg-zinc-50"
            aria-label="Редагувати"
          >
            <Pencil className="h-4 w-4 text-zinc-500" />
            <span className="hidden sm:inline">Редагувати</span>
          </button>
        ) : null}

        <button
          type="button"
          onClick={() => onDelete(op)}
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-transparent text-zinc-400 transition-colors hover:border-red-100 hover:bg-red-50 hover:text-red-600"
          aria-label="Видалити"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </article>
  );
}

type PlanWorkPrefill = {
  occurredAt: string;
  machinery?: string;
  equipmentId?: string | null;
  wialonUnitId?: number | null;
  fuelUsed?: number | null;
  areaDone?: number | null;
  /** Пробіг у полі з GPS (км) — для оцінки га після вибору ширини захвату */
  trackerDistanceKm?: number | null;
  /** Точний час візиту з GPS-треку HH:mm */
  timeFrom?: string | null;
  timeTo?: string | null;
};

type PlanWorkPanelProps = {
  field: Field;
  farmFieldId: string | null;
  seasonYear: number;
  units: WialonUnit[];
  fieldGeometry?: FieldGeometry | null;
  initial?: FieldOperation | null;
  /** Новий наряд з попередньо заповненими датою / технікою (не edit) */
  prefill?: PlanWorkPrefill | null;
  submitAsCompleted?: boolean;
  onPassportPatched?: (patch: { crop: string; areaHa: number }) => void;
  onBack: () => void;
  onSubmit: (op: FieldOperation) => void;
};

function PlanWorkPanel({
  field,
  farmFieldId,
  seasonYear,
  units,
  fieldGeometry = null,
  initial = null,
  prefill = null,
  submitAsCompleted = false,
  onPassportPatched,
  onBack,
  onSubmit,
}: PlanWorkPanelProps) {
  const areaDefault = Number(field.areaHa) || 0;
  const isEdit = Boolean(initial);
  const [passportCrop, setPassportCrop] = useState(field.crop);
  const [passportAreaHa, setPassportAreaHa] = useState(field.areaHa);

  useEffect(() => {
    setPassportCrop(field.crop);
    setPassportAreaHa(field.areaHa);
  }, [field.crop, field.areaHa, field.id]);

  const fieldPassportOk = isFieldPassportComplete({
    areaHa: passportAreaHa,
    crop: passportCrop,
  });
  const fieldPassportBlocked = !fieldPassportOk;

  const [catalogEquipment, setCatalogEquipment] = useState<
    EquipmentForOpsRow[]
  >([]);
  const [equipmentLoading, setEquipmentLoading] = useState(true);

  const unitOptions = useMemo(() => {
    const merged = mergeEquipmentOpsOptions(catalogEquipment, units);
    const injectEq = initial?.equipmentId ?? prefill?.equipmentId ?? null;
    const injectW = initial?.wialonUnitId ?? prefill?.wialonUnitId ?? null;
    const injectName =
      initial?.machinery?.trim() ||
      prefill?.machinery?.trim() ||
      (injectW != null ? `Техніка ${injectW}` : "Техніка");
    if (
      findEquipmentOpsOption(merged, {
        equipmentId: injectEq,
        wialonUnitId: injectW,
      })
    ) {
      return merged;
    }
    if (injectEq || injectW != null) {
      const hasTracker = injectW != null;
      const inject: EquipmentOpsOption = {
        key: injectEq
          ? `eq:${injectEq}`
          : `w:${injectW}`,
        label: injectName,
        equipmentId: injectEq,
        wialonUnitId: injectW,
        hasTracker,
        group: hasTracker ? "tracked" : "non_tracked",
      };
      return [inject, ...merged];
    }
    return merged;
  }, [
    catalogEquipment,
    units,
    initial?.equipmentId,
    initial?.wialonUnitId,
    initial?.machinery,
    prefill?.equipmentId,
    prefill?.wialonUnitId,
    prefill?.machinery,
  ]);

  const unitSelectItems = useMemo(
    () =>
      unitOptions.map((unit) => ({
        value: unit.key,
        label: unit.hasTracker
          ? unit.label
          : `${unit.label} · без трекера`,
      })),
    [unitOptions]
  );

  const trackedUnitOptions = useMemo(
    () => unitOptions.filter((u) => u.group === "tracked"),
    [unitOptions]
  );
  const nonTrackedUnitOptions = useMemo(
    () => unitOptions.filter((u) => u.group === "non_tracked"),
    [unitOptions]
  );

  const typeSelectItems = useMemo(
    () => OPERATION_TYPES.map((item) => ({ value: item, label: item })),
    []
  );

  const [type, setType] = useState<string>(OPERATION_TYPES[0]);
  const [crop, setCrop] = useState(field.crop || "");
  const [date, setDate] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [timeFrom, setTimeFrom] = useState("08:00");
  const [timeTo, setTimeTo] = useState("18:00");
  const [unitId, setUnitId] = useState<string | null>(null);
  const [implement, setImplement] = useState(IMPLEMENT_PRESETS.Посів);
  const [implementId, setImplementId] = useState<string | null>(null);
  const [implementWidth, setImplementWidth] = useState(
    String(IMPLEMENT_WIDTH_DEFAULTS.Посів)
  );
  const [implementOptions, setImplementOptions] = useState<ImplementOption[]>(
    []
  );

  const implementSelectItems = useMemo(
    () =>
      implementOptions.map((item) => ({
        value: item.id,
        label: `${item.name}${
          item.workingWidthM > 0 ? ` · ${item.workingWidthM} м` : " · 0 м"
        }`,
      })),
    [implementOptions]
  );

  const [areaDone, setAreaDone] = useState(String(areaDefault));
  const [fuelUsed, setFuelUsed] = useState(() =>
    String(estimatePlanFuelLiters(OPERATION_TYPES[0], areaDefault))
  );
  const [wage, setWage] = useState(() => String(estimatePlanWageUah(areaDefault)));
  const [error, setError] = useState<string | null>(null);
  const [dieselPriceUah, setDieselPriceUah] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getDieselPriceUah().then((res) => {
      if (cancelled || !res.ok) return;
      setDieselPriceUah(res.data.priceUah);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const fuelLitersNum = Number(String(fuelUsed).replace(",", "."));
  const fuelCostEstimate =
    dieselPriceUah != null &&
    Number.isFinite(fuelLitersNum) &&
    fuelLitersNum > 0
      ? Math.round(fuelLitersNum * dieselPriceUah)
      : null;

  useEffect(() => {
    let cancelled = false;
    void listImplementsForOps().then((res) => {
      if (cancelled || !res.ok) return;
      setImplementOptions(res.data);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setEquipmentLoading(true);
    void listEquipmentForOps().then((res) => {
      if (cancelled) return;
      if (res.ok) setCatalogEquipment(res.data);
      setEquipmentLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setError(null);
    if (initial) {
      const [from = "08:00", to = "18:00"] = initial.time
        .split("–")
        .map((s) => s.trim());
      setType(initial.type);
      setCrop(initial.crop);
      setDate(initial.occurredAt);
      setTimeFrom(from);
      setTimeTo(to);
      setImplement(initial.implement);
      setImplementId(null);
      setImplementWidth(
        String(
          initial.implementWidthM ??
            IMPLEMENT_WIDTH_DEFAULTS[initial.type] ??
            6
        )
      );
      setAreaDone(String(initial.areaDone));
      setFuelUsed(String(initial.fuelUsed));
      setWage(String(initial.wage));
      return;
    }
    const area = Number(field.areaHa) || 0;
    const workType = OPERATION_TYPES[0];
    setType(workType);
    setCrop(field.crop || "");
    const defaultWidth = IMPLEMENT_WIDTH_DEFAULTS[workType] ?? 6;
    const fromTrack =
      prefill?.trackerDistanceKm != null &&
      Number.isFinite(prefill.trackerDistanceKm) &&
      prefill.trackerDistanceKm > 0
        ? estimateAreaHaFromTrack(
            prefill.trackerDistanceKm,
            defaultWidth,
            area > 0 ? area : null
          )
        : 0;
    const prefillArea =
      prefill?.areaDone != null &&
      Number.isFinite(prefill.areaDone) &&
      prefill.areaDone > 0
        ? prefill.areaDone
        : fromTrack > 0
          ? fromTrack
          : area;
    setAreaDone(prefillArea > 0 ? String(prefillArea) : "");
    setDate(
      prefill?.occurredAt && /^\d{4}-\d{2}-\d{2}$/.test(prefill.occurredAt)
        ? prefill.occurredAt
        : format(new Date(), "yyyy-MM-dd")
    );
    setTimeFrom(
      prefill?.timeFrom && /^\d{2}:\d{2}$/.test(prefill.timeFrom)
        ? prefill.timeFrom
        : "08:00"
    );
    setTimeTo(
      prefill?.timeTo && /^\d{2}:\d{2}$/.test(prefill.timeTo)
        ? prefill.timeTo
        : "18:00"
    );
    setImplement(IMPLEMENT_PRESETS[workType] ?? "");
    setImplementId(null);
    setImplementWidth(String(defaultWidth));
    const fuelFromGps =
      prefill?.fuelUsed != null &&
      Number.isFinite(prefill.fuelUsed) &&
      prefill.fuelUsed >= 0
        ? Math.round(prefill.fuelUsed)
        : estimatePlanFuelLiters(workType, prefillArea);
    setFuelUsed(String(fuelFromGps));
    setWage(String(estimatePlanWageUah(prefillArea)));
  }, [initial, prefill, field.id, field.crop, field.areaHa]);

  /** Резолв ключа техніки після завантаження довідника / Wialon. */
  useEffect(() => {
    if (unitOptions.length === 0) return;
    if (initial) {
      const match = findEquipmentOpsOption(unitOptions, {
        equipmentId: initial.equipmentId,
        wialonUnitId: initial.wialonUnitId,
      });
      if (match) setUnitId(match.key);
      return;
    }
    if (prefill?.equipmentId || prefill?.wialonUnitId != null) {
      const match = findEquipmentOpsOption(unitOptions, {
        equipmentId: prefill.equipmentId,
        wialonUnitId: prefill.wialonUnitId,
      });
      if (match) setUnitId(match.key);
      return;
    }
    setUnitId((prev) => {
      if (prev && unitOptions.some((o) => o.key === prev)) return prev;
      return unitOptions[0]?.key ?? null;
    });
  }, [
    unitOptions,
    initial,
    prefill?.equipmentId,
    prefill?.wialonUnitId,
  ]);

  /** Підтягнути id зі довідника для вже обраної назви (edit / після завантаження). */
  useEffect(() => {
    if (implementOptions.length === 0 || !implement.trim()) return;
    const matched = implementOptions.find(
      (item) =>
        item.name.trim().toLowerCase() === implement.trim().toLowerCase()
    );
    if (matched) setImplementId(matched.id);
  }, [implementOptions]); // eslint-disable-line react-hooks/exhaustive-deps

  function applyAreaFromTrack(widthM: number) {
    const dist = prefill?.trackerDistanceKm;
    if (dist == null || !Number.isFinite(dist) || dist <= 0) return;
    if (!Number.isFinite(widthM) || widthM <= 0) return;
    const area = estimateAreaHaFromTrack(
      dist,
      widthM,
      Number(field.areaHa) > 0 ? Number(field.areaHa) : null
    );
    if (area <= 0) return;
    setAreaDone(String(area));
    if (!isEdit) {
      setFuelUsed(String(estimatePlanFuelLiters(type, area)));
      setWage(String(estimatePlanWageUah(area)));
    }
  }

  function handleTypeChange(next: string | null) {
    if (!next) return;
    setType(next);
    if (!isEdit) {
      setImplement(IMPLEMENT_PRESETS[next] ?? "");
      setImplementId(null);
      const width = IMPLEMENT_WIDTH_DEFAULTS[next] ?? 6;
      setImplementWidth(String(width));
      if (prefill?.trackerDistanceKm) {
        applyAreaFromTrack(width);
      } else {
        const area = Number(areaDone.replace(",", ".")) || areaDefault;
        setFuelUsed(String(estimatePlanFuelLiters(next, area)));
      }
    }
  }

  function handleImplementSelect(id: string | null) {
    if (!id) return;
    const item = implementOptions.find((row) => row.id === id);
    if (!item) return;
    setImplementId(item.id);
    setImplement(item.name);
    const width = item.workingWidthM || 0;
    setImplementWidth(String(width));
    applyAreaFromTrack(width);
  }

  function handleImplementWidthChange(value: string) {
    setImplementWidth(value);
    const width = Number(value.replace(",", "."));
    if (Number.isFinite(width) && width > 0) {
      applyAreaFromTrack(width);
    }
  }

  function handleAreaChange(value: string) {
    setAreaDone(value);
    if (isEdit) return;
    const area = Number(value.replace(",", "."));
    if (!Number.isFinite(area) || area <= 0) return;
    setFuelUsed(String(estimatePlanFuelLiters(type, area)));
    setWage(String(estimatePlanWageUah(area)));
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (fieldPassportBlocked) {
      setError(
        "У цього поля не заповнений паспорт (площа або культура)."
      );
      return;
    }
    const area = Number(areaDone.replace(",", "."));
    const fuel = Number(fuelUsed.replace(",", "."));
    const pay = Number(wage.replace(",", "."));
    const width = Number(implementWidth.replace(",", "."));
    const selectedUnit = unitOptions.find((u) => u.key === unitId);

    if (!type.trim() || !selectedUnit) {
      setError(
        unitOptions.length === 0
          ? equipmentLoading
            ? "Завантаження техніки…"
            : "Немає техніки в довіднику — синхронізуйте з BAS AGRO або підключіть Wialon"
          : "Оберіть тип робіт і техніку"
      );
      return;
    }
    if (!implement.trim()) {
      setError("Вкажіть знаряддя");
      return;
    }
    if (!Number.isFinite(width) || width <= 0) {
      setError("Вкажіть ширину знаряддя (м)");
      return;
    }
    if (!Number.isFinite(area) || area <= 0) {
      setError("Вкажіть коректну площу");
      return;
    }
    if (!Number.isFinite(fuel) || fuel < 0 || !Number.isFinite(pay) || pay < 0) {
      setError("Перевірте паливо та оплату");
      return;
    }

    const occurred = new Date(`${date}T12:00:00`);
    const opSeason = Number.isNaN(occurred.getTime())
      ? seasonYear
      : occurred.getMonth() >= 2
        ? occurred.getFullYear()
        : occurred.getFullYear() - 1;

    const op: FieldOperation = {
      id: initial?.id ?? crypto.randomUUID(),
      seasonYear: opSeason,
      occurredAt: date,
      type: type.trim(),
      crop: crop.trim() || passportCrop || field.crop || "—",
      date: formatOpDateLabel(date),
      time: `${timeFrom} – ${timeTo}`,
      machinery: selectedUnit.label,
      implement: implement.trim(),
      areaDone: Math.round(area * 100) / 100,
      areaTotal: Number(passportAreaHa) || Number(field.areaHa) || area,
      fuelUsed: Math.round(fuel),
      wage: Math.round(pay),
      status: submitAsCompleted
        ? "completed"
        : (initial?.status ?? "planned"),
      equipmentId: selectedUnit.equipmentId,
      wialonUnitId: selectedUnit.wialonUnitId,
      implementWidthM: Math.round(width * 100) / 100,
      trackerDistanceKm:
        prefill?.trackerDistanceKm != null &&
        Number.isFinite(prefill.trackerDistanceKm) &&
        prefill.trackerDistanceKm > 0
          ? Math.round(prefill.trackerDistanceKm * 10) / 10
          : initial?.trackerDistanceKm ?? null,
      exportStatus: initial?.exportStatus ?? "none",
    };

    onSubmit(op);
  }

  const fieldControlClass = cn(
    "box-border h-11 w-full max-w-full min-w-0 rounded-xl border border-[#E5DFD3] bg-white px-3",
    "text-base text-zinc-900 shadow-[0_1px_0_rgba(255,255,255,0.8)_inset] md:text-sm",
    "transition-colors outline-none",
    "focus-visible:border-[#276749]/45 focus-visible:ring-2 focus-visible:ring-[#276749]/15"
  );

  const selectTriggerClass = cn(
    fieldControlClass,
    "!flex !h-11 !w-full max-w-full justify-between font-normal",
    "data-[size=default]:!h-11 data-placeholder:text-zinc-400"
  );

  const labelClass =
    "text-[11px] font-semibold tracking-[0.08em] text-zinc-500 uppercase";

  const cellClass = "flex min-w-0 flex-col space-y-1.5";
  const row2Class =
    "grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 sm:[grid-template-columns:minmax(0,1fr)_minmax(0,1fr)]";
  const row3Class =
    "grid grid-cols-1 gap-3 p-4 sm:grid-cols-3 sm:[grid-template-columns:minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]";

  return (
    <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="relative overflow-hidden border-b border-[#E5DFD3]/80 bg-gradient-to-br from-[#E8F0EA] via-[#F4F1EA] to-[#EDE8DF] px-4 py-4 md:px-6 md:py-5">
          <div
            className="pointer-events-none absolute -top-12 -right-10 h-36 w-36 rounded-full bg-[#276749]/10 blur-3xl"
            aria-hidden
          />
          <button
            type="button"
            onClick={onBack}
            className="relative mb-3 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-zinc-600 transition-colors hover:bg-white/70 hover:text-zinc-900"
          >
            <ChevronLeft className="h-4 w-4" />
            Назад до поля
          </button>
          <div className="relative">
            <p className="mb-1.5 inline-flex items-center gap-1.5 rounded-full border border-[#276749]/15 bg-white/80 px-2.5 py-1 text-[10px] font-semibold tracking-wider text-[#276749] uppercase">
              <CalendarPlus className="h-3 w-3" />
              {isEdit
                ? "Редагування"
                : submitAsCompleted
                  ? "Минула операція"
                  : "Нова операція"}
            </p>
            <h2 className="text-xl font-extrabold tracking-tight text-zinc-900">
              {isEdit
                ? "Редагувати операцію"
                : submitAsCompleted
                  ? "Внести виконану роботу"
                  : "Запланувати роботи"}
            </h2>
            <p className="mt-1 text-sm text-zinc-600">
              {field.name}
              {field.crop ? ` · ${field.crop}` : ""}
              {" · "}
              {field.areaHa} га
            </p>
          </div>
        </div>

        <div className="space-y-4 px-4 py-5 pb-6 md:px-6">
          {/* Операція */}
          <section className="overflow-hidden rounded-2xl border border-[#E5DFD3] bg-white shadow-sm">
            <div className="border-b border-[#E5DFD3]/80 bg-[#FAFAF8] px-4 py-2.5">
              <p className="text-[11px] font-semibold tracking-[0.1em] text-zinc-500 uppercase">
                Операція
              </p>
            </div>
            <div className={row2Class}>
              <div className={cellClass}>
                <Label className={labelClass}>Тип робіт</Label>
                <Select
                  items={typeSelectItems}
                  value={type}
                  onValueChange={handleTypeChange}
                >
                  <SelectTrigger className={selectTriggerClass}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="border-[#E5DFD3] bg-white">
                    {OPERATION_TYPES.map((item) => (
                      <SelectItem key={item} value={item}>
                        {item}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className={cellClass}>
                <Label className={labelClass}>Культура</Label>
                <Input
                  value={crop}
                  onChange={(e) => setCrop(e.target.value)}
                  className={fieldControlClass}
                  placeholder="З паспорта поля"
                />
              </div>
            </div>
          </section>

          {/* Розклад */}
          <section className="overflow-hidden rounded-2xl border border-[#E5DFD3] bg-white shadow-sm">
            <div className="border-b border-[#E5DFD3]/80 bg-[#FAFAF8] px-4 py-2.5">
              <p className="text-[11px] font-semibold tracking-[0.1em] text-zinc-500 uppercase">
                Розклад
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 p-4 md:grid-cols-3">
              <div className={cn(cellClass, "col-span-2 md:col-span-1")}>
                <Label className={labelClass}>Дата</Label>
                <DatePicker
                  date={
                    date
                      ? new Date(
                          `${date}T12:00:00`
                        )
                      : undefined
                  }
                  onChange={(next) => {
                    if (!next) return;
                    setDate(format(next, "yyyy-MM-dd"));
                  }}
                  placeholder="Оберіть дату"
                />
              </div>
              <div className={cellClass}>
                <Label className={labelClass}>З</Label>
                <TimePicker value={timeFrom} onChange={setTimeFrom} />
              </div>
              <div className={cellClass}>
                <Label className={labelClass}>До</Label>
                <TimePicker value={timeTo} onChange={setTimeTo} />
              </div>
            </div>
            <SmartWeatherAlert
              workType={type}
              date={date}
              timeFrom={timeFrom}
              fieldGeometry={fieldGeometry}
              className="mx-4 mb-4"
            />
          </section>

          {/* Ресурси */}
          <section className="overflow-hidden rounded-2xl border border-[#E5DFD3] bg-white shadow-sm">
            <div className="border-b border-[#E5DFD3]/80 bg-[#FAFAF8] px-4 py-2.5">
              <p className="text-[11px] font-semibold tracking-[0.1em] text-zinc-500 uppercase">
                Техніка та знаряддя
              </p>
            </div>
            <div className={row2Class}>
              <div className={cellClass}>
                <Label className={labelClass}>Техніка</Label>
                {unitOptions.length > 0 ? (
                  <Select
                    items={unitSelectItems}
                    value={unitId}
                    onValueChange={(v) => {
                      if (typeof v === "string" && v) setUnitId(v);
                    }}
                  >
                    <SelectTrigger className={selectTriggerClass}>
                      <SelectValue placeholder="Оберіть техніку" />
                    </SelectTrigger>
                    <SelectContent className="max-h-64 border-[#E5DFD3] bg-white">
                      {trackedUnitOptions.length > 0 ? (
                        <SelectGroup>
                          <SelectLabel>З GPS</SelectLabel>
                          {trackedUnitOptions.map((item) => (
                            <SelectItem key={item.key} value={item.key}>
                              {item.label}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      ) : null}
                      {nonTrackedUnitOptions.length > 0 ? (
                        <SelectGroup>
                          <SelectLabel>Без трекера</SelectLabel>
                          {nonTrackedUnitOptions.map((item) => (
                            <SelectItem key={item.key} value={item.key}>
                              {item.label}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      ) : null}
                    </SelectContent>
                  </Select>
                ) : (
                  <div
                    className={cn(
                      fieldControlClass,
                      "flex items-center text-sm text-amber-800"
                    )}
                  >
                    {equipmentLoading
                      ? "Завантаження техніки…"
                      : "Немає техніки в довіднику"}
                  </div>
                )}
              </div>
              <div className={cellClass}>
                <Label className={labelClass}>Знаряддя</Label>
                {implementOptions.length > 0 ? (
                  <Select
                    items={implementSelectItems}
                    value={implementId}
                    onValueChange={(v) => {
                      if (typeof v === "string" && v) handleImplementSelect(v);
                    }}
                  >
                    <SelectTrigger className={selectTriggerClass}>
                      <SelectValue placeholder="Оберіть знаряддя" />
                    </SelectTrigger>
                    <SelectContent className="max-h-64 border-[#E5DFD3] bg-white">
                      {implementOptions.map((item) => (
                        <SelectItem key={item.id} value={item.id}>
                          {item.name}
                          {item.workingWidthM > 0
                            ? ` · ${item.workingWidthM} м`
                            : " · 0 м"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    value={implement}
                    onChange={(e) => setImplement(e.target.value)}
                    className={fieldControlClass}
                    placeholder="Сівалка, культиватор…"
                  />
                )}
              </div>
            </div>
            <div className="border-t border-[#E5DFD3]/80 px-4 pb-4">
              <div className={cellClass}>
                <Label className={labelClass}>Ширина знаряддя, м</Label>
                <Input
                  value={implementWidth}
                  onChange={(e) => handleImplementWidthChange(e.target.value)}
                  inputMode="decimal"
                  className={cn(fieldControlClass, "tabular-nums font-semibold")}
                  placeholder="6"
                />
                <p className="text-[10px] text-zinc-400">
                  {prefill?.trackerDistanceKm
                    ? `GPS ${prefill.trackerDistanceKm} км × ширина / 10 = га`
                    : "з довідника обладнання · можна змінити · км × ширина / 10 = га"}
                </p>
              </div>
            </div>
          </section>

          {/* План */}
          <section className="overflow-hidden rounded-2xl border border-[#E5DFD3] bg-white shadow-sm">
            <div className="border-b border-[#E5DFD3]/80 bg-[#FAFAF8] px-4 py-2.5">
              <p className="text-[11px] font-semibold tracking-[0.1em] text-zinc-500 uppercase">
                План показників
              </p>
            </div>
            <div className={row3Class}>
              <div className={cellClass}>
                <Label className={labelClass}>Площа, га</Label>
                <Input
                  value={areaDone}
                  onChange={(e) => handleAreaChange(e.target.value)}
                  inputMode="decimal"
                  className={cn(fieldControlClass, "tabular-nums font-semibold")}
                />
                <p className="h-4 text-[10px] text-zinc-400">з паспорта поля</p>
              </div>
              <div className={cellClass}>
                <Label className={labelClass}>Паливо, л</Label>
                <Input
                  value={fuelUsed}
                  onChange={(e) => setFuelUsed(e.target.value)}
                  inputMode="decimal"
                  className={cn(fieldControlClass, "tabular-nums font-semibold")}
                />
                <p className="h-4 text-[10px] text-zinc-400">
                  ≈ {fuelLitersPerHa(type)} л/га
                  {fuelCostEstimate != null
                    ? ` · ${formatUahCurrency(fuelCostEstimate)}`
                    : dieselPriceUah != null
                      ? ` · ${formatUahCurrency(dieselPriceUah, { precise: true })}/л`
                      : ""}
                </p>
              </div>
              <div className={cellClass}>
                <Label className={labelClass}>Оплата, ₴</Label>
                <Input
                  value={wage}
                  onChange={(e) => setWage(e.target.value)}
                  inputMode="numeric"
                  className={cn(fieldControlClass, "tabular-nums font-semibold")}
                />
                <p className="h-4 text-[10px] text-zinc-400">
                  ≈ {formatUahCurrency(estimatePlanWageUah(Number(areaDone.replace(",", ".")) || areaDefault))}
                </p>
              </div>
            </div>
          </section>

          {fieldPassportBlocked ? null : error ? (
            <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
              {error}
            </p>
          ) : (
            <p className="text-xs leading-relaxed text-zinc-500">
              {submitAsCompleted
                ? "Операція одразу потрапить у «Історію» як виконана — для розрахунку собівартості сезону."
                : "Операція зʼявиться в «Історії» зі статусом «Заплановано». Паливо й оплату можна скоригувати — зараз це розрахунок від площі поля."}
            </p>
          )}
        </div>
      </div>

      <div className="shrink-0 space-y-3 border-t border-[#E5DFD3] bg-gradient-to-t from-[#EDE8DF] to-[#F4F1EA] px-4 py-4 md:px-6">
        {fieldPassportBlocked && farmFieldId ? (
          <FieldPassportQuickFix
            fieldId={farmFieldId}
            fieldName={field.name}
            crop={passportCrop}
            areaHa={passportAreaHa}
            onSaved={(patch) => {
              setPassportCrop(patch.crop);
              setPassportAreaHa(patch.areaHa);
              onPassportPatched?.(patch);
            }}
          />
        ) : null}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onBack}
            className="h-12 flex-1 rounded-2xl border border-zinc-200 bg-white text-sm font-semibold text-zinc-700 transition-colors hover:bg-zinc-50"
          >
            Скасувати
          </button>
          <button
            type="submit"
            disabled={fieldPassportBlocked}
            className={cn(
              "inline-flex h-12 flex-[1.4] items-center justify-center gap-2 rounded-2xl",
              "bg-gradient-to-r from-[#1f5239] via-[#276749] to-[#2f7a52]",
              "text-sm font-bold text-white shadow-[0_10px_28px_-8px_rgba(39,103,73,0.45)]",
              "transition hover:brightness-105 disabled:pointer-events-none disabled:opacity-50"
            )}
          >
            <CalendarPlus className="h-4 w-4" />
            {isEdit
              ? "Зберегти"
              : submitAsCompleted
                ? "Зберегти виконану роботу"
                : "Додати в історію"}
          </button>
        </div>
      </div>
    </form>
  );
}

function toCloseableOperation(op: FieldOperation): CloseableOperation {
  return {
    id: op.id,
    type: op.type,
    crop: op.crop,
    machinery: op.machinery,
    implement: op.implement,
    date: op.date,
    time: op.time,
    occurredAt: op.occurredAt,
    seasonYear: op.seasonYear,
    areaDone: op.areaDone,
    areaTotal: op.areaTotal,
    areaPlan: op.areaPlan,
    fuelPlan: op.fuelPlan,
    wagePlan: op.wagePlan,
    fuelUsed: op.fuelUsed,
    wage: op.wage,
    status: op.status,
    agronomistComment: op.agronomistComment,
    equipmentId: op.equipmentId,
    wialonUnitId: op.wialonUnitId,
    implementWidthM: op.implementWidthM,
    trackerDistanceKm: op.trackerDistanceKm,
    trackerWorkHours: op.trackerWorkHours,
    trackerFuelL: op.trackerFuelL,
  };
}

/** Широка панель глибокої аналітики поля */
export function FieldDetailSheet({
  field,
  fieldKey = null,
  legacyFieldKeys = [],
  farmFieldId = null,
  fieldGeometry = null,
  fieldColor = null,
  mapSource = "wialon",
  open,
  onOpenChange,
  variant = "sheet",
  embeddedInMobileDrawer = false,
  onBackToList,
  initialTab = "overview",
  initialConfirmDelete = false,
  units = [],
  onPlanWork,
  weather = null,
  hourly = null,
  weatherLoading = false,
  weatherError = null,
  passportMode = "edit",
  passportBusy = false,
  passportSavedFlash = false,
  passportSaveHint = null,
  passportName = "",
  passportCrop = "",
  passportAreaHa = 0,
  passportColor = "#276749",
  onPassportNameChange,
  onPassportCropChange,
  onPassportAreaHaChange,
  onPassportColorChange,
  onPassportSave,
  onPassportDelete,
  onEditGeometry,
  canDeleteField = false,
  realtimeVersion = 0,
  wialonZoneId = null,
  wialonGeofences,
  wialonLoading = false,
  occupiedWialonZones = {},
  onIntegrationsFieldUpdated,
}: FieldDetailSheetProps) {
  const isMobile = useIsMobile();
  const activeSeason = useSeasonStore((s) => s.activeSeason);
  const operationSeasonYear = Number(activeSeason) || Number(currentAgroSeason()) || 2026;
  const [historySeasonYear, setHistorySeasonYear] = useState(operationSeasonYear);
  const historySeason = String(historySeasonYear);

  const [period, setPeriod] = useState<HistoryPeriod>("Сезон");
  const [customRange, setCustomRange] = useState<DateRange | undefined>();
  const [rangeOpen, setRangeOpen] = useState(false);
  const [seasonOpen, setSeasonOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<FieldHubTab>("overview");
  /** Після першого заходу на «Техніка» тримаємо панель змонтованою (кеш GPS без рефетчу) */
  const [techPanelMounted, setTechPanelMounted] = useState(
    () => initialTab === "tech"
  );
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [planPastWork, setPlanPastWork] = useState(false);
  const [planPrefill, setPlanPrefill] = useState<PlanWorkPrefill | null>(null);
  const [quickIssueOpen, setQuickIssueOpen] = useState(false);
  const [editingOp, setEditingOp] = useState<FieldOperation | null>(null);
  const [completeOp, setCompleteOp] = useState<FieldOperation | null>(null);
  const [correctOp, setCorrectOp] = useState<FieldOperation | null>(null);
  const [operations, setOperations] = useState<FieldOperation[]>([]);
  const [opsLoading, setOpsLoading] = useState(false);
  const [fieldEvents, setFieldEvents] = useState<FieldEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const fieldEventsRequestRef = useRef(0);

  function applyHistoryPeriod(next: HistoryPeriod) {
    setPeriod(next);
    if (next === "Сезон") return;
    // Сьогодні / вчора / тиждень / місяць — дані з поточного агросезону
    const year = Number(currentAgroSeason());
    if (Number.isFinite(year)) setHistorySeasonYear(year);
  }

  // При відкритті хаба — підтягнути актуальний сезон з store
  useEffect(() => {
    if (!open) return;
    setHistorySeasonYear(operationSeasonYear);
    setPeriod("Сезон");
  }, [open, fieldKey, farmFieldId]); // eslint-disable-line react-hooks/exhaustive-deps -- лише при відкритті поля

  const resolvedFieldKey =
    fieldKey?.trim() || (field ? `map:${field.id}` : null);
  const legacyKeysJoined = legacyFieldKeys.join("\0");
  const legacyKey = useMemo(
    () =>
      legacyKeysJoined
        .split("\0")
        .filter((key) => key && key !== resolvedFieldKey),
    [legacyKeysJoined, resolvedFieldKey]
  );

  useEffect(() => {
    if (open) {
      setHistorySeasonYear(operationSeasonYear);
    }
  }, [open, field?.id, operationSeasonYear]);

  useEffect(() => {
    if (open) {
      setActiveTab(initialTab);
      setConfirmDelete(initialConfirmDelete);
      // Не тримаємо GPS-панель з попереднього поля — вона валила відкриття деталей
      setTechPanelMounted(initialTab === "tech");
    }
  }, [open, initialTab, initialConfirmDelete, field?.id]);

  useEffect(() => {
    if (activeTab === "tech") setTechPanelMounted(true);
  }, [activeTab]);

  const liveEconomics = useLiveFieldEconomics(
    farmFieldId,
    open && !!field,
    realtimeVersion,
    historySeason
  );

  const historyWindow = useMemo(
    () => getPeriodRange(period, historySeasonYear, customRange),
    [period, historySeasonYear, customRange]
  );

  /** Sticky footer — overview та історія (не settings/tech) */
  const showStickyActionFooter =
    activeTab !== "settings" && activeTab !== "tech";

  async function reloadFieldEvents() {
    if (!farmFieldId) {
      setFieldEvents([]);
      setEventsError(null);
      setEventsLoading(false);
      return;
    }
    const requestId = ++fieldEventsRequestRef.current;
    setEventsLoading(true);
    setEventsError(null);
    const res = await getFieldEvents(farmFieldId, historySeason);
    if (requestId !== fieldEventsRequestRef.current) return;
    setEventsLoading(false);
    if (!res.ok) {
      setEventsError(res.error);
      return;
    }
    setFieldEvents(res.data);
  }

  function prependQuickIssueEvent(payload: {
    moveId: string;
    fieldId: string;
    itemTitle: string;
    category: "zzr" | "fertilizer" | "seed" | "parts" | "harvest";
    qty: number;
    unit: string;
  }) {
    if (!farmFieldId) return;
    if (!payload.fieldId) return;
    if (payload.fieldId.toLowerCase() !== farmFieldId.toLowerCase()) return;

    const categoryLabels: Record<string, string> = {
      zzr: "ЗЗР",
      fertilizer: "Добрива",
      seed: "Насіння",
      parts: "Запчастини",
      harvest: "Врожай",
    };
    const materialCategory =
      payload.category === "zzr" ||
      payload.category === "fertilizer" ||
      payload.category === "seed"
        ? payload.category
        : ("other" as const);
    const eventId = `material:${payload.moveId}`;
    const today = new Date().toISOString().slice(0, 10);

    setFieldEvents((prev) => {
      if (prev.some((event) => event.id === eventId)) return prev;
      const next: FieldEvent = {
        id: eventId,
        type: "material",
        date: today,
        title: payload.itemTitle,
        category: materialCategory,
        categoryLabel:
          categoryLabels[payload.category] ?? categoryLabels.other ?? "ТМЦ",
        qty: payload.qty,
        unit: payload.unit,
        costUah: 0,
        status: "draft",
        actorName: null,
      };
      return [next, ...prev];
    });
  }

  useEffect(() => {
    if (!open || !resolvedFieldKey) {
      setOperations([]);
      return;
    }

    let cancelled = false;
    setOpsLoading(true);

    async function load() {
      const ops = await listFieldOperations(resolvedFieldKey!, legacyKey);
      if (cancelled) return;
      setOperations(ops);
      setOpsLoading(false);
    }

    void load();
    const timer = window.setInterval(() => {
      void listFieldOperations(resolvedFieldKey!, legacyKey).then((ops) => {
        if (!cancelled) setOperations(ops);
      });
    }, 60_000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [open, resolvedFieldKey, legacyKey, realtimeVersion]);

  useEffect(() => {
    if (!open || !farmFieldId) {
      setFieldEvents([]);
      setEventsError(null);
      setEventsLoading(false);
      return;
    }

    let cancelled = false;
    const requestId = ++fieldEventsRequestRef.current;
    setEventsLoading(true);
    setEventsError(null);

    void getFieldEvents(farmFieldId, historySeason).then((res) => {
      if (cancelled || requestId !== fieldEventsRequestRef.current) return;
      setEventsLoading(false);
      if (!res.ok) {
        setEventsError(res.error);
        return;
      }
      setFieldEvents(res.data);
    });

    return () => {
      cancelled = true;
    };
  }, [open, farmFieldId, historySeason, realtimeVersion]);

  const activeOperations = useMemo(() => {
    if (!resolvedFieldKey) return [];
    const { start, end } = getPeriodRange(period, historySeasonYear, customRange);
    return operations
      .filter((op) => op.status === "planned" || op.status === "in_progress")
      .filter((op) => {
        if (period === "Сезон") {
          return op.seasonYear === historySeasonYear;
        }
        if (op.status === "in_progress") return true;
        const day = startOfDay(new Date(`${op.occurredAt}T12:00:00`));
        return day >= start && day <= end;
      })
      .sort((a, b) => {
        if (a.status === "in_progress" && b.status !== "in_progress") return -1;
        if (b.status === "in_progress" && a.status !== "in_progress") return 1;
        return b.occurredAt.localeCompare(a.occurredAt);
      });
  }, [operations, historySeasonYear, period, customRange, resolvedFieldKey]);

  const daysSinceSowing = useMemo(() => {
    const sowingOps = operations.filter(
      (op) =>
        op.status === "completed" && isSowingOperationType(op.type)
    );
    if (sowingOps.length === 0) return null;

    const latest = sowingOps.reduce((best, op) =>
      op.occurredAt.localeCompare(best.occurredAt) > 0 ? op : best
    );

    const sowDate = new Date(`${latest.occurredAt}T12:00:00`);
    if (Number.isNaN(sowDate.getTime())) return null;

    const today = startOfDay(new Date());
    const sowDay = startOfDay(sowDate);
    const diffMs = today.getTime() - sowDay.getTime();
    return Math.max(0, Math.round(diffMs / (1000 * 60 * 60 * 24)));
  }, [operations]);

  const timelineEvents = useMemo(() => {
    // Сезон уже відфільтровано на API (колонка season) — не обрізати
    // календарним вікном бер–лют, інакше події з «пізнішою» датою зникають.
    if (period === "Сезон") return fieldEvents;
    const { start, end } = getPeriodRange(period, historySeasonYear, customRange);
    return fieldEvents.filter((event) => {
      const raw = String(event.date).slice(0, 10);
      const day = startOfDay(new Date(`${raw}T12:00:00`));
      if (Number.isNaN(day.getTime())) return false;
      return day >= start && day <= end;
    });
  }, [fieldEvents, period, historySeasonYear, customRange]);

  async function persistOperation(op: FieldOperation) {
    if (!resolvedFieldKey) {
      throw new Error("Немає ключа поля для збереження");
    }
    const saved = await upsertFieldOperation({
      ...op,
      fieldKey: resolvedFieldKey,
      fieldId: farmFieldId,
      areaPlan: op.areaPlan,
      fuelPlan: op.fuelPlan,
      wagePlan: op.wagePlan,
    });
    const ops = await listFieldOperations(resolvedFieldKey, legacyKey);
    setOperations(ops);
    if (saved.status === "completed") {
      await reloadFieldEvents();
      void liveEconomics.reload();
    }
    return saved;
  }

  /** Після /api/field-operations/close — без другого upsert, лише refresh UI */
  async function refreshAfterCloseWrite() {
    if (resolvedFieldKey) {
      setOperations(await listFieldOperations(resolvedFieldKey, legacyKey));
    }
    await reloadFieldEvents();
    void liveEconomics.reload();
  }

  function openCorrection(op: FieldOperation) {
    setCorrectOp(op);
    setCompleteOp(null);
    setPlanOpen(false);
    setEditingOp(null);
  }

  function resolveOperationById(operationId: string): FieldOperation | null {
    const key = operationId.startsWith("operation:")
      ? operationId.slice("operation:".length)
      : operationId;
    return operations.find((row) => row.id === key) ?? null;
  }

  function resetHubOverlays() {
    setPlanOpen(false);
    setPlanPastWork(false);
    setPlanPrefill(null);
    setQuickIssueOpen(false);
    setEditingOp(null);
    setCompleteOp(null);
    setCorrectOp(null);
  }

  function closeHub() {
    resetHubOverlays();
    onOpenChange(false);
  }

  function backToList() {
    resetHubOverlays();
    if (onBackToList) {
      onBackToList();
      return;
    }
    onOpenChange(false);
  }

  function handlePanelSwipeDown() {
    if (correctOp) {
      setCorrectOp(null);
      return;
    }
    if (completeOp) {
      setCompleteOp(null);
      return;
    }
    if (planOpen) {
      setPlanOpen(false);
      setPlanPastWork(false);
      setPlanPrefill(null);
      setEditingOp(null);
      return;
    }
    if (quickIssueOpen) {
      setQuickIssueOpen(false);
      return;
    }
    closeHub();
  }

  const hubInner = (
      <>
        {field ? (
          <>
            {correctOp ? (
              <OperationClosePanel
                mode="correct"
                op={toCloseableOperation(correctOp)}
                fieldId={farmFieldId ?? field.id}
                fieldKey={resolvedFieldKey}
                fieldName={field.name}
                fieldGeometry={fieldGeometry}
                onBack={() => setCorrectOp(null)}
                onConfirm={() => {
                  void refreshAfterCloseWrite().finally(() => {
                    setCorrectOp(null);
                    setActiveTab("history");
                  });
                }}
              />
            ) : completeOp ? (
              <OperationClosePanel
                op={toCloseableOperation(completeOp)}
                fieldId={farmFieldId ?? field.id}
                fieldKey={resolvedFieldKey}
                fieldName={field.name}
                fieldGeometry={fieldGeometry}
                onBack={() => setCompleteOp(null)}
                onConfirm={() => {
                  void refreshAfterCloseWrite().finally(() => {
                    setCompleteOp(null);
                    setActiveTab("history");
                  });
                }}
              />
            ) : planOpen ? (
              <PlanWorkPanel
                field={{
                  ...field,
                  crop: passportCrop || field.crop,
                  areaHa: passportAreaHa > 0 ? passportAreaHa : field.areaHa,
                }}
                farmFieldId={farmFieldId}
                seasonYear={operationSeasonYear}
                units={units}
                fieldGeometry={fieldGeometry}
                initial={editingOp}
                prefill={editingOp ? null : planPrefill}
                submitAsCompleted={planPastWork && !editingOp}
                onPassportPatched={(patch) => {
                  onPassportCropChange?.(patch.crop);
                  onPassportAreaHaChange?.(patch.areaHa);
                }}
                onBack={() => {
                  setPlanOpen(false);
                  setPlanPastWork(false);
                  setPlanPrefill(null);
                  setEditingOp(null);
                }}
                onSubmit={(op) => {
                  void persistOperation(op)
                    .then((saved) => {
                      if (!editingOp) onPlanWork?.(op);
                      setEditingOp(null);
                      setPlanOpen(false);
                      setPlanPastWork(false);
                      setPlanPrefill(null);
                      setActiveTab("history");
                      setHistorySeasonYear(saved.seasonYear);
                      setPeriod("Сезон");
                      toast.success(
                        planPastWork && !editingOp
                          ? `Виконану роботу збережено · сезон ${saved.seasonYear}`
                          : editingOp
                            ? "Наряд оновлено"
                            : "Наряд додано в історію"
                      );
                    })
                    .catch((err) => {
                      toast.error(
                        err instanceof Error
                          ? err.message
                          : "Не вдалося зберегти наряд"
                      );
                    });
                }}
              />
            ) : quickIssueOpen ? (
              <QuickIssueSheet
                variant="panel"
                open
                lockField={Boolean(farmFieldId)}
                presetFieldId={farmFieldId}
                onOpenChange={(next) => {
                  if (!next) setQuickIssueOpen(false);
                }}
                onBack={() => setQuickIssueOpen(false)}
                onSuccess={(payload) => {
                  setPeriod("Сезон");
                  prependQuickIssueEvent(payload);
                  void liveEconomics.reload();
                  void reloadFieldEvents();
                  setQuickIssueOpen(false);
                  setActiveTab("history");
                }}
              />
            ) : (
              <>
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div
              className={cn(
                "relative shrink-0 overflow-hidden border-b px-4 py-3 md:px-6 md:py-5",
                embeddedInMobileDrawer && "pr-4",
                variant === "panel"
                  ? "border-white/35 bg-gradient-to-br from-white/55 via-[#F4F1EA]/40 to-emerald-50/30"
                  : "border-[#E5DFD3] bg-gradient-to-br from-[#E8F0EA] via-[#F4F1EA] to-[#EDE8DF]"
              )}
            >
                <div
                  className="pointer-events-none absolute -top-14 -right-8 h-32 w-32 rounded-full bg-[#276749]/10 blur-3xl"
                  aria-hidden
                />
                <div
                  className={cn(
                    "relative flex gap-3",
                    embeddedInMobileDrawer
                      ? "flex-col items-stretch pr-1"
                      : "flex-wrap items-start justify-between",
                    variant === "sheet" && "pr-8"
                  )}
                >
                  <div className="min-w-0 flex-1">
                    {variant === "panel" ? (
                      <button
                        type="button"
                        onClick={backToList}
                        className="mb-2 inline-flex min-h-11 items-center gap-1 rounded-lg px-1 text-sm font-semibold text-zinc-500 transition-colors hover:text-zinc-900 md:mb-3 md:min-h-0 md:text-xs"
                      >
                        <ChevronLeft className="h-3.5 w-3.5" />
                        До списку
                      </button>
                    ) : null}
                    <div className="flex items-center gap-3">
                      {fieldColor ? (
                        <span
                          className="mt-0.5 h-10 w-1.5 shrink-0 rounded-full shadow-sm ring-2 ring-white/80"
                          style={{ backgroundColor: fieldColor }}
                          aria-hidden
                        />
                      ) : (
                        <span className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[#276749]/12 text-[#276749] ring-1 ring-[#276749]/15">
                          <Sprout className="h-5 w-5" />
                        </span>
                      )}
                      <div className="min-w-0">
                        <h2 className="truncate text-xl leading-tight font-extrabold tracking-tight text-zinc-900 md:text-[1.65rem]">
                          {field.name}
                        </h2>
                        <div className="mt-2 flex flex-wrap items-center gap-2 md:mt-3">
                          <span className="inline-flex items-center gap-1.5 rounded-full border border-[#276749]/15 bg-white/80 px-3 py-1 text-xs font-semibold text-[#276749] shadow-sm">
                            <Leaf className="h-3.5 w-3.5" />
                            {field.crop || "Без культури"}
                          </span>
                          <span className="inline-flex items-center gap-1 rounded-full border border-zinc-200/80 bg-white/75 px-3 py-1 text-xs font-bold tabular-nums text-zinc-800 shadow-sm">
                            {field.areaHa}
                            <span className="font-semibold text-zinc-400">
                              га
                            </span>
                          </span>
                          {embeddedInMobileDrawer ? (
                            activeOperations.length > 0 ? (
                              <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800">
                                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
                                {activeOperations.length} у роботі
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 rounded-full border border-[#276749]/20 bg-white/70 px-2.5 py-1 text-xs font-semibold text-[#276749]">
                                Готово до планування
                              </span>
                            )
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </div>
                  {!embeddedInMobileDrawer ? (
                    activeOperations.length > 0 ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800">
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
                        {activeOperations.length} у роботі
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-[#276749]/20 bg-white/70 px-2.5 py-1 text-xs font-semibold text-[#276749]">
                        Готово до планування
                      </span>
                    )
                  ) : null}
                </div>
              </div>

              <Tabs
                value={activeTab}
                onValueChange={(value) => setActiveTab(value as FieldHubTab)}
                className="flex min-h-0 flex-1 flex-col gap-0"
              >
                <div className="shrink-0 space-y-0 border-b border-[#E5DFD3] bg-[#F7F4EE]">
                  <div className="px-3 pt-2 pb-2 sm:px-6 sm:pt-3">
                    <TabsList
                      variant="default"
                      className={cn(
                        "mb-0 grid h-12 w-full grid-cols-4 gap-1 rounded-2xl p-1",
                        "border border-[#E0DBD0] bg-[#EDE8DF] shadow-[inset_0_1px_2px_rgba(39,33,24,0.06)]",
                        "group-data-horizontal/tabs:h-12"
                      )}
                    >
                      {TAB_ITEMS.map((tab) => {
                        const Icon = tab.icon;
                        return (
                          <TabsTrigger
                            key={tab.value}
                            value={tab.value}
                            className={cn(
                              "group/hubtab h-10 min-w-0 gap-1 rounded-[14px] border-0 bg-transparent px-1.5 text-[11px] font-semibold tracking-tight shadow-none sm:gap-1.5 sm:px-2 sm:text-[12px]",
                              "text-zinc-500 transition-all duration-200",
                              "hover:bg-white/55 hover:text-zinc-800",
                              "focus-visible:ring-2 focus-visible:ring-[#276749]/25",
                              "after:hidden",
                              "data-active:bg-white data-active:text-[#1f5239]",
                              "data-active:shadow-[0_1px_2px_rgba(39,33,24,0.06),0_4px_12px_-4px_rgba(39,103,73,0.28)]",
                              "data-active:hover:bg-white data-active:hover:text-[#1f5239]",
                              "dark:data-active:bg-white dark:data-active:text-[#1f5239]"
                            )}
                          >
                            <Icon className="h-3.5 w-3.5 shrink-0 opacity-65 transition-opacity group-data-active/hubtab:opacity-100 sm:h-4 sm:w-4" />
                            <span className="max-w-full truncate">
                              {tab.shortLabel}
                            </span>
                          </TabsTrigger>
                        );
                      })}
                    </TabsList>
                  </div>
                </div>

                <div
                  className="min-h-0 flex-1 overflow-y-auto overscroll-contain touch-pan-y"
                  data-vaul-no-drag=""
                  data-allow-pan="true"
                >
                  {(activeTab === "history" || activeTab === "tech") ? (
                    <div className="border-b border-[#E5DFD3]/70 px-3 py-2.5 sm:px-6">
                      <div className="flex flex-wrap items-center gap-2">
                        <Popover
                          open={seasonOpen}
                          onOpenChange={(next) => {
                            setSeasonOpen(next);
                            if (next) setPeriod("Сезон");
                          }}
                        >
                          <PopoverTrigger
                            className={cn(
                              "inline-flex h-11 shrink-0 items-center gap-2 rounded-xl border px-2.5 text-left text-sm font-semibold transition-all md:h-9 md:text-xs",
                              period === "Сезон"
                                ? "border-[#276749] bg-[#276749] text-white shadow-[0_6px_16px_-6px_rgba(39,103,73,0.55)]"
                                : "border-[#E0DBD0] bg-white text-zinc-700 hover:border-[#276749]/35"
                            )}
                            aria-label="Обрати агросезон"
                          >
                            <span
                              className={cn(
                                "inline-flex h-6 w-6 items-center justify-center rounded-lg",
                                period === "Сезон"
                                  ? "bg-white/15 text-white"
                                  : "bg-[#276749]/12 text-[#276749]"
                              )}
                            >
                              <Sprout className="h-3.5 w-3.5" />
                            </span>
                            <span className="tabular-nums">
                              Сезон {historySeasonYear}
                            </span>
                            <ChevronDown
                              className={cn(
                                "h-3.5 w-3.5",
                                period === "Сезон"
                                  ? "text-white/80"
                                  : "text-zinc-400"
                              )}
                            />
                          </PopoverTrigger>
                          <PopoverContent
                            align="start"
                            sideOffset={6}
                            sheetOnMobile={!embeddedInMobileDrawer}
                            className="w-[min(100vw-3rem,20rem)] rounded-2xl border border-zinc-200 bg-white p-2 shadow-xl"
                          >
                            <p className="px-2.5 pt-1.5 pb-2 text-[11px] leading-snug text-zinc-500">
                              Фільтр витрат, ТМЦ і нарядів за агросезоном
                              (березень–лютий).
                            </p>
                            <div className="space-y-1">
                              {SEASON_OPTIONS.map((year) => (
                                <button
                                  key={year}
                                  type="button"
                                  onClick={() => {
                                    setHistorySeasonYear(year);
                                    setPeriod("Сезон");
                                    setSeasonOpen(false);
                                  }}
                                  className={cn(
                                    "flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left transition-colors",
                                    historySeasonYear === year
                                      ? "bg-[#276749] text-white"
                                      : "text-zinc-800 hover:bg-zinc-50"
                                  )}
                                >
                                  <span className="text-sm font-semibold">
                                    Сезон {year}
                                  </span>
                                  <span
                                    className={cn(
                                      "text-[11px] font-medium",
                                      historySeasonYear === year
                                        ? "text-white/75"
                                        : "text-zinc-400"
                                    )}
                                  >
                                    бер {year} – лют {year + 1}
                                  </span>
                                </button>
                              ))}
                            </div>
                          </PopoverContent>
                        </Popover>

                        <div className="inline-flex w-fit max-w-full flex-wrap items-center gap-0.5 rounded-xl bg-[#EDE8DF] p-0.5">
                          {PERIOD_OPTIONS.map((option) => (
                            <button
                              key={option}
                              type="button"
                              onClick={() => applyHistoryPeriod(option)}
                              className={cn(
                                "h-11 rounded-[10px] px-2.5 text-xs font-semibold transition-all sm:px-3 md:h-8",
                                period === option
                                  ? "bg-[#276749] text-white shadow-[0_4px_12px_-4px_rgba(39,103,73,0.55)]"
                                  : "text-zinc-500 hover:bg-white/70 hover:text-zinc-800"
                              )}
                            >
                              {option}
                            </button>
                          ))}
                        </div>

                        <Popover
                          open={rangeOpen}
                          onOpenChange={(next) => {
                            setRangeOpen(next);
                            if (next) applyHistoryPeriod("custom");
                          }}
                        >
                          <PopoverTrigger
                            className={cn(
                              "inline-flex h-11 shrink-0 items-center gap-1.5 rounded-xl border px-2.5 text-sm font-semibold transition-all md:h-9 md:text-xs",
                              period === "custom"
                                ? "border-[#276749] bg-[#276749] text-white shadow-[0_6px_16px_-6px_rgba(39,103,73,0.55)]"
                                : "border-[#E0DBD0] bg-white text-zinc-700 hover:border-[#276749]/35"
                            )}
                          >
                            <CalendarIcon
                              className={cn(
                                "h-3.5 w-3.5 shrink-0",
                                period === "custom"
                                  ? "text-white/90"
                                  : "opacity-70"
                              )}
                            />
                            {period === "custom" && customRange?.from
                              ? `${format(customRange.from, "d MMM", { locale: uk })}${
                                  customRange.to
                                    ? ` – ${format(customRange.to, "d MMM", { locale: uk })}`
                                    : " → …"
                                }`
                              : "Діапазон"}
                          </PopoverTrigger>
                          <PopoverContent
                            align="end"
                            sideOffset={6}
                            sheetOnMobile={!embeddedInMobileDrawer}
                            className="w-auto rounded-2xl border border-zinc-200 bg-white p-3 shadow-xl"
                          >
                            <p className="mb-2 px-1 text-[11px] text-zinc-500">
                              {customRange?.from && customRange?.to
                                ? "Натисніть дату, щоб обрати новий початок"
                                : customRange?.from
                                  ? "Тепер оберіть кінець періоду"
                                  : "Оберіть початок, потім кінець періоду"}
                            </p>
                            <Calendar
                              mode="range"
                              numberOfMonths={1}
                              selected={customRange}
                              defaultMonth={customRange?.from ?? new Date()}
                              onSelect={(range, triggerDate) => {
                                applyHistoryPeriod("custom");
                                // Повний діапазон уже був — новий клік починає вибір заново
                                if (
                                  customRange?.from &&
                                  customRange?.to &&
                                  triggerDate
                                ) {
                                  setCustomRange({
                                    from: triggerDate,
                                    to: undefined,
                                  });
                                  return;
                                }
                                setCustomRange(range);
                              }}
                              locale={uk}
                              className="rounded-xl"
                            />
                            <div className="mt-3 flex items-center gap-2 border-t border-zinc-100 pt-3">
                              <button
                                type="button"
                                onClick={() => {
                                  setCustomRange(undefined);
                                  setPeriod("Сезон");
                                  setRangeOpen(false);
                                }}
                                className="h-11 flex-1 rounded-xl border border-zinc-200 bg-white text-sm font-semibold text-zinc-600 hover:bg-zinc-50"
                              >
                                Скинути
                              </button>
                              <button
                                type="button"
                                disabled={!customRange?.from}
                                onClick={() => {
                                  if (!customRange?.from) return;
                                  if (!customRange.to) {
                                    setCustomRange({
                                      from: customRange.from,
                                      to: customRange.from,
                                    });
                                  }
                                  setPeriod("custom");
                                  setRangeOpen(false);
                                }}
                                className="h-11 flex-[1.4] rounded-xl bg-[#276749] text-sm font-bold text-white hover:bg-[#22543d] disabled:opacity-50"
                              >
                                Застосувати
                              </button>
                            </div>
                          </PopoverContent>
                        </Popover>
                      </div>
                    </div>
                  ) : null}

                  <HubTabPanel
                    tab="overview"
                    activeTab={activeTab}
                    className="px-4 py-4 outline-none md:px-6 md:py-5"
                  >
                    <FieldMicroclimate
                      weather={weather}
                      hourly={hourly}
                      loading={weatherLoading}
                      error={weatherError}
                      daysSinceSowing={daysSinceSowing}
                      crop={passportCrop || field.crop}
                    />

                    {opsLoading && activeOperations.length === 0 ? (
                      <div className="mt-5 space-y-2">
                        <Skeleton className="h-3 w-28" />
                        <Skeleton className="h-20 w-full rounded-2xl" />
                      </div>
                    ) : activeOperations.length > 0 ? (
                      <div className="mt-5">
                        <p className="mb-2.5 text-[11px] font-semibold tracking-[0.12em] text-zinc-500 uppercase">
                          Статус робіт
                        </p>
                        {activeOperations.map((op) => (
                          <OperationCard
                            key={op.id}
                            op={op}
                            onStart={(item) => {
                              void persistOperation({
                                ...item,
                                status: "in_progress",
                              });
                            }}
                            onEdit={(item) => {
                              setPlanPastWork(false);
                              setPlanPrefill(null);
                              setEditingOp(item);
                              setPlanOpen(true);
                            }}
                            onDelete={(item) => {
                              if (!resolvedFieldKey) return;
                              setOperations((prev) =>
                                prev.filter((p) => p.id !== item.id)
                              );
                              void deleteFieldOperation(
                                resolvedFieldKey,
                                item.id,
                                legacyKey
                              );
                            }}
                            onComplete={(item) => setCompleteOp(item)}
                            onCorrect={openCorrection}
                          />
                        ))}
                      </div>
                    ) : (
                      <p className="mt-5 rounded-2xl border border-dashed border-zinc-200 bg-white/70 px-4 py-4 text-center text-sm text-zinc-500">
                        Немає активних нарядів — заплануйте роботу на сезон.
                      </p>
                    )}

                  </HubTabPanel>

                  <HubTabPanel
                    tab="history"
                    activeTab={activeTab}
                    className="space-y-6 px-4 py-4 outline-none md:px-6 md:py-5"
                  >
                    {!farmFieldId ? (
                      <div className="rounded-2xl border border-dashed border-zinc-200 bg-white/70 px-4 py-4 text-center">
                        <p className="text-sm font-semibold text-zinc-800">
                          Немає паспорта поля
                        </p>
                        <p className="mt-1 text-xs text-zinc-500">
                          Збережіть паспорт у вкладці «Налаштування», щоб бачити
                          ТМЦ і наряди.
                        </p>
                        <button
                          type="button"
                          onClick={() => setActiveTab("settings")}
                          className="mt-3 text-xs font-semibold text-[#276749] underline-offset-2 hover:underline"
                        >
                          Перейти до налаштувань
                        </button>
                      </div>
                    ) : null}

                    <div>
                      <p className="mb-3 text-[11px] font-semibold tracking-[0.12em] text-zinc-500 uppercase">
                        Економіка поля
                      </p>
                      <LiveFieldEconomicsPanel
                        farmFieldId={farmFieldId}
                        areaHa={field.areaHa}
                        loading={liveEconomics.loading}
                        error={liveEconomics.error}
                        data={liveEconomics.data}
                        onRetry={() => void liveEconomics.reload()}
                        onDataChange={liveEconomics.setData}
                        onQuickIssue={() => setQuickIssueOpen(true)}
                        onAddPastOperation={() => {
                          setEditingOp(null);
                          setPlanPrefill(null);
                          setPlanPastWork(true);
                          setPlanOpen(true);
                        }}
                      />
                    </div>

                    {activeOperations.length > 0 ? (
                      <div>
                        <p className="mb-3 text-[11px] font-semibold tracking-[0.12em] text-zinc-500 uppercase">
                          У роботі зараз
                        </p>
                        <div className="space-y-2">
                          {activeOperations.map((op) => (
                            <OperationCard
                              key={op.id}
                              op={op}
                              onStart={(item) => {
                                void persistOperation({
                                  ...item,
                                  status: "in_progress",
                                });
                              }}
                              onEdit={(item) => {
                                setPlanPastWork(false);
                                setPlanPrefill(null);
                                setEditingOp(item);
                                setPlanOpen(true);
                              }}
                              onDelete={(item) => {
                                if (!resolvedFieldKey) return;
                                setOperations((prev) =>
                                  prev.filter((p) => p.id !== item.id)
                                );
                                void deleteFieldOperation(
                                  resolvedFieldKey,
                                  item.id,
                                  legacyKey
                                );
                              }}
                              onComplete={(item) => setCompleteOp(item)}
                              onCorrect={openCorrection}
                            />
                          ))}
                        </div>
                      </div>
                    ) : null}

                    <div>
                      <p className="mb-3 text-[11px] font-semibold tracking-[0.12em] text-zinc-500 uppercase">
                        Хронологія
                      </p>
                      <FieldHistoryTimeline
                        events={timelineEvents}
                        loading={eventsLoading}
                        error={eventsError}
                        onRetry={() => void reloadFieldEvents()}
                        onCorrectOperation={(operationId) => {
                          const op = resolveOperationById(operationId);
                          if (op) openCorrection(op);
                        }}
                        emptyHint={
                          farmFieldId
                            ? `За обраний період у сезоні ${historySeasonYear} подій не зафіксовано.`
                            : "Після створення паспорта тут зʼявиться єдина історія поля."
                        }
                      />
                    </div>
                  </HubTabPanel>

                  <div
                    className={cn(
                      "px-4 py-4 outline-none md:px-6 md:py-5",
                      activeTab !== "tech" && "hidden"
                    )}
                    hidden={activeTab !== "tech"}
                    aria-hidden={activeTab !== "tech"}
                  >
                    {techPanelMounted ? (
                      <FieldTechHistoryPanel
                        enabled={open && activeTab === "tech"}
                        farmFieldId={farmFieldId}
                        fieldGeometry={fieldGeometry}
                        fieldAreaHa={passportAreaHa || field.areaHa}
                        units={units}
                        realtimeVersion={realtimeVersion}
                        historySeason={historySeason}
                        windowFrom={historyWindow.start}
                        windowTo={historyWindow.end}
                        periodLabel={
                          period === "custom" && customRange?.from
                            ? `${format(customRange.from, "d MMM", { locale: uk })}${
                                customRange.to
                                  ? ` – ${format(customRange.to, "d MMM", { locale: uk })}`
                                  : ""
                              }`
                            : period === "Сезон"
                              ? `Сезон ${historySeasonYear}`
                              : period
                        }
                        onCreateOrderFromGps={(entry) => {
                          setEditingOp(null);
                          setPlanPrefill({
                            occurredAt: entry.date,
                            machinery: entry.equipmentName,
                            wialonUnitId: entry.wialonUnitId,
                            fuelUsed: entry.gpsFuelConsumedL ?? null,
                            areaDone: entry.areaHa ?? null,
                            trackerDistanceKm: entry.trackerDistanceKm ?? null,
                            timeFrom:
                              entry.visitStartUnix != null
                                ? formatVisitClockHm(entry.visitStartUnix)
                                : null,
                            timeTo:
                              entry.visitEndUnix != null
                                ? formatVisitClockHm(entry.visitEndUnix)
                                : null,
                          });
                          setPlanPastWork(true);
                          setPlanOpen(true);
                        }}
                      />
                    ) : null}
                  </div>

                  <HubTabPanel
                    tab="settings"
                    activeTab={activeTab}
                    className="px-4 py-4 outline-none md:px-6 md:py-5"
                  >
                    <FieldPassportForm
                      mode={passportMode}
                      fieldName={passportName || field.name}
                      onFieldNameChange={onPassportNameChange ?? (() => {})}
                      crop={passportCrop || field.crop}
                      onCropChange={
                        onPassportCropChange ??
                        ((v) => normalizeFieldCrop(v))
                      }
                      areaHa={passportAreaHa || field.areaHa}
                      onAreaHaChange={onPassportAreaHaChange ?? (() => {})}
                      color={passportColor || fieldColor || "#276749"}
                      onColorChange={onPassportColorChange ?? (() => {})}
                      busy={passportBusy}
                      savedFlash={passportSavedFlash}
                      saveHint={passportSaveHint}
                      onSave={onPassportSave ?? (() => {})}
                      source={mapSource}
                      canDelete={canDeleteField}
                      confirmDelete={confirmDelete}
                      onConfirmDeleteChange={setConfirmDelete}
                      onDelete={onPassportDelete}
                      onEditGeometry={onEditGeometry}
                      showEditGeometry={Boolean(fieldGeometry && onEditGeometry)}
                    />

                    <FieldIntegrationsPanel
                      className="mt-5"
                      farmFieldId={farmFieldId}
                      wialonZoneId={wialonZoneId}
                      wialonGeofences={
                        wialonGeofences ?? {
                          type: "FeatureCollection",
                          features: [],
                        }
                      }
                      wialonLoading={wialonLoading}
                      occupiedWialonZones={occupiedWialonZones}
                      onFieldUpdated={onIntegrationsFieldUpdated}
                      onPassportAreaChange={onPassportAreaHaChange}
                    />
                  </HubTabPanel>
                </div>
              </Tabs>
            </div>

            {showStickyActionFooter ? (
              <footer className="z-20 shrink-0 border-t border-[#E5DFD3]/80 bg-[#F4F1EA] px-3 py-3 md:px-5 md:py-4">
                <div className="grid w-full grid-cols-2 gap-2 md:gap-3">
                  <button
                    type="button"
                    onClick={() => setQuickIssueOpen(true)}
                    className={cn(
                      "flex min-h-[4.25rem] items-center gap-2.5 rounded-2xl px-3 text-left text-white md:gap-3 md:px-3.5",
                      "bg-gradient-to-br from-[#1a3d2c] via-[#276749] to-[#3a8f5e]",
                      "shadow-[0_16px_36px_-12px_rgba(39,103,73,0.65)]",
                      "transition-transform duration-200 hover:-translate-y-0.5"
                    )}
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/12 ring-1 ring-white/20">
                      <PackageMinus className="h-5 w-5" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-bold tracking-tight">
                        Списати ТМЦ
                      </span>
                      <span className="mt-0.5 block text-[11px] font-medium text-white/70">
                        Насіння · ЗЗР · добрива
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingOp(null);
                      setPlanPrefill(null);
                      setPlanPastWork(false);
                      setPlanOpen(true);
                    }}
                    className="flex min-h-[4.25rem] items-center gap-2.5 rounded-2xl border border-[#D8D2C6] bg-white/85 px-3 text-left shadow-sm transition-colors hover:bg-white md:gap-3 md:px-3.5"
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#276749]/10 text-[#276749]">
                      <Tractor className="h-5 w-5" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-bold tracking-tight text-zinc-900">
                        Додати роботу
                      </span>
                      <span className="mt-0.5 block text-[11px] font-medium text-zinc-500">
                        Наряд або виконану операцію
                      </span>
                    </span>
                  </button>
                </div>
              </footer>
            ) : null}
              </>
            )}
          </>
        ) : null}
        {variant === "sheet" ? (
          <QuickIssueSheet
            open={quickIssueOpen}
            onOpenChange={setQuickIssueOpen}
            presetFieldId={farmFieldId}
            onSuccess={(payload) => {
              setPeriod("Сезон");
              prependQuickIssueEvent(payload);
              void liveEconomics.reload();
              void reloadFieldEvents();
            }}
          />
        ) : null}
      </>
  );

  if (variant === "panel") {
    if (!open || !field) return null;
    if (embeddedInMobileDrawer) {
      return (
        <div className="flex h-full min-h-0 flex-col overflow-hidden bg-transparent">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {hubInner}
          </div>
        </div>
      );
    }
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-transparent">
        <SwipeableSheet
          className="h-full min-h-0"
          disabled={!isMobile}
          showHandle={isMobile}
          onSwipeDown={handlePanelSwipeDown}
        >
          {hubInner}
        </SwipeableSheet>
      </div>
    );
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (next) onOpenChange(true);
        else closeHub();
      }}
    >
      <SheetContent
        side="right"
        className={cn(
          "flex w-full flex-col gap-0 border-l border-[#E5DFD3] bg-[#F4F1EA] p-0 text-zinc-900 shadow-sm",
          "sm:max-w-2xl",
          "[&_[data-slot=sheet-close]]:text-zinc-500 [&_[data-slot=sheet-close]]:hover:bg-[#E5DFD3]/40"
        )}
      >
        {hubInner}
      </SheetContent>
    </Sheet>
  );
}

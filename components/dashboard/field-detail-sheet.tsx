"use client";

import { useEffect, useMemo, useState } from "react";
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
  Fuel,
  History,
  Landmark,
  MoreHorizontal,
  Pencil,
  Play,
  Sprout,
  Tractor,
  Trash2,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { Area, AreaChart, CartesianGrid, XAxis } from "recharts";

import { Calendar } from "@/components/ui/calendar";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  deleteFieldOperation,
  listFieldOperations,
  upsertFieldOperation,
  type FieldOperation,
} from "@/lib/field-operations";
import type { FieldGeometry } from "@/lib/farm-fields";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { OperationClosePanel } from "@/components/dashboard/operation-close-modal";
import {
  FIELD_ANALYTICS,
  type Field,
  type FieldAnalytics,
} from "@/lib/dashboard-data";
import type { WialonUnit } from "@/lib/wialon";
import { cn } from "@/lib/utils";

const OPERATION_TYPES = [
  "Посів",
  "Культивація",
  "Оранка",
  "Внесення ЗЗР",
  "Внесення добрив",
  "Збирання",
] as const;

/** Типові знаряддя (без фейкових брендів) */
const IMPLEMENT_PRESETS: Record<string, string> = {
  Посів: "Сівалка",
  Культивація: "Культиватор",
  Оранка: "Плуг",
  "Внесення ЗЗР": "Обприскувач",
  "Внесення добрив": "Розкидач добрив",
  Збирання: "Жатка",
};

/** Дефолтна ширина знаряддя (м) для оцінки га з трека */
const IMPLEMENT_WIDTH_DEFAULTS: Record<string, number> = {
  Посів: 8,
  Культивація: 6,
  Оранка: 4,
  "Внесення ЗЗР": 24,
  "Внесення добрив": 12,
  Збирання: 9,
};

/** Орієнтовна витрата палива л/га за типом робіт */
const FUEL_L_PER_HA: Record<string, number> = {
  Посів: 4.5,
  Культивація: 7.5,
  Оранка: 18,
  "Внесення ЗЗР": 1.2,
  "Внесення добрив": 3.5,
  Збирання: 12,
};

const WAGE_UAH_PER_HA = 95;

function estimatePlanFuel(type: string, areaHa: number): number {
  const rate = FUEL_L_PER_HA[type] ?? 5;
  return Math.max(1, Math.round(areaHa * rate));
}

function estimatePlanWage(areaHa: number): number {
  return Math.max(100, Math.round(areaHa * WAGE_UAH_PER_HA));
}

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
  analytics?: FieldAnalytics | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Техніка з Wialon для вибору в плані робіт */
  units?: WialonUnit[];
  onPlanWork?: (op?: FieldOperation) => void;
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
  { value: "history", label: "Історія", icon: History },
  { value: "economy", label: "Економіка", icon: Landmark },
  { value: "overview", label: "Огляд", icon: ChartPie },
] as const;

/** Агросезон: 1 березня → кінець лютого наступного року */
function getSeasonRange(seasonYear: number, now = new Date()): {
  start: Date;
  end: Date;
} {
  const start = startOfDay(new Date(seasonYear, 2, 1));
  const endRaw = endOfDay(new Date(seasonYear + 1, 2, 0));
  return {
    start,
    end: endRaw.getTime() > now.getTime() ? endOfDay(now) : endRaw,
  };
}

function getPeriodRange(
  period: HistoryPeriod,
  seasonYear: number,
  customRange?: DateRange
): { start: Date; end: Date } {
  const now = new Date();
  if (period === "Сезон") {
    return getSeasonRange(seasonYear, now);
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

const chartConfig = {
  profit: {
    label: "Рентабельність",
    color: "#276749",
  },
} satisfies ChartConfig;

function formatUsd(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatUah(value: number) {
  return `${value.toLocaleString("uk-UA")} ₴`;
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
};

function OperationCard({
  op,
  onStart,
  onEdit,
  onDelete,
  onComplete,
}: OperationCardProps) {
  const pct =
    op.areaTotal > 0 ? Math.round((op.areaDone / op.areaTotal) * 100) : 0;
  const fuelPerHa =
    op.areaDone > 0 ? (op.fuelUsed / op.areaDone).toFixed(1) : "—";
  const status = statusMeta(op.status);
  const isPlanned = op.status === "planned";
  const isInProgress = op.status === "in_progress";

  return (
    <article
      className={cn(
        "mb-3 rounded-2xl border bg-white p-4 shadow-sm transition-shadow hover:shadow-md",
        isPlanned
          ? "border-sky-200/80 ring-1 ring-sky-50"
          : isInProgress
            ? "border-amber-200/70 ring-1 ring-amber-50"
            : "border-zinc-200/90"
      )}
    >
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

        <div className="flex shrink-0 items-center gap-1.5">
          <span
            className={cn(
              "rounded-lg px-2 py-1 text-[11px] font-semibold",
              status.className
            )}
          >
            {status.label}
          </span>

          <DropdownMenu>
            <DropdownMenuTrigger
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800"
              aria-label="Дії з операцією"
            >
              <MoreHorizontal size={18} />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="z-[100] min-w-48 border-zinc-200 bg-white text-zinc-900"
            >
              {isPlanned ? (
                <>
                  <DropdownMenuItem
                    className="gap-2"
                    onClick={() => onStart(op)}
                  >
                    <Play className="h-4 w-4 text-emerald-600" />
                    Почати роботу
                  </DropdownMenuItem>
                  <DropdownMenuItem className="gap-2" onClick={() => onEdit(op)}>
                    <Pencil className="h-4 w-4 text-zinc-500" />
                    Редагувати
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              ) : null}
              {isInProgress ? (
                <>
                  <DropdownMenuItem
                    className="gap-2"
                    onClick={() => onComplete(op)}
                  >
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    Завершити роботу
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              ) : null}
              <DropdownMenuItem
                variant="destructive"
                className="gap-2"
                onClick={() => onDelete(op)}
              >
                <Trash2 className="h-4 w-4" />
                Видалити
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
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
            <span className="text-[11px] font-semibold text-zinc-400"> га</span>
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
    </article>
  );
}

type PlanWorkPanelProps = {
  field: Field;
  seasonYear: number;
  units: WialonUnit[];
  initial?: FieldOperation | null;
  onBack: () => void;
  onSubmit: (op: FieldOperation) => void;
};

function PlanWorkPanel({
  field,
  seasonYear,
  units,
  initial = null,
  onBack,
  onSubmit,
}: PlanWorkPanelProps) {
  const areaDefault = Number(field.areaHa) || 0;
  const isEdit = Boolean(initial);
  const unitOptions = useMemo(() => {
    const list = units
      .filter((u) => u.nm?.trim())
      .map((u) => ({ id: u.id, name: u.nm.trim() }))
      .sort((a, b) => a.name.localeCompare(b.name, "uk"));
    if (
      initial?.wialonUnitId != null &&
      !list.some((u) => u.id === initial.wialonUnitId)
    ) {
      return [
        {
          id: initial.wialonUnitId,
          name: initial.machinery || `Unit ${initial.wialonUnitId}`,
        },
        ...list,
      ];
    }
    return list;
  }, [units, initial?.wialonUnitId, initial?.machinery]);

  const [type, setType] = useState<string>(OPERATION_TYPES[0]);
  const [crop, setCrop] = useState(field.crop || "");
  const [date, setDate] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [timeFrom, setTimeFrom] = useState("08:00");
  const [timeTo, setTimeTo] = useState("18:00");
  const [unitId, setUnitId] = useState<string | null>(
    initial?.wialonUnitId != null ? String(initial.wialonUnitId) : null
  );
  const [implement, setImplement] = useState(IMPLEMENT_PRESETS.Посів);
  const [implementWidth, setImplementWidth] = useState(
    String(IMPLEMENT_WIDTH_DEFAULTS.Посів)
  );
  const [areaDone, setAreaDone] = useState(String(areaDefault));
  const [fuelUsed, setFuelUsed] = useState(() =>
    String(estimatePlanFuel(OPERATION_TYPES[0], areaDefault))
  );
  const [wage, setWage] = useState(() => String(estimatePlanWage(areaDefault)));
  const [error, setError] = useState<string | null>(null);

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
      setUnitId(
        initial.wialonUnitId != null
          ? String(initial.wialonUnitId)
          : null
      );
      setImplement(initial.implement);
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
    setAreaDone(area > 0 ? String(area) : "");
    setDate(format(new Date(), "yyyy-MM-dd"));
    setTimeFrom("08:00");
    setTimeTo("18:00");
    setImplement(IMPLEMENT_PRESETS[workType] ?? "");
    setImplementWidth(String(IMPLEMENT_WIDTH_DEFAULTS[workType] ?? 6));
    setFuelUsed(String(estimatePlanFuel(workType, area)));
    setWage(String(estimatePlanWage(area)));
    setUnitId(null);
  }, [initial, field.id, field.crop, field.areaHa]);

  useEffect(() => {
    if (initial) return;
    setUnitId((prev) => prev ?? (unitOptions[0] ? String(unitOptions[0].id) : null));
  }, [unitOptions, initial]);

  function handleTypeChange(next: string | null) {
    if (!next) return;
    setType(next);
    if (!isEdit) {
      setImplement(IMPLEMENT_PRESETS[next] ?? "");
      setImplementWidth(String(IMPLEMENT_WIDTH_DEFAULTS[next] ?? 6));
      const area = Number(areaDone.replace(",", ".")) || areaDefault;
      setFuelUsed(String(estimatePlanFuel(next, area)));
    }
  }

  function handleAreaChange(value: string) {
    setAreaDone(value);
    if (isEdit) return;
    const area = Number(value.replace(",", "."));
    if (!Number.isFinite(area) || area <= 0) return;
    setFuelUsed(String(estimatePlanFuel(type, area)));
    setWage(String(estimatePlanWage(area)));
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const area = Number(areaDone.replace(",", "."));
    const fuel = Number(fuelUsed.replace(",", "."));
    const pay = Number(wage.replace(",", "."));
    const width = Number(implementWidth.replace(",", "."));
    const selectedUnit = unitOptions.find((u) => String(u.id) === unitId);

    if (!type.trim() || !selectedUnit) {
      setError(
        unitOptions.length === 0
          ? "Немає техніки з GPS — перевірте підключення Wialon"
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
      crop: crop.trim() || field.crop || "—",
      date: formatOpDateLabel(date),
      time: `${timeFrom} – ${timeTo}`,
      machinery: selectedUnit.name,
      implement: implement.trim(),
      areaDone: Math.round(area * 100) / 100,
      areaTotal: Number(field.areaHa) || area,
      fuelUsed: Math.round(fuel),
      wage: Math.round(pay),
      status: initial?.status ?? "planned",
      wialonUnitId: selectedUnit.id,
      implementWidthM: Math.round(width * 100) / 100,
      exportStatus: initial?.exportStatus ?? "none",
    };

    onSubmit(op);
  }

  const fieldControlClass = cn(
    "box-border h-11 w-full max-w-full min-w-0 rounded-xl border border-[#E5DFD3] bg-white px-3",
    "text-sm text-zinc-900 shadow-[0_1px_0_rgba(255,255,255,0.8)_inset]",
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
    "grid grid-cols-2 gap-3 p-4 [grid-template-columns:minmax(0,1fr)_minmax(0,1fr)]";
  const row3Class =
    "grid grid-cols-3 gap-3 p-4 [grid-template-columns:minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]";

  return (
    <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="relative overflow-hidden border-b border-[#E5DFD3]/80 bg-gradient-to-br from-[#E8F0EA] via-[#F4F1EA] to-[#EDE8DF] px-6 py-5">
          <div
            className="pointer-events-none absolute -top-12 -right-10 h-36 w-36 rounded-full bg-[#276749]/10 blur-3xl"
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
            <p className="mb-1.5 inline-flex items-center gap-1.5 rounded-full border border-[#276749]/15 bg-white/80 px-2.5 py-1 text-[10px] font-semibold tracking-wider text-[#276749] uppercase">
              <CalendarPlus className="h-3 w-3" />
              {isEdit ? "Редагування" : "Нова операція"}
            </p>
            <h2 className="text-xl font-extrabold tracking-tight text-zinc-900">
              {isEdit ? "Редагувати операцію" : "Запланувати роботи"}
            </h2>
            <p className="mt-1 text-sm text-zinc-600">
              {field.name}
              {field.crop ? ` · ${field.crop}` : ""}
              {" · "}
              {field.areaHa} га
            </p>
          </div>
        </div>

        <div className="space-y-4 px-6 py-5 pb-6">
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
                <Select value={type} onValueChange={handleTypeChange}>
                  <SelectTrigger className={selectTriggerClass}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="z-[120] border-[#E5DFD3] bg-white">
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
            <div className={row3Class}>
              <div className={cellClass}>
                <Label className={labelClass}>Дата</Label>
                <Input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className={cn(fieldControlClass, "min-w-0")}
                />
              </div>
              <div className={cellClass}>
                <Label className={labelClass}>З</Label>
                <Input
                  type="time"
                  value={timeFrom}
                  onChange={(e) => setTimeFrom(e.target.value)}
                  className={cn(fieldControlClass, "min-w-0")}
                />
              </div>
              <div className={cellClass}>
                <Label className={labelClass}>До</Label>
                <Input
                  type="time"
                  value={timeTo}
                  onChange={(e) => setTimeTo(e.target.value)}
                  className={cn(fieldControlClass, "min-w-0")}
                />
              </div>
            </div>
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
                <Label className={labelClass}>Техніка (Wialon)</Label>
                {unitOptions.length > 0 ? (
                  <Select
                    value={unitId}
                    onValueChange={(v) => setUnitId(v)}
                  >
                    <SelectTrigger className={selectTriggerClass}>
                      <SelectValue placeholder="Оберіть одиницю" />
                    </SelectTrigger>
                    <SelectContent className="z-[120] max-h-64 border-[#E5DFD3] bg-white">
                      {unitOptions.map((item) => (
                        <SelectItem key={item.id} value={String(item.id)}>
                          {item.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <div
                    className={cn(
                      fieldControlClass,
                      "flex items-center text-sm text-amber-800"
                    )}
                  >
                    GPS ще не завантажився
                  </div>
                )}
              </div>
              <div className={cellClass}>
                <Label className={labelClass}>Знаряддя</Label>
                <Input
                  value={implement}
                  onChange={(e) => setImplement(e.target.value)}
                  className={fieldControlClass}
                  placeholder="Сівалка, культиватор…"
                />
              </div>
            </div>
            <div className="border-t border-[#E5DFD3]/80 px-4 pb-4">
              <div className={cellClass}>
                <Label className={labelClass}>Ширина знаряддя, м</Label>
                <Input
                  value={implementWidth}
                  onChange={(e) => setImplementWidth(e.target.value)}
                  inputMode="decimal"
                  className={cn(fieldControlClass, "tabular-nums font-semibold")}
                  placeholder="6"
                />
                <p className="text-[10px] text-zinc-400">
                  для оцінки га з GPS: км × ширина / 10
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
                  ≈ {FUEL_L_PER_HA[type] ?? 5} л/га
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
                  ≈ {WAGE_UAH_PER_HA} ₴/га
                </p>
              </div>
            </div>
          </section>

          {error ? (
            <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
              {error}
            </p>
          ) : (
            <p className="text-xs leading-relaxed text-zinc-500">
              Операція зʼявиться в «Історії» зі статусом «Заплановано». Паливо й
              оплату можна скоригувати — зараз це розрахунок від площі поля.
            </p>
          )}
        </div>
      </div>

      <div className="shrink-0 border-t border-[#E5DFD3] bg-gradient-to-t from-[#EDE8DF] to-[#F4F1EA] px-6 py-4">
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
            className={cn(
              "inline-flex h-12 flex-[1.4] items-center justify-center gap-2 rounded-2xl",
              "bg-gradient-to-r from-[#1f5239] via-[#276749] to-[#2f7a52]",
              "text-sm font-bold text-white shadow-[0_10px_28px_-8px_rgba(39,103,73,0.45)]",
              "transition hover:brightness-105"
            )}
          >
            <CalendarPlus className="h-4 w-4" />
            {isEdit ? "Зберегти" : "Додати в історію"}
          </button>
        </div>
      </div>
    </form>
  );
}

/** Широка панель глибокої аналітики поля */
export function FieldDetailSheet({
  field,
  fieldKey = null,
  legacyFieldKeys = [],
  farmFieldId = null,
  fieldGeometry = null,
  analytics: analyticsProp,
  open,
  onOpenChange,
  units = [],
  onPlanWork,
}: FieldDetailSheetProps) {
  const [seasonYear, setSeasonYear] = useState<number>(2026);
  const [period, setPeriod] = useState<HistoryPeriod>("Сезон");
  const [customRange, setCustomRange] = useState<DateRange | undefined>();
  const [rangeOpen, setRangeOpen] = useState(false);
  const [seasonOpen, setSeasonOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("history");
  const [planOpen, setPlanOpen] = useState(false);
  const [editingOp, setEditingOp] = useState<FieldOperation | null>(null);
  const [completeOp, setCompleteOp] = useState<FieldOperation | null>(null);
  const [operations, setOperations] = useState<FieldOperation[]>([]);
  const [opsLoading, setOpsLoading] = useState(false);
  const analytics =
    analyticsProp ?? (field ? FIELD_ANALYTICS[field.id] : null);

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
  }, [open, resolvedFieldKey, legacyKey]);

  const operationsHistory = useMemo(() => {
    if (!resolvedFieldKey) return [];
    const { start, end } = getPeriodRange(period, seasonYear, customRange);
    return operations
      .filter((op) => {
        if (period === "Сезон") return op.seasonYear === seasonYear;
        const day = startOfDay(new Date(`${op.occurredAt}T12:00:00`));
        return day >= start && day <= end;
      })
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  }, [operations, seasonYear, period, customRange, resolvedFieldKey]);

  async function persistOperation(op: FieldOperation) {
    if (!resolvedFieldKey) return op;
    const saved = await upsertFieldOperation({
      ...op,
      fieldKey: resolvedFieldKey,
      fieldId: farmFieldId,
    });
    setOperations((prev) => {
      const next = prev.filter((item) => item.id !== saved.id);
      next.unshift(saved);
      return next.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
    });
    return saved;
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) {
          setPlanOpen(false);
          setEditingOp(null);
          setCompleteOp(null);
        }
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
        {field && analytics ? (
          <>
            {completeOp ? (
              <OperationClosePanel
                op={completeOp}
                fieldId={farmFieldId ?? field.id}
                fieldKey={resolvedFieldKey}
                fieldName={field.name}
                fieldGeometry={fieldGeometry}
                onBack={() => setCompleteOp(null)}
                onConfirm={(payload) => {
                  void persistOperation({
                    ...completeOp,
                    ...payload,
                    exportStatus: "pending",
                  });
                  setCompleteOp(null);
                  setActiveTab("history");
                }}
              />
            ) : planOpen ? (
              <PlanWorkPanel
                field={field}
                seasonYear={seasonYear}
                units={units}
                initial={editingOp}
                onBack={() => {
                  setPlanOpen(false);
                  setEditingOp(null);
                }}
                onSubmit={(op) => {
                  void persistOperation(op).then(() => {
                    if (!editingOp) onPlanWork?.(op);
                  });
                  setEditingOp(null);
                  setPlanOpen(false);
                  setActiveTab("history");
                  setSeasonYear(op.seasonYear);
                  setPeriod("Сезон");
                }}
              />
            ) : (
              <>
            {/* Усе верхнє меню скролиться разом із журналом — місце під контент */}
            <div className="min-h-0 flex-1 overflow-y-auto">
              <SheetHeader className="space-y-0 border-b border-[#E5DFD3] px-6 py-4 text-left">
                <div className="flex flex-wrap items-start justify-between gap-3 pr-8">
                  <div>
                    <SheetTitle className="text-xl font-extrabold tracking-tight text-zinc-900">
                      {field.name}: {field.crop}
                    </SheetTitle>
                    <SheetDescription className="mt-1 text-zinc-500">
                      {field.areaHa} га · глибока аналітика ділянки
                    </SheetDescription>
                  </div>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-[#276749]/30 bg-[#276749]/10 px-2.5 py-1 text-xs font-semibold text-[#276749]">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#276749]" />
                    Активне
                  </span>
                </div>
              </SheetHeader>

              <Tabs
                value={activeTab}
                onValueChange={setActiveTab}
                className="gap-0"
              >
                <div className="border-b border-[#E5DFD3] px-6 pt-2">
                  <TabsList
                    variant="line"
                    className="mb-0 h-auto w-full justify-start gap-1 rounded-none bg-transparent p-0"
                  >
                    {TAB_ITEMS.map((tab) => {
                      const Icon = tab.icon;
                      return (
                        <TabsTrigger
                          key={tab.value}
                          value={tab.value}
                          className={cn(
                            "relative h-11 flex-1 gap-2 rounded-none border-0 bg-transparent px-2 pb-3 text-sm font-medium text-zinc-500 shadow-none",
                            "hover:text-zinc-800",
                            "after:absolute after:inset-x-2 after:bottom-0 after:h-[2.5px] after:rounded-full after:bg-transparent after:opacity-100",
                            "data-active:bg-transparent data-active:text-[#276749] data-active:shadow-none",
                            "data-active:after:bg-[#276749]"
                          )}
                        >
                          <Icon className="h-4 w-4 shrink-0 opacity-80" />
                          {tab.label}
                        </TabsTrigger>
                      );
                    })}
                  </TabsList>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2 border-b border-[#E5DFD3]/70 px-6 pt-1 pb-3.5">
                  <div className="inline-flex flex-wrap items-center gap-0.5 rounded-xl bg-zinc-100 p-1">
                    {PERIOD_OPTIONS.map((option) => {
                      const active = period === option;
                      return (
                        <button
                          key={option}
                          type="button"
                          onClick={() => setPeriod(option)}
                          className={cn(
                            "rounded-md px-3 py-1.5 text-xs transition-all",
                            active
                              ? "bg-white font-medium text-zinc-900 shadow-sm"
                              : "font-medium text-zinc-500 hover:text-zinc-700"
                          )}
                        >
                          {option}
                        </button>
                      );
                    })}

                    <Popover
                      open={seasonOpen}
                      onOpenChange={(next) => {
                        setSeasonOpen(next);
                        if (next) setPeriod("Сезон");
                      }}
                    >
                      <PopoverTrigger
                        className={cn(
                          "inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs transition-all",
                          period === "Сезон"
                            ? "bg-white font-medium text-zinc-900 shadow-sm"
                            : "font-medium text-zinc-500 hover:text-zinc-700"
                        )}
                      >
                        Сезон {seasonYear}
                        <ChevronDown className="h-3 w-3 opacity-60" />
                      </PopoverTrigger>
                      <PopoverContent
                        align="start"
                        className="z-[100] w-40 rounded-xl border border-zinc-200 bg-white p-1 shadow-xl"
                      >
                        {SEASON_OPTIONS.map((year) => (
                          <button
                            key={year}
                            type="button"
                            onClick={() => {
                              setSeasonYear(year);
                              setPeriod("Сезон");
                              setSeasonOpen(false);
                            }}
                            className={cn(
                              "flex w-full items-center rounded-lg px-3 py-2 text-left text-sm transition-colors",
                              seasonYear === year && period === "Сезон"
                                ? "bg-[#276749]/10 font-semibold text-[#276749]"
                                : "text-zinc-700 hover:bg-zinc-50"
                            )}
                          >
                            Сезон {year}
                          </button>
                        ))}
                      </PopoverContent>
                    </Popover>
                  </div>

                  <Popover open={rangeOpen} onOpenChange={setRangeOpen}>
                    <PopoverTrigger
                      className={cn(
                        "inline-flex h-8 items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-700 shadow-sm",
                        "outline-none transition hover:bg-zinc-50 focus-visible:ring-2 focus-visible:ring-[#276749]/25",
                        period === "custom" &&
                          "border-[#276749]/35 bg-[#276749]/5 text-[#276749]"
                      )}
                    >
                      <CalendarIcon className="h-3.5 w-3.5 shrink-0 opacity-70" />
                      {period === "custom" && customRange?.from
                        ? `${format(customRange.from, "d MMM", { locale: uk })}${
                            customRange.to
                              ? ` – ${format(customRange.to, "d MMM", { locale: uk })}`
                              : ""
                          }`
                        : "Діапазон"}
                    </PopoverTrigger>
                    <PopoverContent
                      align="start"
                      className="z-[100] w-auto rounded-2xl border border-zinc-200 bg-white p-2 shadow-xl"
                    >
                      <Calendar
                        mode="range"
                        numberOfMonths={1}
                        selected={customRange}
                        onSelect={(range) => {
                          setCustomRange(range);
                          setPeriod("custom");
                          if (range?.from && range?.to) setRangeOpen(false);
                        }}
                        locale={uk}
                        className="rounded-xl"
                      />
                    </PopoverContent>
                  </Popover>
                </div>

                <TabsContent
                  value="history"
                  className="px-6 py-5 outline-none"
                >
                  {opsLoading ? (
                    <div className="rounded-2xl border border-dashed border-zinc-200 bg-white/70 px-4 py-12 text-center">
                      <p className="text-sm font-semibold text-zinc-800">
                        Завантаження історії…
                      </p>
                    </div>
                  ) : operationsHistory.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-zinc-200 bg-white/70 px-4 py-12 text-center">
                      <p className="text-sm font-semibold text-zinc-800">
                        Немає операцій
                      </p>
                      <p className="mt-1 text-xs text-zinc-500">
                        За обраний період у сезоні {seasonYear} робіт не
                        зафіксовано. Заплануйте першу роботу нижче.
                      </p>
                    </div>
                  ) : (
                    operationsHistory.map((op) => (
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
                      />
                    ))
                  )}
                </TabsContent>

                <TabsContent value="economy" className="px-6 py-5 outline-none">
                  <p className="mb-3 text-xs font-medium tracking-wider text-zinc-500 uppercase">
                    Витрати на 1 гектар · сезон {seasonYear}
                  </p>
                  <ul className="space-y-2">
                    {analytics.costsPerHa.map((item) => (
                      <li
                        key={item.label}
                        className="flex items-center justify-between rounded-xl border border-[#E5DFD3] bg-zinc-100 px-3.5 py-3"
                      >
                        <span className="text-sm text-zinc-900">
                          {item.label}
                        </span>
                        <span className="text-sm font-semibold tabular-nums text-[#C05621]">
                          {formatUsd(item.perHaUsd)}/га
                        </span>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-4 flex items-center justify-between rounded-xl border border-[#276749]/30 bg-[#276749]/10 px-3.5 py-3">
                    <span className="text-sm font-medium text-[#276749]">
                      Разом на га
                    </span>
                    <span className="text-sm font-bold text-[#276749]">
                      {formatUsd(
                        analytics.costsPerHa.reduce(
                          (sum, item) => sum + item.perHaUsd,
                          0
                        )
                      )}
                      /га
                    </span>
                  </div>
                  <div className="mt-3 rounded-xl border border-[#E5DFD3] bg-zinc-100 px-3.5 py-3 text-xs text-zinc-500">
                    Очікуваний дохід поля:{" "}
                    <span className="font-semibold text-zinc-900">
                      {formatUsd(field.economics.expectedRevenueUsd)}
                    </span>
                  </div>
                </TabsContent>

                <TabsContent value="overview" className="px-6 py-5 outline-none">
                  <div className="mb-4 grid grid-cols-2 gap-3">
                    <div className="rounded-xl border border-[#E5DFD3] bg-zinc-100 p-3.5">
                      <p className="text-[11px] tracking-wider text-zinc-500 uppercase">
                        Рентабельність
                      </p>
                      <p className="mt-1 text-2xl font-extrabold tracking-tight text-[#276749]">
                        {analytics.profitabilityPercent}%
                      </p>
                    </div>
                    <div className="rounded-xl border border-[#E5DFD3] bg-zinc-100 p-3.5">
                      <div className="flex items-center gap-1.5 text-[11px] tracking-wider text-zinc-500 uppercase">
                        <Sprout className="h-3 w-3 text-[#276749]" />
                        Прогноз врожаю
                      </div>
                      <p className="mt-1 text-2xl font-extrabold tracking-tight text-zinc-900">
                        {analytics.yieldForecastTHa}{" "}
                        <span className="text-sm font-medium text-zinc-500">
                          т/га
                        </span>
                      </p>
                    </div>
                  </div>

                  <p className="mb-2 flex items-center gap-2 text-xs font-medium tracking-wider text-zinc-500 uppercase">
                    <TrendingUp className="h-3.5 w-3.5 text-[#276749]" />
                    Динаміка рентабельності
                  </p>
                  <ChartContainer
                    config={chartConfig}
                    className="aspect-auto h-[180px] w-full"
                  >
                    <AreaChart
                      data={analytics.profitSeries}
                      margin={{ top: 8, right: 4, left: 0, bottom: 0 }}
                    >
                      <defs>
                        <linearGradient
                          id="fillFieldProfit"
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop
                            offset="0%"
                            stopColor="var(--color-profit)"
                            stopOpacity={0.35}
                          />
                          <stop
                            offset="100%"
                            stopColor="var(--color-profit)"
                            stopOpacity={0}
                          />
                        </linearGradient>
                      </defs>
                      <CartesianGrid
                        vertical={false}
                        stroke="#E5DFD3"
                        strokeOpacity={0.8}
                      />
                      <XAxis
                        dataKey="month"
                        tickLine={false}
                        axisLine={false}
                        tick={{ fill: "#71717a", fontSize: 11 }}
                      />
                      <ChartTooltip
                        content={
                          <ChartTooltipContent
                            className="border-[#E5DFD3] bg-[#F4F1EA] text-zinc-900 shadow-sm"
                            formatter={(value) => (
                              <span className="font-semibold text-[#276749]">
                                {Number(value)}%
                              </span>
                            )}
                          />
                        }
                      />
                      <Area
                        dataKey="profit"
                        type="monotone"
                        fill="url(#fillFieldProfit)"
                        stroke="var(--color-profit)"
                        strokeWidth={2}
                        dot={false}
                      />
                    </AreaChart>
                  </ChartContainer>
                </TabsContent>
              </Tabs>
            </div>

            <SheetFooter className="shrink-0 border-t border-[#E5DFD3] bg-gradient-to-t from-[#EDE8DF] to-[#F4F1EA] px-6 py-4">
              <button
                type="button"
                onClick={() => {
                  setEditingOp(null);
                  setPlanOpen(true);
                }}
                className={cn(
                  "group relative w-full overflow-hidden rounded-2xl px-5 py-3.5 text-sm font-bold text-white",
                  "bg-gradient-to-r from-[#1f5239] via-[#276749] to-[#2f7a52]",
                  "shadow-[0_10px_28px_-8px_rgba(39,103,73,0.55)]",
                  "transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_16px_32px_-10px_rgba(39,103,73,0.6)]",
                  "active:translate-y-0 active:scale-[0.99]"
                )}
              >
                <span
                  className="pointer-events-none absolute inset-0 bg-gradient-to-r from-white/0 via-white/15 to-white/0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                  aria-hidden
                />
                <span className="relative inline-flex items-center justify-center gap-2.5">
                  <CalendarPlus className="h-4.5 w-4.5 h-[18px] w-[18px]" />
                  Запланувати роботи
                </span>
              </button>
            </SheetFooter>
              </>
            )}
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

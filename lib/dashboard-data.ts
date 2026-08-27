/**
 * Мок-дані дашборду.
 * Структура навмисно близька до майбутніх таблиць Supabase (fields, field_events, activity_log).
 */

export type AccentTone = "lime" | "amber" | "orange";

export type TimelineIcon = "tractor" | "droplet" | "cloud";

export type FieldTimelineItem = {
  id: string;
  dateLabel: string;
  title: string;
  /** completed = виконано, waiting = очікування */
  status: "completed" | "waiting";
  icon: TimelineIcon;
};

export type FieldEconomics = {
  costPerHaUsd: number;
  fuelUsedL: number;
  expectedRevenueUsd: number;
};

export type Field = {
  id: string;
  name: string;
  crop: string;
  areaHa: number;
  status: "active" | "idle";
  /** CSS-класи позиціонування плашки на карті-плейсхолдері */
  mapPositionClass: string;
  accent: AccentTone;
  economics: FieldEconomics;
  timeline: FieldTimelineItem[];
};

export type ActivityItem = {
  id: string;
  title: string;
  detail: string;
  timeAgo: string;
  accent: AccentTone;
  icon: "tractor" | "banknote" | "sprout";
};

export const FIELDS: Field[] = [
  {
    id: "field-1",
    name: "Поле 1",
    crop: "Соя",
    areaHa: 45,
    status: "active",
    mapPositionClass: "top-[22%] left-[18%]",
    accent: "lime",
    economics: {
      costPerHaUsd: 120,
      fuelUsedL: 450,
      expectedRevenueUsd: 45000,
    },
    timeline: [
      {
        id: "ev-1",
        dateLabel: "10 Травня",
        title: "Посів завершено",
        status: "completed",
        icon: "tractor",
      },
      {
        id: "ev-2",
        dateLabel: "15 Травня",
        title: "Внесення добрив",
        status: "completed",
        icon: "droplet",
      },
      {
        id: "ev-3",
        dateLabel: "Сьогодні",
        title: "Очікування опадів",
        status: "waiting",
        icon: "cloud",
      },
    ],
  },
  {
    id: "field-2",
    name: "Поле 2",
    crop: "Кукурудза",
    areaHa: 62,
    status: "active",
    mapPositionClass: "top-[48%] right-[16%]",
    accent: "amber",
    economics: {
      costPerHaUsd: 145,
      fuelUsedL: 680,
      expectedRevenueUsd: 72000,
    },
    timeline: [
      {
        id: "ev-4",
        dateLabel: "2 Травня",
        title: "Посів завершено",
        status: "completed",
        icon: "tractor",
      },
      {
        id: "ev-5",
        dateLabel: "12 Травня",
        title: "Внесення добрив",
        status: "completed",
        icon: "droplet",
      },
      {
        id: "ev-6",
        dateLabel: "Сьогодні",
        title: "Моніторинг вологості",
        status: "waiting",
        icon: "cloud",
      },
    ],
  },
  {
    id: "field-3",
    name: "Поле 3",
    crop: "Пшениця",
    areaHa: 38,
    status: "active",
    mapPositionClass: "bottom-[18%] left-[34%]",
    accent: "orange",
    economics: {
      costPerHaUsd: 95,
      fuelUsedL: 310,
      expectedRevenueUsd: 28000,
    },
    timeline: [
      {
        id: "ev-7",
        dateLabel: "28 Квітня",
        title: "Посів завершено",
        status: "completed",
        icon: "tractor",
      },
      {
        id: "ev-8",
        dateLabel: "8 Травня",
        title: "Внесення добрив",
        status: "completed",
        icon: "droplet",
      },
      {
        id: "ev-9",
        dateLabel: "Сьогодні",
        title: "Очікування опадів",
        status: "waiting",
        icon: "cloud",
      },
    ],
  },
];

export const ACTIVITY_FEED: ActivityItem[] = [
  {
    id: "act-1",
    title: "Заправка МТЗ",
    detail: "Іван списав 50л дизелю",
    timeAgo: "2 хв тому",
    accent: "lime",
    icon: "tractor",
  },
  {
    id: "act-2",
    title: "Оплата добрив",
    detail: "− 45,000 грн",
    timeAgo: "1 год тому",
    accent: "amber",
    icon: "banknote",
  },
  {
    id: "act-3",
    title: "Посів",
    detail: "Завершено на Полі 3",
    timeAgo: "3 год тому",
    accent: "lime",
    icon: "sprout",
  },
];

export const DASHBOARD_SUMMARY = {
  cashBalanceUah: 1_250_000,
  cashTrendPercent: 15,
  expensesUah: 185_000,
  expensesTrendPercent: 8,
  fuelLiters: 6500,
  fuelCapacityLiters: 10_000,
  dieselLiters: 5200,
  gasolineLiters: 1300,
  weather: {
    tempC: 24,
    condition: "Мінливо, ясно",
    windMs: 4,
    humidityPercent: 58,
    region: "Київська обл.",
  },
  totalAreaHa: 145,
};

/** Періоди фінансового огляду */
export type FinancePeriod = "month" | "quarter" | "season" | "ytd";

export const FINANCE_PERIOD_OPTIONS: {
  id: FinancePeriod;
  label: string;
}[] = [
  { id: "month", label: "Місяць" },
  { id: "quarter", label: "Квартал" },
  { id: "season", label: "Сезон" },
  { id: "ytd", label: "З початку року" },
];

/** Мок каси / витрат за періодами */
export const FINANCE_BY_PERIOD: Record<
  FinancePeriod,
  {
    cashUah: number;
    cashTrendPercent: number;
    expensesUah: number;
    expensesTrendPercent: number;
    hint: string;
  }
> = {
  month: {
    cashUah: 1_250_000,
    cashTrendPercent: 15,
    expensesUah: 185_000,
    expensesTrendPercent: 8,
    hint: "Поточний місяць",
  },
  quarter: {
    cashUah: 3_420_000,
    cashTrendPercent: 11,
    expensesUah: 612_000,
    expensesTrendPercent: 5,
    hint: "II квартал 2026",
  },
  season: {
    cashUah: 5_870_000,
    cashTrendPercent: 18,
    expensesUah: 1_240_000,
    expensesTrendPercent: 12,
    hint: "Сезон 2026",
  },
  ytd: {
    cashUah: 4_980_000,
    cashTrendPercent: 14,
    expensesUah: 980_000,
    expensesTrendPercent: 9,
    hint: "Січень — серпень",
  },
};

/** Підказка Агро-ШІ (майбутня таблиця ai_insights) */
export const AI_INSIGHT = {
  id: "ai-1",
  title: "AI Аналітика",
  message:
    "Оптимальний час для обприскування Поля №2 — завтра з 05:00 до 07:30. Вітер мінімальний.",
  confidencePercent: 94,
};

export type FleetStatus = "in_field" | "at_base" | "maintenance";

export type FleetUnit = {
  id: string;
  name: string;
  status: FleetStatus;
  /** null — паливо неактуальне (наприклад, на ТО) */
  fuelPercent: number | null;
};

export const FLEET_UNITS: FleetUnit[] = [
  {
    id: "fleet-1",
    name: "John Deere 8R",
    status: "in_field",
    fuelPercent: 45,
  },
  {
    id: "fleet-2",
    name: "МТЗ-82",
    status: "at_base",
    fuelPercent: 90,
  },
  {
    id: "fleet-3",
    name: "Комбайн Claas",
    status: "maintenance",
    fuelPercent: null,
  },
];

export const FLEET_STATUS_META: Record<
  FleetStatus,
  { label: string; dotClass: string; textClass: string }
> = {
  in_field: {
    label: "В полі",
    dotClass: "bg-[#276749]",
    textClass: "text-[#276749]",
  },
  at_base: {
    label: "На базі",
    dotClass: "bg-[#D69E2E]",
    textClass: "text-[#D69E2E]",
  },
  maintenance: {
    label: "ТО/Ремонт",
    dotClass: "bg-[#C05621]",
    textClass: "text-[#C05621]",
  },
};

/** Фінансова аналітика за місяцями 2026 */
export const FINANCIAL_CHART_2026 = [
  { month: "Січ", income: 28000, expense: 14000 },
  { month: "Лют", income: 32000, expense: 15500 },
  { month: "Бер", income: 36000, expense: 16800 },
  { month: "Кві", income: 41000, expense: 18200 },
  { month: "Тра", income: 45000, expense: 12000 },
  { month: "Чер", income: 52000, expense: 21000 },
  { month: "Лип", income: 48000, expense: 19500 },
  { month: "Сер", income: 55000, expense: 23000 },
] as const;

export const FINANCIAL_MONTH_FULL: Record<string, string> = {
  Січ: "Січень",
  Лют: "Лютий",
  Бер: "Березень",
  Кві: "Квітень",
  Тра: "Травень",
  Чер: "Червень",
  Лип: "Липень",
  Сер: "Серпень",
};

/** Пункти глобального пошуку (Command Menu) */
export const COMMAND_ITEMS = [
  {
    id: "cmd-field",
    label: "Знайти поле",
    hint: "Карта та економіка ділянок",
    group: "Операції",
    icon: "map" as const,
    href: "/",
  },
  {
    id: "cmd-mtz",
    label: "Статус техніки",
    hint: "Моніторинг автопарку",
    group: "Техніка",
    icon: "tractor" as const,
    href: "/equipment",
  },
  {
    id: "cmd-fuel",
    label: "Склад палива",
    hint: "Резервуари та списання",
    group: "Техніка",
    icon: "fuel" as const,
    href: "/fuel",
  },
  {
    id: "cmd-report",
    label: "Звіт за місяць",
    hint: "Фінансова аналітика",
    group: "Аналітика",
    icon: "chart" as const,
    href: "/finance",
  },
  {
    id: "cmd-export",
    label: "Бухгалтерія",
    hint: "Excel чернеток для бухгалтера",
    group: "Операції",
    icon: "chart" as const,
    href: "/export",
  },
  {
    id: "cmd-inventory",
    label: "Склад",
    hint: "ЗЗР, добрива, локальні списання",
    group: "Операції",
    icon: "fuel" as const,
    href: "/inventory",
  },
  {
    id: "cmd-bas-mapping",
    label: "Мапінг 1С",
    hint: "Зіставлення з BAS AGRO",
    group: "Адмін",
    icon: "link" as const,
    href: "/admin/mapping",
  },
  {
    id: "cmd-bas-request",
    label: "Звірка полів",
    hint: "Заявка бухгалтеру по довіднику 1С",
    group: "Адмін",
    icon: "link" as const,
    href: "/admin/bas-request",
  },
] as const;

/** Типи фінансових операцій для ручного введення */
export const OPERATION_TYPES = [
  "Продаж врожаю",
  "Закупівля добрив",
  "Зарплата",
  "Ремонт",
] as const;

export type OperationKind = "income" | "expense";

export type OperationStatus = "completed" | "pending" | "draft";

export type OperationRecord = {
  id: string;
  type: (typeof OPERATION_TYPES)[number];
  kind: OperationKind;
  fieldLabel: string | null;
  amountUah: number;
  dateLabel: string;
  status: OperationStatus;
};

export const OPERATION_RECORDS: OperationRecord[] = [
  {
    id: "op-1",
    type: "Продаж врожаю",
    kind: "income",
    fieldLabel: "Поле 2: Кукурудза",
    amountUah: 185_000,
    dateLabel: "02.05.2026",
    status: "completed",
  },
  {
    id: "op-2",
    type: "Закупівля добрив",
    kind: "expense",
    fieldLabel: "Поле 1: Соя",
    amountUah: 45_000,
    dateLabel: "01.05.2026",
    status: "completed",
  },
  {
    id: "op-3",
    type: "Зарплата",
    kind: "expense",
    fieldLabel: null,
    amountUah: 62_000,
    dateLabel: "30.04.2026",
    status: "pending",
  },
  {
    id: "op-4",
    type: "Ремонт",
    kind: "expense",
    fieldLabel: null,
    amountUah: 18_500,
    dateLabel: "28.04.2026",
    status: "completed",
  },
  {
    id: "op-5",
    type: "Продаж врожаю",
    kind: "income",
    fieldLabel: "Поле 3: Пшениця",
    amountUah: 96_000,
    dateLabel: "22.04.2026",
    status: "draft",
  },
  {
    id: "op-6",
    type: "Закупівля добрив",
    kind: "expense",
    fieldLabel: "Поле 2: Кукурудза",
    amountUah: 31_200,
    dateLabel: "15.04.2026",
    status: "completed",
  },
];

export const OPERATION_STATUS_META: Record<
  OperationStatus,
  { label: string; className: string }
> = {
  completed: {
    label: "Завершено",
    className: "border-[#276749]/30 bg-[#276749]/10 text-[#276749]",
  },
  pending: {
    label: "В обробці",
    className: "border-[#D69E2E]/30 bg-[#D69E2E]/10 text-[#D69E2E]",
  },
  draft: {
    label: "Чернетка",
    className: "border-[#C05621]/30 bg-[#C05621]/10 text-[#C05621]",
  },
};

/** Мок складських залишків */
export const INVENTORY_ITEMS = [
  { id: "inv-1", name: "Соя (урожай)", qty: "185 т", status: "На складі" },
  { id: "inv-2", name: "Кукурудза", qty: "420 т", status: "На складі" },
  { id: "inv-3", name: "Добрива NPK", qty: "12 т", status: "Низький запас" },
  { id: "inv-4", name: "Насіння сої", qty: "4.2 т", status: "На складі" },
] as const;

/** Допоміжні класи акценту для списку та тактичної карти (Gunmetal + Clay) */
export const ACCENT_STYLES: Record<
  AccentTone,
  { glow: string; dot: string; shape: string; pill: string }
> = {
  lime: {
    glow: "shadow-[0_0_16px_rgba(39,103,73,0.4)]",
    dot: "bg-[#276749]",
    shape: "border-[#276749]/40 bg-[#276749]/15",
    pill: "border-[#276749]/60 bg-[#276749]/30 text-white",
  },
  amber: {
    glow: "shadow-[0_0_16px_rgba(214,158,46,0.4)]",
    dot: "bg-[#D69E2E]",
    shape: "border-[#D69E2E]/40 bg-[#D69E2E]/15",
    pill: "border-[#D69E2E]/60 bg-[#D69E2E]/30 text-white",
  },
  orange: {
    glow: "shadow-[0_0_16px_rgba(192,86,33,0.4)]",
    dot: "bg-[#C05621]",
    shape: "border-[#C05621]/40 bg-[#C05621]/15",
    pill: "border-[#C05621]/60 bg-[#C05621]/30 text-white",
  },
};

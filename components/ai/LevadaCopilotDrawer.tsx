"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle,
  ArrowUp,
  ArrowUpRight,
  Calendar,
  Camera,
  CheckCircle2,
  Eraser,
  FileText,
  Fuel,
  Loader2,
  MapPin,
  Paperclip,
  Sparkles,
  Tractor,
  Warehouse,
  Wheat,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
  type ReactNode,
} from "react";

import { VoiceInputButton } from "@/components/ai/VoiceInputButton";
import { executeWarehouseReceiptAction } from "@/app/admin/inventory/actions";
import {
  attachServiceActDocumentsAction,
  executeServiceActSaveAction,
} from "@/app/accounting/actions";
import { getMyProfileAction } from "@/app/team/actions";
import {
  ROLE_LABEL_UK,
  type AppActor,
  type AppRole,
} from "@/lib/app-actor-shared";
import {
  upsertFieldOperation,
  type FieldOperation,
} from "@/lib/field-operations";
import { useIsMobile } from "@/lib/use-mobile";
import { canAccessLevadius } from "@/lib/levadius-access";
import {
  compressAgentFiles,
  formatFileKib,
} from "@/lib/compress-image-file";
import { cn } from "@/lib/utils";

const ATTACH_INVOICE_CHOICE_RE = /прикріпити\s+накладн/i;

/** Ліміт ДО стиснення (камера iPhone часто 5–12 МБ). Після — ~450 КБ. */
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const MAX_PENDING_ATTACHMENTS = 5;

type PendingAttachment = {
  id: string;
  file: File;
  previewUrl: string | null;
};

function isAcceptedAgentFile(file: File): boolean {
  const isImage = file.type.startsWith("image/");
  const isPdf =
    file.type === "application/pdf" ||
    file.name.toLowerCase().endsWith(".pdf");
  return isImage || isPdf;
}

function filesFromDataTransfer(dt: DataTransfer | null): File[] {
  if (!dt) return [];
  if (dt.files?.length) return Array.from(dt.files);
  const out: File[] = [];
  for (const item of Array.from(dt.items ?? [])) {
    if (item.kind !== "file") continue;
    const file = item.getAsFile();
    if (file) out.push(file);
  }
  return out;
}

function isAttachInvoiceChoice(text: string): boolean {
  return ATTACH_INVOICE_CHOICE_RE.test(text.trim());
}

function normalizeChoiceKey(text: string | null | undefined): string {
  return (text ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

const QUICK_CHIPS = [
  "Скільки палива на складі?",
  "Які площі під кукурудзою?",
  "Чи є незакриті наряди?",
] as const;

function greetingFirstName(me: AppActor | null): string | null {
  const raw = (me?.label || me?.fullName || "").trim();
  if (!raw || raw === "Користувач") return null;
  return raw.split(/\s+/)[0] || null;
}

function pickWelcomeGreeting(input: {
  seed: number;
  name: string | null;
  pathname: string;
  hasField: boolean;
}): { hi: string; tip: string } {
  const { seed, name, pathname, hasField } = input;
  const hour = new Date().getHours();

  const hi = name
    ? hour < 11
      ? `Доброго ранку, ${name}.`
      : hour >= 18
        ? `Добрий вечір, ${name}.`
        : `Привіт, ${name}.`
    : hour < 11
      ? "Доброго ранку."
      : hour >= 18
        ? "Добрий вечір."
        : "Привіт.";

  const path = pathname.toLowerCase();
  let tipPool: string[];
  if (hasField) {
    tipPool = [
      "Можу глянути роботи по цьому полю або підготувати наряд.",
      "Потрібен статус поля чи новий наряд — пиши.",
    ];
  } else if (path.startsWith("/fuel")) {
    tipPool = [
      "Можу перевірити залишки палива.",
      "Потрібно звірити цистерни — кажи.",
    ];
  } else if (path.startsWith("/inventory")) {
    tipPool = [
      "Можу глянути залишки насіння, ЗЗР чи добрив.",
      "Що перевірити на складі?",
    ];
  } else if (path.startsWith("/operations")) {
    tipPool = [
      "Можу показати незакриті наряди.",
      "Потрібно пробігтись по плані — пиши.",
    ];
  } else if (path.startsWith("/equipment")) {
    tipPool = [
      "Можу допомогти зібрати наряд під техніку.",
      "Що перевіряємо по техніці?",
    ];
  } else {
    tipPool = [
      "Можу глянути поля, паливо чи незакриті наряди.",
      "Потрібна допомога зі складом або нарядом — пиши.",
      "Що перевірити?",
    ];
  }

  return {
    hi,
    tip: tipPool[seed % tipPool.length]!,
  };
}

const TOOL_STATUS_LABELS: Record<string, string> = {
  getFieldsStatus: "Звіряю дані по полях…",
  getWarehouseStock: "Читаю залишки складу…",
  getFleetAndImplements: "Дивлюсь техніку й знаряддя…",
  getDriversList: "Збираю механізаторів…",
  getFieldWeather: "Дивлюсь погоду по полю…",
  checkSprayingWeatherWindow: "Оцінюю вікно для обприскування…",
  getFieldNdviStatus: "Читаю NDVI / супутникові тривоги…",
  getFieldOperationsHistory: "Читаю історію робіт по полю…",
  getDailyOperationsSummary: "Збираю диспетчерське зведення дня…",
  getFuelStorageBalance: "Читаю залишки пального…",
  logFuelRefueling: "Готую заправку техніки…",
  getFieldFuelEfficiency: "Рахую витрату л/га…",
  getEquipmentMaintenanceStatus: "Перевіряю ТО та мотогодини…",
  linkServiceActToEquipment: "Привʼязую акт до техніки…",
  logMaintenanceCompleted: "Фіксую проходження ТО…",
  updateInventoryItemPrice: "Оновлюю ціну матеріалу…",
  calculateDriverEarnings: "Рахую нарахування механізаторам…",
  getFieldBudgetBurnRate: "Рахую burn rate бюджету поля…",
  queueDocumentToBasSync: "Ставлю документ у чергу BAS…",
  getFieldTechCardMatrix: "Будую техкарту / метро етапів…",
  generateFieldExportReport: "Готую CSV-звіт по полю…",
  syncFieldWialonGeofence: "Синхронізую геозону Wialon…",
  searchFieldsCatalog: "Шукаю ділянки в каталозі…",
  getFieldUnifiedTimeline: "Збираю хронологію поля…",
  getFieldCostAnalysis: "Рахую собівартість поля…",
  getLandBankSummary: "Рахую земельний банк…",
  getFieldLiveTelemetry: "Дивлюсь live GPS / хто на полі…",
  focusFieldOnMap: "Відкриваю поле на карті…",
  updateFieldDetails: "Оновлюю паспорт поля…",
  updateFieldPlannedBudget: "Оновлюю плановий бюджет поля…",
  createField: "Створюю нове поле…",
  deleteField: "Готую видалення / архів поля…",
  analyzeAndSaveScoutingReport: "Аналізую фото посіву…",
  createWorkOrderFromGpsVisit: "Готую наряд з GPS Wialon…",
  writeWarehouseItem: "Реєструю нову позицію складу…",
  writeOffInventoryToField: "Списую ТМЦ на поле…",
  previewInvoiceReceipt: "Читаю накладну…",
  executeWarehouseReceipt: "Оприбутковую на склад…",
  rollbackWarehouseReceipt: "Скасовую накладну…",
  previewServiceAct: "Читаю акт послуг…",
  executeServiceActSave: "Записую акт у Бухгалтерію…",
  deleteServiceActs: "Готую видалення актів…",
  prepareWorkOrder: "Готую чернетку наряду…",
  confirmWorkOrder: "Зберігаю наряд у Хронологію…",
  deleteWorkOrder: "Шукаю наряд для видалення…",
  closeWorkOrder: "Закриваю наряд / фіксую факт…",
  getOperationRates: "Звіряю тарифи ₴/га…",
  setOperationRate: "Оновлюю ставку операції…",
  logUnsupportedRequest: "Записую в беклог Назару…",
  getUnhandledRequests: "Читаю беклог фіч…",
};

const IconMap = {
  Fuel,
  Tractor,
  Wheat,
  Warehouse,
  MapPin,
  AlertCircle,
  CheckCircle2,
  Calendar,
  ArrowUpRight,
  FileText,
  Sparkles,
} as const satisfies Record<string, LucideIcon>;

type IconName = keyof typeof IconMap;

const ICON_ALIASES: Record<string, IconName> = {
  fuel: "Fuel",
  tractor: "Tractor",
  wheat: "Wheat",
  warehouse: "Warehouse",
  mappin: "MapPin",
  map: "MapPin",
  pin: "MapPin",
  alert: "AlertCircle",
  alertcircle: "AlertCircle",
  check: "CheckCircle2",
  checkcircle: "CheckCircle2",
  checkcircle2: "CheckCircle2",
  calendar: "Calendar",
  arrowupright: "ArrowUpRight",
  arrow: "ArrowUpRight",
  filetext: "FileText",
  file: "FileText",
  sparkles: "Sparkles",
};

function resolveIconName(raw: string | undefined | null): IconName | null {
  if (!raw?.trim()) return null;
  const normalized = raw.trim().replace(/[_-\s]/g, "");
  if (normalized in IconMap) return normalized as IconName;
  return ICON_ALIASES[normalized.toLowerCase()] ?? null;
}

function AgentIcon({
  name,
  className,
}: {
  name: string | null | undefined;
  className?: string;
}) {
  const resolved = resolveIconName(name);
  if (!resolved) return null;
  const Icon = IconMap[resolved];
  return (
    <Icon
      className={cn(
        "mr-1.5 inline-block h-4 w-4 align-middle text-emerald-400",
        className
      )}
      strokeWidth={2.1}
      aria-hidden
    />
  );
}

type UserContextPayload = {
  pathname: string;
  activeFieldId?: string;
  userName: string;
  userRole: string;
};

/** Оновлюється в effect — щоб transport не читав ref під час render. */
let liveUserContext: UserContextPayload = {
  pathname: "/",
  userName: "Користувач",
  userRole: "Користувач",
};

type LevadaCopilotDrawerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** drawer — шторка в Farm OS; fullscreen — автономний PWA /copilot */
  variant?: "drawer" | "fullscreen";
};

function formatChatError(error: Error | undefined): string {
  const raw = error?.message?.trim() || "";
  if (!raw) {
    return "Сервер повернув помилку. Спробуй ще раз або перефразуй запит.";
  }

  // AI SDK кидає response.text() як message — часто це JSON { error: "..." }
  if (raw.startsWith("{")) {
    try {
      const parsed = JSON.parse(raw) as { error?: unknown; message?: unknown };
      const nested =
        (typeof parsed.error === "string" && parsed.error.trim()) ||
        (typeof parsed.message === "string" && parsed.message.trim()) ||
        "";
      if (nested) return nested;
    } catch {
      /* not JSON */
    }
  }

  const lower = raw.toLowerCase();
  if (
    lower.includes("high demand") ||
    lower.includes("resource exhausted") ||
    lower.includes("overloaded") ||
    lower.includes("503") ||
    /\bunavailable\b/.test(lower)
  ) {
    return "Модель Google зараз перевантажена. Спробуй ще раз за кілька секунд.";
  }
  if (
    lower.includes("failed to fetch") ||
    lower.includes("networkerror") ||
    lower.includes("load failed") ||
    lower.includes("the network connection was lost")
  ) {
    return "Немає звʼязку з сервером. Перевір інтернет і спробуй ще раз.";
  }
  if (
    lower.includes("payload_too_large") ||
    lower.includes("entity too large") ||
    lower.includes("413") ||
    lower.includes("request entity too large")
  ) {
    return "Фото завеликі для відправки. Спробуй ще раз — нові фото стискаються автоматично.";
  }
  if (lower.includes("авторизац") || lower.includes("unauthorized") || lower.includes("401")) {
    return "Сесія закінчилась. Відкрий LEVADA в Safari, увійди знову, потім PWA.";
  }
  return raw;
}

function roleBadgeLabel(role: AppRole | null | undefined): string {
  if (!role) return "Користувач";
  return ROLE_LABEL_UK[role] ?? "Користувач";
}

function messageText(message: UIMessage): string {
  return message.parts
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("");
}

type AgentAction =
  | {
      kind: "navigate";
      path: string;
      label: string;
      icon: IconName | null;
    }
  | {
      kind: "reply";
      text: string;
      label: string;
      icon: IconName | null;
    };

const NAVIGATE_TAG_RE =
  /\[\[\s*ACTION:NAVIGATE\s*\|\s*([^|\]]+?)\s*\|\s*([^|\]]+?)\s*(?:\|\s*([^\]]+?)\s*)?\]\]/gi;

const REPLY_TAG_RE =
  /\[\[\s*ACTION:REPLY\s*\|\s*([^|\]]+?)\s*\|\s*([^\]]+?)\s*\]\]/gi;

const CHOICE_TAG_RE = /\[\[\s*CHOICE\s*:\s*([^\]]+?)\s*\]\]/gi;

const DISMISS_DRAFT_TAG_RE = /\[\[\s*ACTION:DISMISS_DRAFT\s*\]\]/gi;

const ROW_TAG_RE =
  /^\[row:([a-zA-Z0-9_-]+)\|([^|\]]+)\|([^\]]+)\]\s*$/i;

const NUMBER_CHUNK_RE =
  /(\d{1,3}(?:[ \u00a0]\d{3})*(?:[.,]\d+)?|\d+(?:[.,]\d+)?)(\s?(?:га|л|кг|т|шт|грн|%))?/gi;

const METRIC_TAIL_RE =
  /^(.+?)\s*(?:[—–\-|:]\s+|\s{2,})\s*\*{0,2}([\d\s.,]+)\s*(га|л|кг|т|шт|грн|%)\*{0,2}\s*$/i;

function normalizeAgentPath(rawPath: string): string {
  const trimmed = rawPath.trim();
  if (!trimmed) return "/";

  try {
    const url = new URL(trimmed, "https://levada.local");
    let pathname = url.pathname || "/";
    const params = url.searchParams;

    if (pathname === "/warehouse" || pathname.startsWith("/warehouse/")) {
      pathname = pathname.replace(/^\/warehouse/, "/inventory");
    }

    // Карта полів живе на `/` з ?field=UUID (не /fields — редірект губить query)
    if (pathname === "/fields" || pathname.startsWith("/fields/")) {
      const fieldId =
        params.get("field") ||
        params.get("fieldId") ||
        params.get("id") ||
        pathname.split("/")[2] ||
        "";
      if (fieldId) return `/?field=${encodeURIComponent(fieldId)}`;
      return "/";
    }

    if (pathname === "/") {
      if (params.has("fieldId") && !params.has("field")) {
        params.set("field", params.get("fieldId")!);
        params.delete("fieldId");
      }
      if (params.has("id") && !params.has("field")) {
        params.set("field", params.get("id")!);
        params.delete("id");
      }
    }

    const search = params.toString();
    return search ? `${pathname}?${search}` : pathname;
  } catch {
    return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  }
}

function extractFieldIdFromAgentPath(path: string): string | null {
  try {
    const url = new URL(normalizeAgentPath(path), "https://levada.local");
    const field = url.searchParams.get("field")?.trim();
    return field || null;
  } catch {
    return null;
  }
}

const LEVADA_OPEN_FIELD_EVENT = "levada:open-field";

function extractAgentActions(text: string): {
  body: string;
  actions: AgentAction[];
  choices: string[];
  dismissDraft: boolean;
} {
  const actions: AgentAction[] = [];
  const choices: string[] = [];
  let dismissDraft = false;
  let body = text.replace(
    NAVIGATE_TAG_RE,
    (_match, path: string, second: string, third?: string) => {
      const normalized = normalizeAgentPath(path);
      const hasIconAndLabel =
        typeof third === "string" && third.trim().length > 0;
      const label = (hasIconAndLabel ? third : second).trim();
      const icon = hasIconAndLabel ? resolveIconName(second) : null;
      if (normalized && label) {
        actions.push({ kind: "navigate", path: normalized, label, icon });
      }
      return "";
    }
  );

  body = body
    .replace(REPLY_TAG_RE, (_match, iconRaw: string, labelRaw: string) => {
      const label = labelRaw.trim();
      if (label) {
        actions.push({
          kind: "reply",
          text: label,
          label,
          icon: resolveIconName(iconRaw),
        });
      }
      return "";
    })
    .replace(DISMISS_DRAFT_TAG_RE, () => {
      dismissDraft = true;
      return "";
    })
    .replace(CHOICE_TAG_RE, (_match, choiceRaw: string) => {
      const choice = choiceRaw.trim();
      if (choice) choices.push(choice);
      return "";
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { body, actions, choices, dismissDraft };
}

function renderInlineMarkdown(
  text: string,
  keyPrefix: string,
  accent: boolean
): ReactNode[] {
  const nodes: ReactNode[] = [];
  const parts = text.split(/(\[icon:[a-zA-Z0-9_-]+\]|\*\*[^*]+\*\*)/gi);

  parts.forEach((chunk, index) => {
    if (!chunk) return;
    const key = `${keyPrefix}-p${index}`;

    const iconMatch = chunk.match(/^\[icon:([a-zA-Z0-9_-]+)\]$/i);
    if (iconMatch) {
      nodes.push(<AgentIcon key={key} name={iconMatch[1]} />);
      return;
    }

    if (chunk.startsWith("**") && chunk.endsWith("**")) {
      const inner = chunk.slice(2, -2);
      const looksNumeric = /\d/.test(inner);
      nodes.push(
        <strong
          key={key}
          className={
            looksNumeric
              ? "font-medium tabular-nums text-emerald-400"
              : accent
                ? "font-semibold text-white"
                : "font-semibold text-zinc-950"
          }
        >
          {looksNumeric && accent
            ? highlightNumbers(inner, `${key}-n`)
            : renderIconSegments(inner, `${key}-i`)}
        </strong>
      );
      return;
    }

    nodes.push(
      <span key={key} className={accent ? "text-zinc-300" : undefined}>
        {accent
          ? highlightNumbersWithIcons(chunk, `${key}-n`)
          : renderIconSegments(chunk, `${key}-i`)}
      </span>
    );
  });

  return nodes;
}

function renderIconSegments(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const parts = text.split(/(\[icon:[a-zA-Z0-9_-]+\])/gi);
  parts.forEach((part, index) => {
    if (!part) return;
    const iconMatch = part.match(/^\[icon:([a-zA-Z0-9_-]+)\]$/i);
    if (iconMatch) {
      nodes.push(<AgentIcon key={`${keyPrefix}-${index}`} name={iconMatch[1]} />);
      return;
    }
    nodes.push(part);
  });
  return nodes;
}

function highlightNumbers(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  const re = new RegExp(NUMBER_CHUNK_RE.source, "gi");

  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(
        ...renderIconSegments(
          text.slice(lastIndex, match.index),
          `${keyPrefix}-pre-${match.index}`
        )
      );
    }
    const value = `${match[1] ?? ""}${match[2] ?? ""}`;
    nodes.push(
      <span
        key={`${keyPrefix}-${match.index}`}
        className="font-medium tabular-nums text-emerald-400"
      >
        {value}
      </span>
    );
    lastIndex = match.index + value.length;
  }

  if (lastIndex < text.length) {
    nodes.push(...renderIconSegments(text.slice(lastIndex), `${keyPrefix}-tail`));
  }
  return nodes.length > 0 ? nodes : [text];
}

function highlightNumbersWithIcons(text: string, keyPrefix: string): ReactNode[] {
  return highlightNumbers(text, keyPrefix);
}

type ParsedRow = {
  icon: IconName;
  label: string;
  value: string;
};

function parseRowLine(rawLine: string): ParsedRow | null {
  const line = rawLine.trim();
  const tagged = line.match(ROW_TAG_RE);
  if (tagged) {
    return {
      icon: resolveIconName(tagged[1]) ?? "MapPin",
      label: tagged[2]!.trim().replace(/^\*\*|\*\*$/g, ""),
      value: tagged[3]!.trim().replace(/^\*\*|\*\*$/g, ""),
    };
  }

  if (!/^[-*•]\s+/.test(line)) return null;

  const withoutBullet = line
    .replace(/^[-*•]\s+/, "")
    .replace(/^\[icon:([a-zA-Z0-9_-]+)\]\s*/i, "")
    .trim();

  const metric = withoutBullet.match(METRIC_TAIL_RE);
  if (!metric) return null;

  const iconFromTag = line.match(/^[-*•]?\s*\[icon:([a-zA-Z0-9_-]+)\]/i);
  return {
    icon: resolveIconName(iconFromTag?.[1]) ?? "MapPin",
    label: metric[1]!.trim().replace(/^\*\*|\*\*$/g, ""),
    value: `${metric[2]!.trim()} ${metric[3]!.trim()}`,
  };
}

function isCompactMetricValue(value: string): boolean {
  const v = value.trim();
  if (!v || v.length > 18) return false;
  return /^[\d\s.,]+(?:\s*(?:га|л|кг|т|шт|грн|%))?$/i.test(v);
}

function MetricRow({ row }: { row: ParsedRow }) {
  const Icon = IconMap[row.icon];
  const compact = isCompactMetricValue(row.value);

  // Довгий «value» (опис здібностей тощо) — НЕ в один ряд зі shrink-0,
  // інакше заголовок стискається в стовпчик по одній літері.
  if (row.value && !compact) {
    return (
      <div className="flex min-w-0 items-start gap-2.5 rounded-xl border border-white/[0.06] bg-white/[0.03] px-2.5 py-2">
        <Icon
          className="mt-0.5 size-3.5 shrink-0 text-emerald-400/90"
          strokeWidth={2.1}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-snug text-white">
            {row.label}
          </p>
          <p className="mt-0.5 text-sm leading-snug text-zinc-300">{row.value}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 items-center gap-2.5 rounded-xl border border-white/[0.06] bg-white/[0.03] px-2.5 py-2">
      <Icon
        className="size-3.5 shrink-0 text-emerald-400/90"
        strokeWidth={2.1}
        aria-hidden
      />
      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-white">
        {row.label}
      </span>
      {row.value ? (
        <span className="shrink-0 pl-2 text-sm font-medium tabular-nums text-emerald-400">
          {row.value}
        </span>
      ) : null}
    </div>
  );
}

/** Розбиває «**Заголовок** — опис» / «Заголовок — опис» для списків здібностей. */
function splitTitleDescription(text: string): {
  title: string;
  body: string;
} | null {
  const trimmed = text.trim();
  const bold = trimmed.match(/^\*\*(.+?)\*\*\s*[—–\-:]\s*([\s\S]+)$/);
  if (bold) {
    return { title: bold[1]!.trim(), body: bold[2]!.trim() };
  }
  const plain = trimmed.match(/^([^—–\n]{2,40}?)\s+[—–]\s*([\s\S]+)$/);
  if (plain && !/^\d/.test(plain[2]!.trim())) {
    return { title: plain[1]!.trim(), body: plain[2]!.trim() };
  }
  return null;
}

function ListIconRow({
  icon,
  children,
  title,
  body,
}: {
  icon: IconName;
  children?: ReactNode;
  title?: string;
  body?: string;
}) {
  const Icon = IconMap[icon];
  return (
    <div className="flex min-w-0 items-start gap-2.5 rounded-xl border border-white/[0.06] bg-white/[0.03] px-2.5 py-2">
      <Icon
        className="mt-0.5 size-3.5 shrink-0 text-emerald-400/90"
        strokeWidth={2.1}
        aria-hidden
      />
      <div className="min-w-0 flex-1 text-sm leading-snug">
        {title ? (
          <>
            <p className="font-semibold text-white">{title}</p>
            {body ? (
              <p className="mt-0.5 text-zinc-300">{body}</p>
            ) : null}
          </>
        ) : (
          <div className="text-zinc-300">{children}</div>
        )}
      </div>
    </div>
  );
}

function AgentMarkdown({
  text,
  accent,
}: {
  text: string;
  accent: boolean;
}) {
  const blocks = text.split(/\n{2,}/);

  return (
    <div className="min-w-0 max-w-full space-y-3 text-sm leading-relaxed text-zinc-300">
      {blocks.map((block, blockIndex) => {
        const lines = block.split("\n").filter((line) => line.trim().length > 0);
        const parsedRows = lines.map(parseRowLine);
        const isRowBlock =
          parsedRows.length > 0 && parsedRows.every((row) => row !== null);

        if (isRowBlock) {
          return (
            <div key={`block-${blockIndex}`} className="min-w-0 space-y-1.5">
              {parsedRows.map((row, rowIndex) =>
                row ? (
                  <MetricRow key={`row-${blockIndex}-${rowIndex}`} row={row} />
                ) : null
              )}
            </div>
          );
        }

        const isList = lines.every((line) => /^[-*•]\s+/.test(line.trim()));
        if (isList) {
          return (
            <div key={`block-${blockIndex}`} className="min-w-0 space-y-1.5">
              {lines.map((line, lineIndex) => {
                const row = parseRowLine(line);
                if (row) {
                  return (
                    <MetricRow key={`li-${blockIndex}-${lineIndex}`} row={row} />
                  );
                }
                const trimmed = line.replace(/^[-*•]\s+/, "");
                const iconMatch = trimmed.match(
                  /^\[icon:([a-zA-Z0-9_-]+)\]\s*/i
                );
                const iconName =
                  resolveIconName(iconMatch?.[1] ?? "") ?? "MapPin";
                const content = iconMatch
                  ? trimmed.slice(iconMatch[0].length)
                  : trimmed;
                const split = splitTitleDescription(content);
                if (split) {
                  return (
                    <ListIconRow
                      key={`li-${blockIndex}-${lineIndex}`}
                      icon={iconName}
                      title={split.title}
                      body={split.body}
                    />
                  );
                }
                return (
                  <ListIconRow
                    key={`li-${blockIndex}-${lineIndex}`}
                    icon={iconName}
                  >
                    {renderInlineMarkdown(
                      content,
                      `li-${blockIndex}-${lineIndex}`,
                      accent
                    )}
                  </ListIconRow>
                );
              })}
            </div>
          );
        }

        return (
          <div
            key={`block-${blockIndex}`}
            className="min-w-0 space-y-1.5 text-sm leading-relaxed text-zinc-300"
          >
            {lines.map((line, lineIndex) => {
              const row = parseRowLine(line);
              if (row) {
                return (
                  <MetricRow
                    key={`p-row-${blockIndex}-${lineIndex}`}
                    row={row}
                  />
                );
              }
              const iconOnly = line.match(
                /^\s*\[icon:([a-zA-Z0-9_-]+)\]\s*(.+)$/i
              );
              if (iconOnly) {
                const iconName =
                  resolveIconName(iconOnly[1]) ?? "MapPin";
                const content = iconOnly[2]!.trim();
                const split = splitTitleDescription(content);
                if (split) {
                  return (
                    <ListIconRow
                      key={`p-icon-${blockIndex}-${lineIndex}`}
                      icon={iconName}
                      title={split.title}
                      body={split.body}
                    />
                  );
                }
                return (
                  <ListIconRow
                    key={`p-icon-${blockIndex}-${lineIndex}`}
                    icon={iconName}
                  >
                    {renderInlineMarkdown(
                      content,
                      `p-icon-${blockIndex}-${lineIndex}`,
                      accent
                    )}
                  </ListIconRow>
                );
              }
              return (
                <p
                  key={`p-${blockIndex}-${lineIndex}`}
                  className="min-w-0 text-sm leading-relaxed text-zinc-300"
                >
                  {renderInlineMarkdown(
                    line,
                    `p-${blockIndex}-${lineIndex}`,
                    accent
                  )}
                </p>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

type WorkOrderDraft = {
  status: "ready" | "ready_for_approval" | "draft_ready";
  draftId: string;
  fieldId: string;
  fieldKey: string;
  fieldName: string;
  areaHa: number;
  crop: string;
  operationType: string;
  date: string;
  timeStart: string;
  timeLabel: string;
  equipmentId: string | null;
  equipmentName: string;
  equipmentFound: boolean;
  implementId: string | null;
  implementName: string;
  implementWidthM: number | null;
  hitchLabel: string | null;
  implementAutoPicked: boolean;
  driverName: string;
  isNewDriver: boolean;
  warehouseItemId: string | null;
  warehouseItemName: string | null;
  warehouseItemUnit: string | null;
  warehouseItemCategory: string | null;
  isNewWarehouseItem: boolean;
  materialQty: number | null;
  ratePerHa: number | null;
  calculatedFuel: number;
  calculatedSalary: number;
  agronomistComment?: string | null;
  source?: string | null;
};

function normalizeWorkOrderOutput(value: unknown): WorkOrderDraft | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;

  // New shape: { status: 'ready', draftId, formData }
  if (raw.status === "ready" && raw.formData && typeof raw.formData === "object") {
    const form = raw.formData as Record<string, unknown>;
    const timeRange =
      form.timeRange && typeof form.timeRange === "object"
        ? (form.timeRange as { start?: string; end?: string })
        : { start: "08:00", end: "18:00" };
    if (
      typeof raw.draftId !== "string" ||
      typeof form.fieldId !== "string" ||
      typeof form.fieldKey !== "string" ||
      typeof form.fieldName !== "string" ||
      typeof form.operationType !== "string" ||
      typeof form.date !== "string" ||
      typeof form.equipmentName !== "string" ||
      typeof form.driverName !== "string"
    ) {
      return null;
    }
    const timeStart = timeRange.start?.trim() || "08:00";
    const timeEnd = timeRange.end?.trim() || "18:00";
    return {
      status: "ready",
      draftId: typeof raw.workOrderId === "string" ? raw.workOrderId : raw.draftId,
      fieldId: form.fieldId,
      fieldKey: form.fieldKey,
      fieldName: form.fieldName,
      areaHa: Number(form.areaHa) || 0,
      crop: String(form.crop ?? "—"),
      operationType: form.operationType,
      date: form.date,
      timeStart,
      timeLabel: `${timeStart} – ${timeEnd}`,
      equipmentId:
        typeof form.equipmentId === "string" ? form.equipmentId : null,
      equipmentName: form.equipmentName,
      equipmentFound: Boolean(form.equipmentFound),
      implementId:
        typeof form.implementId === "string" ? form.implementId : null,
      implementName: String(form.implementName ?? ""),
      implementWidthM:
        typeof form.implementWidthM === "number" ? form.implementWidthM : null,
      hitchLabel:
        typeof form.hitchLabel === "string" && form.hitchLabel.trim()
          ? form.hitchLabel.trim()
          : null,
      implementAutoPicked: Boolean(form.implementAutoPicked),
      driverName: form.driverName,
      isNewDriver: Boolean(form.isNewDriver),
      warehouseItemId:
        typeof form.warehouseItemId === "string" ? form.warehouseItemId : null,
      warehouseItemName:
        typeof form.warehouseItemName === "string"
          ? form.warehouseItemName
          : null,
      warehouseItemUnit:
        typeof form.warehouseItemUnit === "string"
          ? form.warehouseItemUnit
          : null,
      warehouseItemCategory:
        typeof form.warehouseItemCategory === "string"
          ? form.warehouseItemCategory
          : null,
      isNewWarehouseItem: Boolean(form.isNewWarehouseItem),
      materialQty:
        typeof form.materialQty === "number" ? form.materialQty : null,
      ratePerHa: typeof form.ratePerHa === "number" ? form.ratePerHa : null,
      calculatedFuel: Number(form.calculatedFuel) || 0,
      calculatedSalary: Number(form.calculatedSalary) || 0,
      agronomistComment:
        typeof form.agronomistComment === "string"
          ? form.agronomistComment
          : null,
      source: typeof form.source === "string" ? form.source : null,
    };
  }

  // Legacy shapes
  if (
    (raw.status === "ready_for_approval" || raw.status === "draft_ready") &&
    typeof raw.draftId === "string" &&
    typeof raw.fieldId === "string" &&
    typeof raw.fieldKey === "string" &&
    typeof raw.fieldName === "string" &&
    typeof raw.operationType === "string" &&
    typeof raw.date === "string" &&
    typeof raw.equipmentName === "string" &&
    typeof raw.driverName === "string"
  ) {
    return {
      status: raw.status,
      draftId: raw.draftId,
      fieldId: raw.fieldId,
      fieldKey: raw.fieldKey,
      fieldName: raw.fieldName,
      areaHa: Number(raw.areaHa) || 0,
      crop: String(raw.crop ?? "—"),
      operationType: raw.operationType,
      date: raw.date,
      timeStart: "08:00",
      timeLabel: "08:00 – 18:00",
      equipmentId:
        typeof raw.equipmentId === "string" ? raw.equipmentId : null,
      equipmentName: raw.equipmentName,
      equipmentFound: Boolean(raw.equipmentFound),
      implementId: null,
      implementName: String(raw.implement ?? ""),
      implementWidthM: null,
      hitchLabel: null,
      implementAutoPicked: false,
      driverName: raw.driverName,
      isNewDriver: false,
      warehouseItemId: null,
      warehouseItemName: null,
      warehouseItemUnit: null,
      warehouseItemCategory: null,
      isNewWarehouseItem: false,
      materialQty: null,
      ratePerHa: typeof raw.ratePerHa === "number" ? raw.ratePerHa : null,
      calculatedFuel: Number(raw.fuelPlanL) || 0,
      calculatedSalary: Number(raw.wagePlanUah) || 0,
    };
  }

  return null;
}

function extractWorkOrderDrafts(message: UIMessage): WorkOrderDraft[] {
  const drafts: WorkOrderDraft[] = [];
  for (const part of message.parts) {
    const isPrepare =
      part.type === "tool-prepareWorkOrder" ||
      part.type === "tool-createWorkOrderFromGpsVisit" ||
      (part.type === "dynamic-tool" &&
        "toolName" in part &&
        (part.toolName === "prepareWorkOrder" ||
          part.toolName === "createWorkOrderFromGpsVisit"));
    if (!isPrepare) continue;
    if (!("state" in part) || part.state !== "output-available") continue;
    if (!("output" in part)) continue;
    const draft = normalizeWorkOrderOutput(part.output);
    if (draft) drafts.push(draft);
  }
  return drafts;
}

type DeleteWorkOrderConfirmation = {
  status: "requires_confirmation";
  workOrderId: string;
  clientKey: string;
  fieldName: string;
  operationType: string;
  date: string;
  machinery: string;
  statusLabel: string;
  confirmChoice: string;
  cancelChoice: string;
};

function normalizeDeleteConfirmation(
  value: unknown
): DeleteWorkOrderConfirmation | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (raw.status !== "requires_confirmation") return null;
  if (
    typeof raw.workOrderId !== "string" ||
    typeof raw.fieldName !== "string" ||
    typeof raw.operationType !== "string" ||
    typeof raw.date !== "string"
  ) {
    return null;
  }
  return {
    status: "requires_confirmation",
    workOrderId: raw.workOrderId,
    clientKey:
      typeof raw.clientKey === "string" ? raw.clientKey : raw.workOrderId,
    fieldName: raw.fieldName,
    operationType: raw.operationType,
    date: raw.date,
    machinery:
      typeof raw.machinery === "string" ? raw.machinery : "—",
    statusLabel:
      typeof raw.statusLabel === "string" ? raw.statusLabel : "",
    confirmChoice:
      typeof raw.confirmChoice === "string"
        ? raw.confirmChoice
        : "Так, видалити наряд назавжди",
    cancelChoice:
      typeof raw.cancelChoice === "string"
        ? raw.cancelChoice
        : "Ні, залишити як є",
  };
}

function extractDeleteConfirmations(
  message: UIMessage
): DeleteWorkOrderConfirmation[] {
  const items: DeleteWorkOrderConfirmation[] = [];
  for (const part of message.parts) {
    const isDelete =
      part.type === "tool-deleteWorkOrder" ||
      (part.type === "dynamic-tool" &&
        "toolName" in part &&
        part.toolName === "deleteWorkOrder");
    if (!isDelete) continue;
    if (!("state" in part) || part.state !== "output-available") continue;
    if (!("output" in part)) continue;
    const item = normalizeDeleteConfirmation(part.output);
    if (item) items.push(item);
  }
  return items;
}

type FieldUpdateConfirmation = {
  status: "requires_confirmation";
  fieldId: string;
  fieldName: string;
  userHint: string;
  warning: string;
  confirmChoice: string;
  cancelChoice: string;
  pending: {
    newName: string | null;
    newCulture: string | null;
    newArea: number | null;
    notes: string | null;
  };
  changes: {
    name: { from: string; to: string } | null;
    area: { from: number; to: number } | null;
    culture: { from: string | null; to: string } | null;
  };
};

function normalizeFieldUpdateConfirmation(
  value: unknown
): FieldUpdateConfirmation | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (raw.status !== "requires_confirmation") return null;
  if (typeof raw.fieldId !== "string" || typeof raw.fieldName !== "string") {
    return null;
  }
  const pendingRaw =
    raw.pending && typeof raw.pending === "object"
      ? (raw.pending as Record<string, unknown>)
      : {};
  const changesRaw =
    raw.changes && typeof raw.changes === "object"
      ? (raw.changes as Record<string, unknown>)
      : {};

  function pairString(
    value: unknown
  ): { from: string; to: string } | null {
    if (!value || typeof value !== "object") return null;
    const row = value as Record<string, unknown>;
    if (typeof row.to !== "string") return null;
    return {
      from: typeof row.from === "string" ? row.from : "—",
      to: row.to,
    };
  }

  function pairNumber(
    value: unknown
  ): { from: number; to: number } | null {
    if (!value || typeof value !== "object") return null;
    const row = value as Record<string, unknown>;
    const from = Number(row.from);
    const to = Number(row.to);
    if (!Number.isFinite(to)) return null;
    return {
      from: Number.isFinite(from) ? from : 0,
      to,
    };
  }

  function pairCulture(
    value: unknown
  ): { from: string | null; to: string } | null {
    if (!value || typeof value !== "object") return null;
    const row = value as Record<string, unknown>;
    if (typeof row.to !== "string") return null;
    return {
      from: typeof row.from === "string" ? row.from : null,
      to: row.to,
    };
  }

  return {
    status: "requires_confirmation",
    fieldId: raw.fieldId,
    fieldName: raw.fieldName,
    userHint:
      typeof raw.userHint === "string"
        ? raw.userHint
        : `Поле ${raw.fieldName}: підтверди зміну`,
    warning:
      typeof raw.warning === "string"
        ? raw.warning
        : "Зміна площі або культури вплине на розрахунки норм.",
    confirmChoice:
      typeof raw.confirmChoice === "string"
        ? raw.confirmChoice
        : "Так, підтверджую зміну",
    cancelChoice:
      typeof raw.cancelChoice === "string"
        ? raw.cancelChoice
        : "Скасувати зміну",
    pending: {
      newName:
        typeof pendingRaw.newName === "string" ? pendingRaw.newName : null,
      newCulture:
        typeof pendingRaw.newCulture === "string"
          ? pendingRaw.newCulture
          : null,
      newArea:
        typeof pendingRaw.newArea === "number" &&
        Number.isFinite(pendingRaw.newArea)
          ? pendingRaw.newArea
          : null,
      notes: typeof pendingRaw.notes === "string" ? pendingRaw.notes : null,
    },
    changes: {
      name: pairString(changesRaw.name),
      area: pairNumber(changesRaw.area),
      culture: pairCulture(changesRaw.culture),
    },
  };
}

function extractFieldUpdateConfirmations(
  message: UIMessage
): FieldUpdateConfirmation[] {
  const items: FieldUpdateConfirmation[] = [];
  for (const part of message.parts) {
    const isUpdate =
      part.type === "tool-updateFieldDetails" ||
      (part.type === "dynamic-tool" &&
        "toolName" in part &&
        part.toolName === "updateFieldDetails");
    if (!isUpdate) continue;
    if (!("state" in part) || part.state !== "output-available") continue;
    if (!("output" in part)) continue;
    const item = normalizeFieldUpdateConfirmation(part.output);
    if (item) items.push(item);
  }
  return items;
}

type ReceiptRollbackItemUi = {
  itemName: string;
  quantity: number;
  unit: string;
  shortage: boolean;
  stockAfterRollback: number;
};

type ReceiptRollbackConfirmation = {
  status: "requires_confirmation";
  receiptId: string;
  invoiceNumber: string | null;
  supplier: string;
  invoiceDate: string | null;
  items: ReceiptRollbackItemUi[];
  itemsSummary: string;
  shortageWarnings: string[];
  warning: string;
  userHint: string;
  confirmChoice: string;
  cancelChoice: string;
};

function normalizeReceiptRollbackConfirmation(
  value: unknown
): ReceiptRollbackConfirmation | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (raw.status !== "requires_confirmation") return null;
  if (typeof raw.receiptId !== "string") return null;

  const items: ReceiptRollbackItemUi[] = [];
  if (Array.isArray(raw.items)) {
    for (const row of raw.items) {
      if (!row || typeof row !== "object") continue;
      const line = row as Record<string, unknown>;
      if (typeof line.itemName !== "string") continue;
      items.push({
        itemName: line.itemName,
        quantity: Number(line.quantity) || 0,
        unit: typeof line.unit === "string" ? line.unit : "од.",
        shortage: line.shortage === true,
        stockAfterRollback: Number(line.stockAfterRollback) || 0,
      });
    }
  }

  return {
    status: "requires_confirmation",
    receiptId: raw.receiptId,
    invoiceNumber:
      typeof raw.invoiceNumber === "string" ? raw.invoiceNumber : null,
    supplier:
      typeof raw.supplier === "string" ? raw.supplier : "Постачальник",
    invoiceDate:
      typeof raw.invoiceDate === "string" ? raw.invoiceDate : null,
    items,
    itemsSummary:
      typeof raw.itemsSummary === "string"
        ? raw.itemsSummary
        : items
            .map((line) => `${line.itemName} — ${line.quantity} ${line.unit}`)
            .join("; "),
    shortageWarnings: Array.isArray(raw.shortageWarnings)
      ? raw.shortageWarnings.filter(
          (w): w is string => typeof w === "string"
        )
      : [],
    warning:
      typeof raw.warning === "string"
        ? raw.warning
        : "Анулювання зменшить залишок складу.",
    userHint:
      typeof raw.userHint === "string"
        ? raw.userHint
        : `Скасувати накладну${
            typeof raw.invoiceNumber === "string"
              ? ` №${raw.invoiceNumber}`
              : ""
          }?`,
    confirmChoice:
      typeof raw.confirmChoice === "string"
        ? raw.confirmChoice
        : "Так, анулювати накладну та списати залишки",
    cancelChoice:
      typeof raw.cancelChoice === "string"
        ? raw.cancelChoice
        : "Залишити накладну",
  };
}

function extractReceiptRollbackConfirmations(
  message: UIMessage
): ReceiptRollbackConfirmation[] {
  const items: ReceiptRollbackConfirmation[] = [];
  for (const part of message.parts) {
    const isRollback =
      part.type === "tool-rollbackWarehouseReceipt" ||
      (part.type === "dynamic-tool" &&
        "toolName" in part &&
        part.toolName === "rollbackWarehouseReceipt");
    if (!isRollback) continue;
    if (!("state" in part) || part.state !== "output-available") continue;
    if (!("output" in part)) continue;
    const item = normalizeReceiptRollbackConfirmation(part.output);
    if (item) items.push(item);
  }
  return items;
}

function messageHasRolledBackReceipt(message: UIMessage): boolean {
  for (const part of message.parts) {
    const isRollback =
      part.type === "tool-rollbackWarehouseReceipt" ||
      (part.type === "dynamic-tool" &&
        "toolName" in part &&
        part.toolName === "rollbackWarehouseReceipt");
    if (!isRollback) continue;
    if (!("state" in part) || part.state !== "output-available") continue;
    if (!("output" in part) || !part.output || typeof part.output !== "object") {
      continue;
    }
    const raw = part.output as { success?: boolean; status?: string };
    if (raw.success === true && raw.status === "rolled_back") return true;
  }
  return false;
}

type ServiceActDeleteLine = {
  id: string;
  actNumber: string | null;
  contractorName: string;
  totalAmount: number;
  actDate: string | null;
};

type ServiceActDeleteConfirmation = {
  status: "requires_confirmation";
  actIds: string[];
  acts: ServiceActDeleteLine[];
  userHint: string;
  warning: string;
  confirmChoice: string;
  cancelChoice: string;
};

function normalizeServiceActDeleteConfirmation(
  value: unknown
): ServiceActDeleteConfirmation | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (raw.status !== "requires_confirmation") return null;
  if (!Array.isArray(raw.acts) || raw.acts.length === 0) return null;

  const acts: ServiceActDeleteLine[] = [];
  for (const row of raw.acts) {
    if (!row || typeof row !== "object") continue;
    const item = row as Record<string, unknown>;
    if (typeof item.id !== "string" || !item.id.trim()) continue;
    acts.push({
      id: item.id,
      actNumber:
        typeof item.actNumber === "string" && item.actNumber.trim()
          ? item.actNumber.trim()
          : null,
      contractorName:
        typeof item.contractorName === "string" && item.contractorName.trim()
          ? item.contractorName.trim()
          : "Виконавець",
      totalAmount:
        item.totalAmount != null && Number.isFinite(Number(item.totalAmount))
          ? Number(item.totalAmount)
          : 0,
      actDate:
        typeof item.actDate === "string" && item.actDate
          ? item.actDate.slice(0, 10)
          : null,
    });
  }
  if (acts.length === 0) return null;

  const actIds = Array.isArray(raw.actIds)
    ? raw.actIds.filter((id): id is string => typeof id === "string" && Boolean(id.trim()))
    : acts.map((a) => a.id);

  return {
    status: "requires_confirmation",
    actIds: actIds.length > 0 ? actIds : acts.map((a) => a.id),
    acts,
    userHint:
      typeof raw.userHint === "string" && raw.userHint.trim()
        ? raw.userHint.trim()
        : "Видалити наступні акти з Бухгалтерії?",
    warning:
      typeof raw.warning === "string" && raw.warning.trim()
        ? raw.warning.trim()
        : "Видалення безповоротне.",
    confirmChoice:
      typeof raw.confirmChoice === "string" && raw.confirmChoice.trim()
        ? raw.confirmChoice.trim()
        : "Так, видалити ці акти",
    cancelChoice:
      typeof raw.cancelChoice === "string" && raw.cancelChoice.trim()
        ? raw.cancelChoice.trim()
        : "Скасувати",
  };
}

function extractServiceActDeleteConfirmations(
  message: UIMessage
): ServiceActDeleteConfirmation[] {
  const items: ServiceActDeleteConfirmation[] = [];
  for (const part of message.parts) {
    const isDelete =
      part.type === "tool-deleteServiceActs" ||
      (part.type === "dynamic-tool" &&
        "toolName" in part &&
        part.toolName === "deleteServiceActs");
    if (!isDelete) continue;
    if (!("state" in part) || part.state !== "output-available") continue;
    if (!("output" in part)) continue;
    const item = normalizeServiceActDeleteConfirmation(part.output);
    if (item) items.push(item);
  }
  return items;
}

function messageHasDeletedServiceActs(message: UIMessage): boolean {
  for (const part of message.parts) {
    const isDelete =
      part.type === "tool-deleteServiceActs" ||
      (part.type === "dynamic-tool" &&
        "toolName" in part &&
        part.toolName === "deleteServiceActs");
    if (!isDelete) continue;
    if (!("state" in part) || part.state !== "output-available") continue;
    if (!("output" in part) || !part.output || typeof part.output !== "object") {
      continue;
    }
    const raw = part.output as { success?: boolean; status?: string };
    if (raw.success === true && raw.status === "deleted") return true;
  }
  return false;
}

function messageHasUpdatedField(message: UIMessage): boolean {
  return extractUpdatedFieldPayload(message) != null;
}

function extractUpdatedFieldPayload(
  message: UIMessage
): { id: string; name: string; area: number; crop: string | null } | null {
  for (const part of message.parts) {
    const isUpdate =
      part.type === "tool-updateFieldDetails" ||
      (part.type === "dynamic-tool" &&
        "toolName" in part &&
        part.toolName === "updateFieldDetails");
    if (!isUpdate) continue;
    if (!("state" in part) || part.state !== "output-available") continue;
    if (!("output" in part) || !part.output || typeof part.output !== "object") {
      continue;
    }
    const raw = part.output as Record<string, unknown>;
    if (raw.status !== "updated" && raw.success !== true) continue;
    const field =
      raw.updatedField && typeof raw.updatedField === "object"
        ? (raw.updatedField as Record<string, unknown>)
        : null;
    if (!field || typeof field.id !== "string") continue;
    return {
      id: field.id,
      name: typeof field.name === "string" ? field.name : "",
      area: Number(field.area) || 0,
      crop: typeof field.crop === "string" ? field.crop : null,
    };
  }
  return null;
}

function extractWriteOffPayload(message: UIMessage): {
  fieldId: string | null;
  itemId: string;
  itemName: string;
  quantity: number;
  unit: string;
  newStockBalance: number;
} | null {
  for (const part of message.parts) {
    const isWriteOff =
      part.type === "tool-writeOffInventoryToField" ||
      (part.type === "dynamic-tool" &&
        "toolName" in part &&
        part.toolName === "writeOffInventoryToField");
    if (!isWriteOff) continue;
    if (!("state" in part) || part.state !== "output-available") continue;
    if (!("output" in part) || !part.output || typeof part.output !== "object") {
      continue;
    }
    const raw = part.output as Record<string, unknown>;
    if (raw.success !== true && raw.status !== "written_off") continue;
    if (typeof raw.itemId !== "string") continue;
    return {
      fieldId: typeof raw.fieldId === "string" ? raw.fieldId : null,
      itemId: raw.itemId,
      itemName: typeof raw.itemName === "string" ? raw.itemName : "",
      quantity: Number(raw.quantity) || 0,
      unit: typeof raw.unit === "string" ? raw.unit : "",
      newStockBalance: Number(raw.newStockBalance) || 0,
    };
  }
  return null;
}

function extractInventoryPriceUpdatePayload(message: UIMessage): {
  itemId: string;
  itemName: string;
  newPrice: number;
  fieldsAffected: string[];
} | null {
  for (const part of message.parts) {
    const isPrice =
      part.type === "tool-updateInventoryItemPrice" ||
      (part.type === "dynamic-tool" &&
        "toolName" in part &&
        part.toolName === "updateInventoryItemPrice");
    if (!isPrice) continue;
    if (!("state" in part) || part.state !== "output-available") continue;
    if (!("output" in part) || !part.output || typeof part.output !== "object") {
      continue;
    }
    const raw = part.output as Record<string, unknown>;
    if (raw.success !== true && raw.status !== "updated") continue;
    if (typeof raw.itemId !== "string") continue;
    const fields = Array.isArray(raw.fieldsAffected)
      ? raw.fieldsAffected.filter((id): id is string => typeof id === "string")
      : [];
    return {
      itemId: raw.itemId,
      itemName: typeof raw.itemName === "string" ? raw.itemName : "",
      newPrice: Number(raw.newPrice) || 0,
      fieldsAffected: fields,
    };
  }
  return null;
}

function extractFuelRefuelPayload(message: UIMessage): {
  transactionId: string | null;
  equipmentId: string;
  equipmentName: string;
  storageId: string;
  storageName: string;
  liters: number;
  volumeAfter: number;
} | null {
  for (const part of message.parts) {
    const isRefuel =
      part.type === "tool-logFuelRefueling" ||
      (part.type === "dynamic-tool" &&
        "toolName" in part &&
        part.toolName === "logFuelRefueling");
    if (!isRefuel) continue;
    if (!("state" in part) || part.state !== "output-available") continue;
    if (!("output" in part) || !part.output || typeof part.output !== "object") {
      continue;
    }
    const raw = part.output as Record<string, unknown>;
    if (raw.success !== true && raw.status !== "refueled") continue;
    if (typeof raw.equipmentId !== "string" || typeof raw.storageId !== "string") {
      continue;
    }
    return {
      transactionId:
        typeof raw.transactionId === "string" ? raw.transactionId : null,
      equipmentId: raw.equipmentId,
      equipmentName:
        typeof raw.equipmentName === "string" ? raw.equipmentName : "",
      storageId: raw.storageId,
      storageName: typeof raw.storageName === "string" ? raw.storageName : "",
      liters: Number(raw.liters) || 0,
      volumeAfter: Number(raw.volumeAfter) || 0,
    };
  }
  return null;
}

type FuelRefuelPreview = {
  status: "requires_confirmation";
  equipmentId: string;
  equipmentName: string;
  storageId: string;
  storageName: string;
  liters: number;
  driverName: string | null;
  volumeBefore: number;
  volumeAfter: number;
  pricePerLiter: number | null;
  totalCost: number | null;
  canConfirm: boolean;
  confirmChoice: string;
  cancelChoice: string;
  badge: string;
};

function normalizeFuelRefuelPreview(value: unknown): FuelRefuelPreview | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (raw.status !== "requires_confirmation") return null;
  if (
    typeof raw.equipmentId !== "string" ||
    typeof raw.equipmentName !== "string" ||
    typeof raw.storageId !== "string" ||
    typeof raw.storageName !== "string"
  ) {
    return null;
  }
  if (typeof raw.liters !== "number" || !Number.isFinite(raw.liters)) {
    return null;
  }
  return {
    status: "requires_confirmation",
    equipmentId: raw.equipmentId,
    equipmentName: raw.equipmentName,
    storageId: raw.storageId,
    storageName: raw.storageName,
    liters: raw.liters,
    driverName: typeof raw.driverName === "string" ? raw.driverName : null,
    volumeBefore: Number(raw.volumeBefore) || 0,
    volumeAfter: Number(raw.volumeAfter) || 0,
    pricePerLiter:
      typeof raw.pricePerLiter === "number" ? raw.pricePerLiter : null,
    totalCost: typeof raw.totalCost === "number" ? raw.totalCost : null,
    canConfirm: raw.canConfirm !== false,
    confirmChoice:
      typeof raw.confirmChoice === "string"
        ? raw.confirmChoice
        : "Підтвердити заправку",
    cancelChoice:
      typeof raw.cancelChoice === "string" ? raw.cancelChoice : "Скасувати",
    badge: typeof raw.badge === "string" ? raw.badge : "Заправка техніки",
  };
}

function extractFuelRefuelPreviews(message: UIMessage): FuelRefuelPreview[] {
  const items: FuelRefuelPreview[] = [];
  for (const part of message.parts) {
    const isRefuel =
      part.type === "tool-logFuelRefueling" ||
      (part.type === "dynamic-tool" &&
        "toolName" in part &&
        part.toolName === "logFuelRefueling");
    if (!isRefuel) continue;
    if (!("state" in part) || part.state !== "output-available") continue;
    if (!("output" in part)) continue;
    const item = normalizeFuelRefuelPreview(part.output);
    if (item) items.push(item);
  }
  return items;
}

function FuelRefuelCard({
  item,
  onReply,
  disabled,
  alreadyRefueled,
}: {
  item: FuelRefuelPreview;
  onReply?: (text: string) => void;
  disabled?: boolean;
  alreadyRefueled?: boolean;
}) {
  const [resolved, setResolved] = useState<"confirm" | "cancel" | null>(
    alreadyRefueled ? "confirm" : null
  );

  function choose(kind: "confirm" | "cancel") {
    if (disabled || resolved) return;
    if (kind === "confirm" && !item.canConfirm) return;
    setResolved(kind);
    onReply?.(kind === "confirm" ? item.confirmChoice : item.cancelChoice);
  }

  const done = alreadyRefueled || resolved === "confirm";

  return (
    <div className="overflow-hidden rounded-2xl border border-amber-400/30 bg-gradient-to-br from-amber-500/10 via-zinc-950/85 to-zinc-950/95 shadow-[0_0_0_1px_rgba(245,158,11,0.12)]">
      <div className="flex items-center gap-2.5 border-b border-amber-500/15 px-3.5 py-3">
        <div className="inline-flex size-8 items-center justify-center rounded-xl bg-amber-500/15 ring-1 ring-amber-400/25">
          <Fuel className="size-4 text-amber-300" strokeWidth={2.1} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold tracking-tight text-white">
            {item.equipmentName}
          </p>
          <p className="text-[11px] text-zinc-500">
            з «{item.storageName}»
            {item.driverName ? ` · ${item.driverName}` : ""}
          </p>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-md border px-2 py-0.5 text-[10px] font-bold tracking-wide uppercase",
            done
              ? "border-emerald-400/40 bg-emerald-500/15 text-emerald-300"
              : "border-amber-400/40 bg-amber-500/15 text-amber-200"
          )}
        >
          {done ? "Заправлено" : item.badge}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 px-3.5 py-3">
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] px-2.5 py-2">
          <p className="text-[10px] tracking-wide text-zinc-500 uppercase">
            Літри
          </p>
          <p className="mt-0.5 text-sm font-semibold tabular-nums text-amber-300">
            {item.liters} л
          </p>
        </div>
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] px-2.5 py-2">
          <p className="text-[10px] tracking-wide text-zinc-500 uppercase">
            Залишок ємності
          </p>
          <p className="mt-0.5 text-sm font-semibold tabular-nums text-white">
            {item.volumeBefore} → {item.volumeAfter} л
          </p>
        </div>
        {item.totalCost != null ? (
          <div className="col-span-2 rounded-xl border border-white/[0.06] bg-white/[0.03] px-2.5 py-2">
            <p className="text-[10px] tracking-wide text-zinc-500 uppercase">
              Вартість
            </p>
            <p className="mt-0.5 text-sm font-medium tabular-nums text-emerald-400">
              {item.totalCost} ₴
              {item.pricePerLiter != null
                ? ` · ${item.pricePerLiter} ₴/л`
                : ""}
            </p>
          </div>
        ) : null}
      </div>

      <div className="border-t border-amber-500/15 px-3.5 py-3">
        {done ? (
          <div className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-400/30 bg-emerald-500/15 px-3 py-2.5 text-xs font-semibold text-emerald-300">
            <CheckCircle2 className="size-3.5" strokeWidth={2.2} />
            Заправку зафіксовано
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={disabled || resolved === "cancel"}
              onClick={() => choose("cancel")}
              className="inline-flex items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-xs font-semibold text-zinc-300 transition hover:bg-white/[0.07] disabled:opacity-50"
            >
              {item.cancelChoice}
            </button>
            <button
              type="button"
              disabled={disabled || !item.canConfirm}
              onClick={() => choose("confirm")}
              className="inline-flex items-center justify-center rounded-xl border border-amber-300/40 bg-gradient-to-r from-amber-500 to-amber-400 px-3 py-2.5 text-xs font-semibold text-zinc-950 transition hover:from-amber-400 hover:to-amber-300 disabled:opacity-50"
            >
              {item.confirmChoice}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

type MaintenanceCompletedPreview = {
  status: "requires_confirmation";
  equipmentId: string;
  equipmentName: string;
  serviceType: string;
  serviceIntervalHours: number;
  currentHours: number;
  nextServiceHours: number;
  canConfirm: boolean;
  confirmChoice: string;
  cancelChoice: string;
  badge: string;
};

function normalizeMaintenanceCompletedPreview(
  value: unknown
): MaintenanceCompletedPreview | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (raw.status !== "requires_confirmation") return null;
  if (
    typeof raw.equipmentId !== "string" ||
    typeof raw.equipmentName !== "string" ||
    typeof raw.serviceType !== "string"
  ) {
    return null;
  }
  return {
    status: "requires_confirmation",
    equipmentId: raw.equipmentId,
    equipmentName: raw.equipmentName,
    serviceType: raw.serviceType,
    serviceIntervalHours: Number(raw.serviceIntervalHours) || 250,
    currentHours: Number(raw.currentHours) || 0,
    nextServiceHours: Number(raw.nextServiceHours) || 0,
    canConfirm: raw.canConfirm !== false,
    confirmChoice:
      typeof raw.confirmChoice === "string"
        ? raw.confirmChoice
        : "Підтвердити ТО",
    cancelChoice:
      typeof raw.cancelChoice === "string" ? raw.cancelChoice : "Скасувати",
    badge: typeof raw.badge === "string" ? raw.badge : "Фіксація ТО",
  };
}

function extractMaintenanceCompletedPreviews(
  message: UIMessage
): MaintenanceCompletedPreview[] {
  const items: MaintenanceCompletedPreview[] = [];
  for (const part of message.parts) {
    const isMaint =
      part.type === "tool-logMaintenanceCompleted" ||
      (part.type === "dynamic-tool" &&
        "toolName" in part &&
        part.toolName === "logMaintenanceCompleted");
    if (!isMaint) continue;
    if (!("state" in part) || part.state !== "output-available") continue;
    if (!("output" in part)) continue;
    const item = normalizeMaintenanceCompletedPreview(part.output);
    if (item) items.push(item);
  }
  return items;
}

function extractMaintenanceCompletedPayload(message: UIMessage): {
  equipmentId: string;
  equipmentName: string;
  serviceType: string;
  nextServiceHours: number;
} | null {
  for (const part of message.parts) {
    const isMaint =
      part.type === "tool-logMaintenanceCompleted" ||
      (part.type === "dynamic-tool" &&
        "toolName" in part &&
        part.toolName === "logMaintenanceCompleted");
    if (!isMaint) continue;
    if (!("state" in part) || part.state !== "output-available") continue;
    if (!("output" in part) || !part.output || typeof part.output !== "object") {
      continue;
    }
    const raw = part.output as Record<string, unknown>;
    if (raw.success !== true && raw.status !== "completed") continue;
    if (typeof raw.equipmentId !== "string") continue;
    return {
      equipmentId: raw.equipmentId,
      equipmentName:
        typeof raw.equipmentName === "string" ? raw.equipmentName : "",
      serviceType: typeof raw.serviceType === "string" ? raw.serviceType : "",
      nextServiceHours: Number(raw.nextServiceHours) || 0,
    };
  }
  return null;
}

function extractLinkedServiceActPayload(message: UIMessage): {
  actId: string;
  equipmentId: string;
  equipmentName: string;
  seasonRepairCostUah: number;
} | null {
  for (const part of message.parts) {
    const isLink =
      part.type === "tool-linkServiceActToEquipment" ||
      (part.type === "dynamic-tool" &&
        "toolName" in part &&
        part.toolName === "linkServiceActToEquipment");
    if (!isLink) continue;
    if (!("state" in part) || part.state !== "output-available") continue;
    if (!("output" in part) || !part.output || typeof part.output !== "object") {
      continue;
    }
    const raw = part.output as Record<string, unknown>;
    if (raw.success !== true && raw.status !== "linked") continue;
    if (typeof raw.actId !== "string" || typeof raw.equipmentId !== "string") {
      continue;
    }
    return {
      actId: raw.actId,
      equipmentId: raw.equipmentId,
      equipmentName:
        typeof raw.equipmentName === "string" ? raw.equipmentName : "",
      seasonRepairCostUah: Number(raw.seasonRepairCostUah) || 0,
    };
  }
  return null;
}

function MaintenanceCompletedCard({
  item,
  onReply,
  disabled,
  alreadyDone,
}: {
  item: MaintenanceCompletedPreview;
  onReply?: (text: string) => void;
  disabled?: boolean;
  alreadyDone?: boolean;
}) {
  const [resolved, setResolved] = useState<"confirm" | "cancel" | null>(
    alreadyDone ? "confirm" : null
  );

  function choose(kind: "confirm" | "cancel") {
    if (disabled || resolved) return;
    if (kind === "confirm" && !item.canConfirm) return;
    setResolved(kind);
    onReply?.(kind === "confirm" ? item.confirmChoice : item.cancelChoice);
  }

  const done = alreadyDone || resolved === "confirm";

  return (
    <div className="overflow-hidden rounded-2xl border border-sky-400/30 bg-gradient-to-br from-sky-500/10 via-zinc-950/85 to-zinc-950/95 shadow-[0_0_0_1px_rgba(56,189,248,0.12)]">
      <div className="flex items-center gap-2.5 border-b border-sky-500/15 px-3.5 py-3">
        <div className="inline-flex size-8 items-center justify-center rounded-xl bg-sky-500/15 ring-1 ring-sky-400/25">
          <Tractor className="size-4 text-sky-300" strokeWidth={2.1} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold tracking-tight text-white">
            {item.equipmentName}
          </p>
          <p className="text-[11px] text-zinc-500">{item.serviceType}</p>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-md border px-2 py-0.5 text-[10px] font-bold tracking-wide uppercase",
            done
              ? "border-emerald-400/40 bg-emerald-500/15 text-emerald-300"
              : "border-sky-400/40 bg-sky-500/15 text-sky-200"
          )}
        >
          {done ? "ТО зафіксовано" : item.badge}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 px-3.5 py-3">
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] px-2.5 py-2">
          <p className="text-[10px] tracking-wide text-zinc-500 uppercase">
            Зараз
          </p>
          <p className="mt-0.5 text-sm font-semibold tabular-nums text-white">
            {item.currentHours} м/г
          </p>
        </div>
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] px-2.5 py-2">
          <p className="text-[10px] tracking-wide text-zinc-500 uppercase">
            Наступне ТО
          </p>
          <p className="mt-0.5 text-sm font-semibold tabular-nums text-sky-300">
            {item.nextServiceHours} м/г
          </p>
          <p className="text-[10px] text-zinc-500">
            +{item.serviceIntervalHours} м/г
          </p>
        </div>
      </div>

      <div className="border-t border-sky-500/15 px-3.5 py-3">
        {done ? (
          <div className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-400/30 bg-emerald-500/15 px-3 py-2.5 text-xs font-semibold text-emerald-300">
            <CheckCircle2 className="size-3.5" strokeWidth={2.2} />
            Сервіс внесено
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={disabled || resolved === "cancel"}
              onClick={() => choose("cancel")}
              className="inline-flex items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-xs font-semibold text-zinc-300 transition hover:bg-white/[0.07] disabled:opacity-50"
            >
              {item.cancelChoice}
            </button>
            <button
              type="button"
              disabled={disabled || !item.canConfirm}
              onClick={() => choose("confirm")}
              className="inline-flex items-center justify-center rounded-xl border border-sky-300/40 bg-gradient-to-r from-sky-500 to-sky-400 px-3 py-2.5 text-xs font-semibold text-zinc-950 transition hover:from-sky-400 hover:to-sky-300 disabled:opacity-50"
            >
              {item.confirmChoice}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

type InventoryWriteOffPreview = {
  status: "requires_confirmation";
  fieldId: string | null;
  fieldName: string;
  itemId: string;
  itemName: string;
  category: string;
  quantity: number;
  unit: string;
  date: string;
  currentStock: number;
  projectedStock: number;
  exceedsStock: boolean;
  canConfirm: boolean;
  warning: string | null;
  confirmChoice: string;
  cancelChoice: string;
  badge: string;
};

function normalizeInventoryWriteOffPreview(
  value: unknown
): InventoryWriteOffPreview | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (raw.status !== "requires_confirmation") return null;
  if (typeof raw.itemId !== "string" || typeof raw.itemName !== "string") {
    return null;
  }
  if (typeof raw.quantity !== "number" || !Number.isFinite(raw.quantity)) {
    return null;
  }
  return {
    status: "requires_confirmation",
    fieldId: typeof raw.fieldId === "string" ? raw.fieldId : null,
    fieldName:
      typeof raw.fieldName === "string" ? raw.fieldName : "поле",
    itemId: raw.itemId,
    itemName: raw.itemName,
    category: typeof raw.category === "string" ? raw.category : "",
    quantity: raw.quantity,
    unit: typeof raw.unit === "string" ? raw.unit : "од.",
    date: typeof raw.date === "string" ? raw.date : "",
    currentStock: Number(raw.currentStock) || 0,
    projectedStock: Number(raw.projectedStock) || 0,
    exceedsStock: raw.exceedsStock === true,
    canConfirm: raw.canConfirm !== false && raw.exceedsStock !== true,
    warning: typeof raw.warning === "string" ? raw.warning : null,
    confirmChoice:
      typeof raw.confirmChoice === "string"
        ? raw.confirmChoice
        : "Підтвердити списання на поле",
    cancelChoice:
      typeof raw.cancelChoice === "string" ? raw.cancelChoice : "Скасувати",
    badge:
      typeof raw.badge === "string" ? raw.badge : "Списання ТМЦ на поле",
  };
}

function extractInventoryWriteOffPreviews(
  message: UIMessage
): InventoryWriteOffPreview[] {
  const items: InventoryWriteOffPreview[] = [];
  for (const part of message.parts) {
    const isWriteOff =
      part.type === "tool-writeOffInventoryToField" ||
      (part.type === "dynamic-tool" &&
        "toolName" in part &&
        part.toolName === "writeOffInventoryToField");
    if (!isWriteOff) continue;
    if (!("state" in part) || part.state !== "output-available") continue;
    if (!("output" in part)) continue;
    const item = normalizeInventoryWriteOffPreview(part.output);
    if (item) items.push(item);
  }
  return items;
}

function InventoryWriteOffCard({
  item,
  onReply,
  disabled,
  alreadyWrittenOff,
}: {
  item: InventoryWriteOffPreview;
  onReply?: (text: string) => void;
  disabled?: boolean;
  alreadyWrittenOff?: boolean;
}) {
  const [resolved, setResolved] = useState<"confirm" | "cancel" | null>(
    alreadyWrittenOff ? "confirm" : null
  );

  function choose(kind: "confirm" | "cancel") {
    if (disabled || resolved) return;
    if (kind === "confirm" && !item.canConfirm) return;
    setResolved(kind);
    onReply?.(kind === "confirm" ? item.confirmChoice : item.cancelChoice);
  }

  const done = alreadyWrittenOff || resolved === "confirm";

  return (
    <div className="overflow-hidden rounded-2xl border border-violet-400/30 bg-gradient-to-br from-violet-500/10 via-zinc-950/85 to-zinc-950/95 shadow-[0_0_0_1px_rgba(167,139,250,0.12)]">
      <div className="flex items-center gap-2.5 border-b border-violet-500/15 px-3.5 py-3">
        <div className="inline-flex size-8 items-center justify-center rounded-xl bg-violet-500/15 ring-1 ring-violet-400/25">
          <Warehouse className="size-4 text-violet-300" strokeWidth={2.1} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold tracking-tight text-white">
            {item.itemName}
          </p>
          <p className="text-[11px] text-zinc-500">
            → {item.fieldName}
            {item.date ? ` · ${item.date}` : ""}
          </p>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-md border px-2 py-0.5 text-[10px] font-bold tracking-wide uppercase",
            done
              ? "border-emerald-400/40 bg-emerald-500/15 text-emerald-300"
              : "border-violet-400/40 bg-violet-500/15 text-violet-200"
          )}
        >
          {done ? "Списано" : item.badge}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 px-3.5 py-3">
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] px-2.5 py-2">
          <p className="text-[10px] tracking-wide text-zinc-500 uppercase">
            Залишок зараз
          </p>
          <p className="mt-0.5 text-sm font-semibold tabular-nums text-white">
            {item.currentStock} {item.unit}
          </p>
        </div>
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] px-2.5 py-2">
          <p className="text-[10px] tracking-wide text-zinc-500 uppercase">
            Списати
          </p>
          <p className="mt-0.5 text-sm font-semibold tabular-nums text-violet-200">
            {item.quantity} {item.unit}
          </p>
        </div>
        <div className="col-span-2 rounded-xl border border-white/[0.06] bg-white/[0.03] px-2.5 py-2">
          <p className="text-[10px] tracking-wide text-zinc-500 uppercase">
            Залишок після
          </p>
          <p
            className={cn(
              "mt-0.5 text-sm font-semibold tabular-nums",
              item.exceedsStock ? "text-rose-300" : "text-emerald-300"
            )}
          >
            {item.projectedStock} {item.unit}
          </p>
        </div>
      </div>

      {item.exceedsStock || item.warning ? (
        <div className="border-t border-rose-500/20 px-3.5 py-2.5">
          <p className="flex items-start gap-1.5 text-xs leading-snug text-rose-200">
            <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
            <span>
              {item.warning ||
                "Списання перевищує залишок на складі — підтвердження недоступне."}
            </span>
          </p>
        </div>
      ) : null}

      {!done ? (
        <div className="flex flex-wrap gap-2 border-t border-white/10 px-3.5 py-3">
          <button
            type="button"
            disabled={disabled || resolved !== null || !item.canConfirm}
            onClick={() => choose("confirm")}
            className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-400/40 bg-emerald-500/20 px-3 py-1.5 text-xs font-semibold text-emerald-100 transition hover:bg-emerald-500/30 disabled:cursor-not-allowed disabled:opacity-45"
          >
            <Warehouse className="size-3.5" />
            Підтвердити списання на поле
          </button>
          <button
            type="button"
            disabled={disabled || resolved !== null}
            onClick={() => choose("cancel")}
            className="rounded-xl border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold text-zinc-300 disabled:opacity-50"
          >
            {resolved === "cancel" ? "Скасовано" : item.cancelChoice}
          </button>
        </div>
      ) : (
        <div className="border-t border-emerald-500/20 px-3.5 py-2.5">
          <p className="flex items-center gap-1.5 text-xs font-medium text-emerald-300">
            <CheckCircle2 className="size-3.5" />
            Списано на поле «{item.fieldName}»
          </p>
        </div>
      )}
    </div>
  );
}

function extractFocusFieldPayload(message: UIMessage): {
  fieldId: string;
  openFieldPath: string;
} | null {
  for (const part of message.parts) {
    const isFocus =
      part.type === "tool-focusFieldOnMap" ||
      (part.type === "dynamic-tool" &&
        "toolName" in part &&
        part.toolName === "focusFieldOnMap");
    if (!isFocus) continue;
    if (!("state" in part) || part.state !== "output-available") continue;
    if (!("output" in part) || !part.output || typeof part.output !== "object") {
      continue;
    }
    const raw = part.output as Record<string, unknown>;
    if (raw.success !== true && raw.status !== "focus") continue;
    if (typeof raw.fieldId !== "string" || !raw.fieldId) continue;
    return {
      fieldId: raw.fieldId,
      openFieldPath:
        typeof raw.openFieldPath === "string"
          ? raw.openFieldPath
          : `/?field=${raw.fieldId}`,
    };
  }
  return null;
}

function extractClosedWorkOrderPayload(message: UIMessage): {
  fieldId: string;
  workOrderId: string;
  factArea: number;
} | null {
  for (const part of message.parts) {
    const isClose =
      part.type === "tool-closeWorkOrder" ||
      (part.type === "dynamic-tool" &&
        "toolName" in part &&
        part.toolName === "closeWorkOrder");
    if (!isClose) continue;
    if (!("state" in part) || part.state !== "output-available") continue;
    if (!("output" in part) || !part.output || typeof part.output !== "object") {
      continue;
    }
    const raw = part.output as Record<string, unknown>;
    if (raw.success !== true && raw.status !== "closed") continue;
    if (typeof raw.fieldId !== "string" || !raw.fieldId) continue;
    return {
      fieldId: raw.fieldId,
      workOrderId:
        typeof raw.workOrderId === "string" ? raw.workOrderId : "",
      factArea: Number(raw.factArea) || 0,
    };
  }
  return null;
}

function extractBudgetUpdatePayload(message: UIMessage): {
  fieldId: string;
  plannedBudgetPerHa: number;
} | null {
  for (const part of message.parts) {
    const isBudget =
      part.type === "tool-updateFieldPlannedBudget" ||
      (part.type === "dynamic-tool" &&
        "toolName" in part &&
        part.toolName === "updateFieldPlannedBudget");
    if (!isBudget) continue;
    if (!("state" in part) || part.state !== "output-available") continue;
    if (!("output" in part) || !part.output || typeof part.output !== "object") {
      continue;
    }
    const raw = part.output as Record<string, unknown>;
    if (raw.success !== true && raw.status !== "updated") continue;
    if (typeof raw.fieldId !== "string" || !raw.fieldId) continue;
    return {
      fieldId: raw.fieldId,
      plannedBudgetPerHa: Number(raw.plannedBudgetPerHa) || 0,
    };
  }
  return null;
}

function extractGeofenceSyncPayload(message: UIMessage): {
  fieldId: string;
  wialonGeofenceId: string;
} | null {
  for (const part of message.parts) {
    const isSync =
      part.type === "tool-syncFieldWialonGeofence" ||
      (part.type === "dynamic-tool" &&
        "toolName" in part &&
        part.toolName === "syncFieldWialonGeofence");
    if (!isSync) continue;
    if (!("state" in part) || part.state !== "output-available") continue;
    if (!("output" in part) || !part.output || typeof part.output !== "object") {
      continue;
    }
    const raw = part.output as Record<string, unknown>;
    if (raw.success !== true && raw.status !== "synced") continue;
    if (typeof raw.fieldId !== "string" || !raw.fieldId) continue;
    return {
      fieldId: raw.fieldId,
      wialonGeofenceId:
        typeof raw.wialonGeofenceId === "string" ? raw.wialonGeofenceId : "",
    };
  }
  return null;
}

type CreatedFieldCardData = {
  fieldId: string;
  name: string;
  area: number;
  crop: string;
  categoryLabel: string;
  openFieldPath: string;
};

function normalizeCreatedField(value: unknown): CreatedFieldCardData | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (raw.success !== true && raw.status !== "created") return null;
  if (typeof raw.fieldId !== "string" || !raw.fieldId) return null;
  return {
    fieldId: raw.fieldId,
    name: typeof raw.name === "string" ? raw.name : "Поле",
    area: Number(raw.area) || 0,
    crop: typeof raw.crop === "string" ? raw.crop : "—",
    categoryLabel:
      typeof raw.categoryLabel === "string"
        ? raw.categoryLabel
        : "Товарне поле",
    openFieldPath:
      typeof raw.openFieldPath === "string"
        ? raw.openFieldPath
        : `/?field=${raw.fieldId}`,
  };
}

function extractCreatedFields(message: UIMessage): CreatedFieldCardData[] {
  const items: CreatedFieldCardData[] = [];
  for (const part of message.parts) {
    const isCreate =
      part.type === "tool-createField" ||
      (part.type === "dynamic-tool" &&
        "toolName" in part &&
        part.toolName === "createField");
    if (!isCreate) continue;
    if (!("state" in part) || part.state !== "output-available") continue;
    if (!("output" in part)) continue;
    const item = normalizeCreatedField(part.output);
    if (item) items.push(item);
  }
  return items;
}

type DeleteFieldConfirmation = {
  status: "requires_confirmation";
  fieldId: string;
  fieldName: string;
  areaHa: number;
  operationsCount: number;
  movesCount: number;
  mode: "archive" | "delete";
  warning: string;
  userHint: string;
  confirmChoice: string;
  cancelChoice: string;
};

function normalizeDeleteFieldConfirmation(
  value: unknown
): DeleteFieldConfirmation | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (raw.status !== "requires_confirmation") return null;
  if (typeof raw.fieldId !== "string" || typeof raw.fieldName !== "string") {
    return null;
  }
  return {
    status: "requires_confirmation",
    fieldId: raw.fieldId,
    fieldName: raw.fieldName,
    areaHa: Number(raw.areaHa) || 0,
    operationsCount: Number(raw.operationsCount) || 0,
    movesCount: Number(raw.movesCount) || 0,
    mode: raw.mode === "archive" ? "archive" : "delete",
    warning:
      typeof raw.warning === "string"
        ? raw.warning
        : "Підтверди дію з полем.",
    userHint:
      typeof raw.userHint === "string"
        ? raw.userHint
        : `Підтверди дію з полем «${raw.fieldName}»`,
    confirmChoice:
      typeof raw.confirmChoice === "string"
        ? raw.confirmChoice
        : "Підтвердити",
    cancelChoice:
      typeof raw.cancelChoice === "string" ? raw.cancelChoice : "Скасувати",
  };
}

function extractDeleteFieldConfirmations(
  message: UIMessage
): DeleteFieldConfirmation[] {
  const items: DeleteFieldConfirmation[] = [];
  for (const part of message.parts) {
    const isDel =
      part.type === "tool-deleteField" ||
      (part.type === "dynamic-tool" &&
        "toolName" in part &&
        part.toolName === "deleteField");
    if (!isDel) continue;
    if (!("state" in part) || part.state !== "output-available") continue;
    if (!("output" in part)) continue;
    const item = normalizeDeleteFieldConfirmation(part.output);
    if (item) items.push(item);
  }
  return items;
}

function extractDeletedOrArchivedFieldPayload(message: UIMessage): {
  fieldId: string;
  status: "deleted" | "archived";
} | null {
  for (const part of message.parts) {
    const isDel =
      part.type === "tool-deleteField" ||
      (part.type === "dynamic-tool" &&
        "toolName" in part &&
        part.toolName === "deleteField");
    if (!isDel) continue;
    if (!("state" in part) || part.state !== "output-available") continue;
    if (!("output" in part) || !part.output || typeof part.output !== "object") {
      continue;
    }
    const raw = part.output as Record<string, unknown>;
    if (raw.success !== true) continue;
    if (raw.status !== "deleted" && raw.status !== "archived") continue;
    if (typeof raw.fieldId !== "string" || !raw.fieldId) continue;
    return {
      fieldId: raw.fieldId,
      status: raw.status,
    };
  }
  return null;
}

function CreatedFieldCard({
  item,
  onNavigate,
}: {
  item: CreatedFieldCardData;
  onNavigate?: (path: string) => void;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-emerald-400/30 bg-gradient-to-br from-emerald-500/10 via-zinc-950/80 to-zinc-950/90">
      <div className="flex items-center gap-2.5 border-b border-emerald-500/15 px-3.5 py-3">
        <div className="inline-flex size-8 items-center justify-center rounded-xl bg-emerald-500/15 ring-1 ring-emerald-400/25">
          <MapPin className="size-4 text-emerald-400" strokeWidth={2.1} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold tracking-tight text-white">
            Нове поле: {item.name}
          </p>
          <p className="text-[11px] text-zinc-500">{item.categoryLabel}</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 px-3.5 py-3">
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] px-2.5 py-2">
          <p className="text-[10px] tracking-wide text-zinc-500 uppercase">
            Площа
          </p>
          <p className="mt-0.5 text-sm font-semibold tabular-nums text-emerald-300">
            {item.area} га
          </p>
        </div>
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] px-2.5 py-2">
          <p className="text-[10px] tracking-wide text-zinc-500 uppercase">
            Культура
          </p>
          <p className="mt-0.5 truncate text-sm font-semibold text-white">
            {item.crop}
          </p>
        </div>
      </div>
      <div className="border-t border-white/10 px-3.5 py-3">
        <button
          type="button"
          onClick={() => onNavigate?.(item.openFieldPath)}
          className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-400/30 bg-emerald-500/15 px-3 py-1.5 text-xs font-semibold text-emerald-200 transition hover:bg-emerald-500/25"
        >
          <MapPin className="size-3.5" />
          Відкрити на карті
        </button>
      </div>
    </div>
  );
}

function DeleteFieldConfirmCard({
  item,
  onReply,
  disabled,
}: {
  item: DeleteFieldConfirmation;
  onReply?: (text: string) => void;
  disabled?: boolean;
}) {
  const [resolved, setResolved] = useState<"confirm" | "cancel" | null>(null);

  function choose(kind: "confirm" | "cancel") {
    if (disabled || resolved) return;
    setResolved(kind);
    onReply?.(kind === "confirm" ? item.confirmChoice : item.cancelChoice);
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-rose-400/35 bg-gradient-to-br from-rose-500/15 via-zinc-950/85 to-zinc-950/95">
      <div className="flex items-start gap-2.5 border-b border-rose-500/20 px-3.5 py-3">
        <div className="inline-flex size-8 shrink-0 items-center justify-center rounded-xl bg-rose-500/15 ring-1 ring-rose-400/25">
          <AlertCircle className="size-4 text-rose-300" strokeWidth={2.1} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold tracking-tight text-white">
            {item.mode === "archive" ? "Архівація поля" : "Видалення поля"}
          </p>
          <p className="mt-1 text-sm leading-relaxed text-zinc-300">
            {item.userHint}
          </p>
        </div>
      </div>
      <div className="space-y-1.5 px-3.5 py-3 text-xs text-zinc-300">
        <p>
          Площа:{" "}
          <span className="font-semibold text-white">{item.areaHa} га</span>
        </p>
        <p>
          Наряди:{" "}
          <span className="font-semibold text-white">
            {item.operationsCount}
          </span>
          {" · "}
          Списання ТМЦ:{" "}
          <span className="font-semibold text-white">{item.movesCount}</span>
        </p>
        <p className="flex items-start gap-1.5 text-rose-200/90">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
          <span>{item.warning}</span>
        </p>
      </div>
      <div className="flex flex-wrap gap-2 border-t border-white/10 px-3.5 py-3">
        <button
          type="button"
          disabled={disabled || resolved !== null}
          onClick={() => choose("confirm")}
          className="rounded-xl border border-rose-400/40 bg-rose-500/20 px-3 py-1.5 text-xs font-semibold text-rose-100 disabled:opacity-50"
        >
          {resolved === "confirm" ? "Підтверджено…" : item.confirmChoice}
        </button>
        <button
          type="button"
          disabled={disabled || resolved !== null}
          onClick={() => choose("cancel")}
          className="rounded-xl border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold text-zinc-300 disabled:opacity-50"
        >
          {resolved === "cancel" ? "Скасовано" : item.cancelChoice}
        </button>
      </div>
    </div>
  );
}

type ScoutingDiagnosisResult = {
  fieldId: string;
  fieldName: string;
  cropPhase: string;
  visualState: string;
  riskLevel: "ok" | "warning" | "critical";
  riskBadge: string;
  diagnosis: string;
  reportId: string;
};

function normalizeScoutingDiagnosis(
  value: unknown
): ScoutingDiagnosisResult | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (raw.success !== true) return null;
  if (typeof raw.fieldId !== "string" || !raw.fieldId) return null;
  if (typeof raw.reportId !== "string" || !raw.reportId) return null;
  const risk =
    raw.riskLevel === "critical" || raw.riskLevel === "warning"
      ? raw.riskLevel
      : "ok";
  return {
    fieldId: raw.fieldId,
    fieldName:
      typeof raw.fieldName === "string" ? raw.fieldName : "Поле",
    cropPhase:
      typeof raw.cropPhase === "string" ? raw.cropPhase : "—",
    visualState:
      typeof raw.visualState === "string" ? raw.visualState : "",
    riskLevel: risk,
    riskBadge:
      typeof raw.riskBadge === "string"
        ? raw.riskBadge
        : risk === "critical"
          ? "Ризик"
          : risk === "warning"
            ? "Увага"
            : "Норма",
    diagnosis:
      typeof raw.diagnosis === "string" ? raw.diagnosis : "",
    reportId: raw.reportId,
  };
}

function extractScoutingDiagnoses(
  message: UIMessage
): ScoutingDiagnosisResult[] {
  const items: ScoutingDiagnosisResult[] = [];
  for (const part of message.parts) {
    const isScout =
      part.type === "tool-analyzeAndSaveScoutingReport" ||
      (part.type === "dynamic-tool" &&
        "toolName" in part &&
        part.toolName === "analyzeAndSaveScoutingReport");
    if (!isScout) continue;
    if (!("state" in part) || part.state !== "output-available") continue;
    if (!("output" in part)) continue;
    const item = normalizeScoutingDiagnosis(part.output);
    if (item) items.push(item);
  }
  return items;
}

function ScoutingDiagnosisCard({ item }: { item: ScoutingDiagnosisResult }) {
  const badgeClass =
    item.riskLevel === "critical"
      ? "border-rose-400/40 bg-rose-500/15 text-rose-300"
      : item.riskLevel === "warning"
        ? "border-amber-400/40 bg-amber-500/15 text-amber-300"
        : "border-emerald-400/40 bg-emerald-500/15 text-emerald-300";

  return (
    <div className="overflow-hidden rounded-2xl border border-lime-400/25 bg-gradient-to-br from-lime-500/10 via-zinc-950/80 to-zinc-950/90 shadow-[0_0_0_1px_rgba(163,230,53,0.1)]">
      <div className="flex items-center gap-2.5 border-b border-lime-500/15 px-3.5 py-3">
        <div className="inline-flex size-8 items-center justify-center rounded-xl bg-lime-500/15 ring-1 ring-lime-400/25">
          <Wheat className="size-4 text-lime-400" strokeWidth={2.1} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold tracking-tight text-white">
            Діагностика посіву · {item.fieldName}
          </p>
          <p className="text-[11px] text-zinc-500">
            Збережено в таймлайн поля
          </p>
        </div>
        <span
          className={`shrink-0 rounded-md border px-2 py-0.5 text-[10px] font-bold tracking-wide uppercase ${badgeClass}`}
        >
          {item.riskBadge}
        </span>
      </div>
      <div className="space-y-2 px-3.5 py-3">
        <div>
          <p className="text-[10px] tracking-wide text-zinc-500 uppercase">
            Фаза і стан
          </p>
          <p className="mt-0.5 text-sm font-medium text-white">
            {item.cropPhase}
          </p>
          {item.visualState ? (
            <p className="mt-0.5 text-xs leading-snug text-zinc-400">
              {item.visualState}
            </p>
          ) : null}
        </div>
        {item.diagnosis ? (
          <div>
            <p className="text-[10px] tracking-wide text-zinc-500 uppercase">
              Висновок ШІ
            </p>
            <p className="mt-0.5 text-sm leading-snug text-zinc-200">
              {item.diagnosis}
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

type InvoicePreviewLine = {
  lineId: string;
  name: string;
  category: string;
  quantity: number;
  unit: string;
  pricePerUnit: number;
  totalAmount: number;
  matchStatus: "existing" | "new" | "skipped_fuel";
};

type InvoicePreview = {
  status: "invoice_preview_ready";
  receiptId: string;
  supplierName: string;
  supplierEdrpou: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  items: InvoicePreviewLine[];
  totalAmount: number;
  newItemsCount: number;
  existingItemsCount: number;
};

function normalizeInvoicePreview(value: unknown): InvoicePreview | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (raw.status !== "invoice_preview_ready") return null;
  if (typeof raw.receiptId !== "string" || typeof raw.supplierName !== "string") {
    return null;
  }
  if (!Array.isArray(raw.items) || raw.items.length === 0) return null;

  const items: InvoicePreviewLine[] = [];
  for (const row of raw.items) {
    if (!row || typeof row !== "object") continue;
    const line = row as Record<string, unknown>;
    if (typeof line.name !== "string") continue;
    const matchStatus =
      line.matchStatus === "existing" ||
      line.matchStatus === "new" ||
      line.matchStatus === "skipped_fuel"
        ? line.matchStatus
        : "new";
    items.push({
      lineId:
        typeof line.lineId === "string" ? line.lineId : `line-${items.length + 1}`,
      name: line.name,
      category: typeof line.category === "string" ? line.category : "ТМЦ",
      quantity: Number(line.quantity) || 0,
      unit: typeof line.unit === "string" ? line.unit : "шт",
      pricePerUnit: Number(line.pricePerUnit) || 0,
      totalAmount: Number(line.totalAmount) || 0,
      matchStatus,
    });
  }
  if (items.length === 0) return null;

  return {
    status: "invoice_preview_ready",
    receiptId: raw.receiptId,
    supplierName: raw.supplierName,
    supplierEdrpou:
      typeof raw.supplierEdrpou === "string" ? raw.supplierEdrpou : null,
    invoiceNumber:
      typeof raw.invoiceNumber === "string" ? raw.invoiceNumber : null,
    invoiceDate: typeof raw.invoiceDate === "string" ? raw.invoiceDate : null,
    items,
    totalAmount: Number(raw.totalAmount) || 0,
    newItemsCount: Number(raw.newItemsCount) || 0,
    existingItemsCount: Number(raw.existingItemsCount) || 0,
  };
}

function extractInvoicePreviews(message: UIMessage): InvoicePreview[] {
  const items: InvoicePreview[] = [];
  for (const part of message.parts) {
    const isPreview =
      part.type === "tool-previewInvoiceReceipt" ||
      (part.type === "dynamic-tool" &&
        "toolName" in part &&
        part.toolName === "previewInvoiceReceipt");
    if (!isPreview) continue;
    if (!("state" in part) || part.state !== "output-available") continue;
    if (!("output" in part)) continue;
    const preview = normalizeInvoicePreview(part.output);
    if (preview) items.push(preview);
  }
  return items;
}

function formatMoneyUa(value: number): string {
  return new Intl.NumberFormat("uk-UA", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  }).format(value);
}

async function fileToBase64Payload(file: File): Promise<{
  fileName: string;
  mimeType: string;
  base64: string;
}> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return {
    fileName: file.name || "nakladna.jpg",
    mimeType: file.type || "image/jpeg",
    base64: btoa(binary),
  };
}

function InvoicePreviewCard({
  invoice,
  invoiceFiles,
}: {
  invoice: InvoicePreview;
  invoiceFiles?: File[] | null;
}) {
  const [posting, setPosting] = useState(false);
  const [posted, setPosted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const files = invoiceFiles?.length ? invoiceFiles : [];

  async function postReceipt() {
    if (posting || posted) return;
    setPosting(true);
    setError(null);
    try {
      const attachments =
        files.length > 0
          ? await Promise.all(files.map((f) => fileToBase64Payload(f)))
          : [];
      const result = await executeWarehouseReceiptAction({
        receiptId: invoice.receiptId,
        supplierName: invoice.supplierName,
        supplierEdrpou: invoice.supplierEdrpou,
        invoiceNumber: invoice.invoiceNumber,
        invoiceDate: invoice.invoiceDate,
        totalAmount: invoice.totalAmount,
        items: invoice.items
          .filter((line) => line.matchStatus !== "skipped_fuel")
          .map((line) => ({
            name: line.name,
            category: line.category as
              | "ЗЗР"
              | "Добрива"
              | "Насіння"
              | "Паливо"
              | "Запчастини",
            quantity: line.quantity,
            unit: line.unit,
            pricePerUnit: line.pricePerUnit,
            totalAmount: line.totalAmount,
          })),
        attachment: attachments[0] ?? null,
        attachments,
      });
      if (!result.success) {
        setError(result.error);
        return;
      }
      setPosted(true);
      window.dispatchEvent(
        new CustomEvent("warehouse-updated", {
          detail: {
            receiptId: result.receiptId,
            postedLines: result.postedLines,
          },
        })
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Не вдалося оприбуткувати"
      );
    } finally {
      setPosting(false);
    }
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-emerald-400/30 bg-gradient-to-br from-emerald-500/10 via-zinc-950/85 to-zinc-950/95 shadow-[0_0_0_1px_rgba(16,185,129,0.12)]">
      <div className="border-b border-emerald-500/20 px-3.5 py-3">
        <p className="text-sm font-semibold tracking-tight text-white">
          {invoice.supplierName}
        </p>
        <p className="mt-0.5 text-[11px] text-zinc-400">
          {invoice.invoiceNumber
            ? `№ ${invoice.invoiceNumber}`
            : "Без номера"}
          {invoice.invoiceDate ? ` від ${invoice.invoiceDate}` : ""}
          {invoice.supplierEdrpou ? ` · ЄДРПОУ ${invoice.supplierEdrpou}` : ""}
        </p>
        {(invoice.newItemsCount > 0 || invoice.existingItemsCount > 0) && (
          <p className="mt-1 text-[10px] text-zinc-500">
            {invoice.existingItemsCount > 0
              ? `${invoice.existingItemsCount} вже в номенклатурі`
              : null}
            {invoice.newItemsCount > 0
              ? `${invoice.existingItemsCount > 0 ? " · " : ""}${invoice.newItemsCount} нових`
              : null}
          </p>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[280px] text-left text-xs">
          <thead>
            <tr className="border-b border-white/10 text-[10px] tracking-wide text-zinc-500 uppercase">
              <th className="px-3.5 py-2 font-medium">Товар</th>
              <th className="px-2 py-2 font-medium">К-сть</th>
              <th className="px-2 py-2 font-medium">Ціна</th>
              <th className="px-3.5 py-2 text-right font-medium">Сума</th>
            </tr>
          </thead>
          <tbody>
            {invoice.items.map((line) => (
              <tr
                key={line.lineId}
                className="border-b border-white/[0.06] text-zinc-200"
              >
                <td className="px-3.5 py-2">
                  <p className="font-medium text-white">{line.name}</p>
                  <span className="mt-0.5 inline-flex rounded-md bg-white/5 px-1.5 py-0.5 text-[10px] text-zinc-400">
                    {line.category}
                    {line.matchStatus === "new" ? " · нова" : ""}
                    {line.matchStatus === "skipped_fuel" ? " · паливо" : ""}
                  </span>
                </td>
                <td className="px-2 py-2 whitespace-nowrap tabular-nums">
                  {line.quantity} {line.unit}
                </td>
                <td className="px-2 py-2 whitespace-nowrap tabular-nums">
                  {formatMoneyUa(line.pricePerUnit)}
                </td>
                <td className="px-3.5 py-2 text-right font-semibold tabular-nums text-emerald-300">
                  {formatMoneyUa(line.totalAmount)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/10 px-3.5 py-3">
        <div>
          <p className="text-[10px] tracking-wide text-zinc-500 uppercase">
            Разом
          </p>
          <p className="text-sm font-semibold tabular-nums text-white">
            {formatMoneyUa(invoice.totalAmount)} ₴
          </p>
        </div>
        {posted ? (
          <span className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-400/30 bg-emerald-500/15 px-3 py-1.5 text-xs font-semibold text-emerald-300">
            <CheckCircle2 className="size-3.5" />
            Оприбутковано на баланс
          </span>
        ) : (
          <button
            type="button"
            disabled={posting}
            onClick={() => void postReceipt()}
            className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-zinc-950 transition hover:bg-emerald-400 disabled:opacity-50"
          >
            {posting ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <CheckCircle2 className="size-3.5" />
            )}
            Оприбуткувати на склад
          </button>
        )}
      </div>
      {error ? (
        <p className="border-t border-red-500/20 px-3.5 py-2 text-[11px] text-red-300">
          {error}
        </p>
      ) : null}
      {!posted ? (
        <p className="border-t border-white/5 px-3.5 py-2 text-[10px] text-zinc-500">
          {files.length > 0
            ? `${files.length} скан(и) буде прикріплено до кожної позиції на складі.`
            : "Можна написати в чат: «Зміни кількість другого товару на …»"}
        </p>
      ) : null}
    </div>
  );
}

type ServiceActPreviewLine = {
  lineId: string;
  name: string;
  quantity: number;
  unit: string;
  pricePerUnit: number;
  totalAmount: number;
};

type ServiceActPreview = {
  status: "service_act_preview_ready";
  previewId: string;
  actNumber: string | null;
  actDate: string | null;
  contractorName: string;
  contractorEdrpou: string | null;
  category: string;
  services: ServiceActPreviewLine[];
  totalAmount: number;
  vatAmount: number | null;
  targetAssetHint: string | null;
  matchedEquipment: { id: string; name: string; type: string | null } | null;
  suggestLinkEquipment: boolean;
};

function normalizeServiceActPreview(value: unknown): ServiceActPreview | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (raw.status !== "service_act_preview_ready") return null;
  if (
    typeof raw.previewId !== "string" ||
    typeof raw.contractorName !== "string"
  ) {
    return null;
  }
  if (!Array.isArray(raw.services) || raw.services.length === 0) return null;

  const services: ServiceActPreviewLine[] = [];
  for (const row of raw.services) {
    if (!row || typeof row !== "object") continue;
    const line = row as Record<string, unknown>;
    if (typeof line.name !== "string") continue;
    services.push({
      lineId:
        typeof line.lineId === "string"
          ? line.lineId
          : `svc-${services.length + 1}`,
      name: line.name,
      quantity: Number(line.quantity) || 1,
      unit: typeof line.unit === "string" ? line.unit : "послуга",
      pricePerUnit: Number(line.pricePerUnit) || 0,
      totalAmount: Number(line.totalAmount) || 0,
    });
  }
  if (services.length === 0) return null;

  const matchedRaw =
    raw.matchedEquipment && typeof raw.matchedEquipment === "object"
      ? (raw.matchedEquipment as Record<string, unknown>)
      : null;

  return {
    status: "service_act_preview_ready",
    previewId: raw.previewId,
    actNumber: typeof raw.actNumber === "string" ? raw.actNumber : null,
    actDate: typeof raw.actDate === "string" ? raw.actDate : null,
    contractorName: raw.contractorName,
    contractorEdrpou:
      typeof raw.contractorEdrpou === "string" ? raw.contractorEdrpou : null,
    category: typeof raw.category === "string" ? raw.category : "Адміністративні",
    services,
    totalAmount: Number(raw.totalAmount) || 0,
    vatAmount:
      raw.vatAmount != null && Number.isFinite(Number(raw.vatAmount))
        ? Number(raw.vatAmount)
        : null,
    targetAssetHint:
      typeof raw.targetAssetHint === "string" ? raw.targetAssetHint : null,
    matchedEquipment:
      matchedRaw && typeof matchedRaw.id === "string"
        ? {
            id: matchedRaw.id,
            name:
              typeof matchedRaw.name === "string"
                ? matchedRaw.name
                : "Техніка",
            type: typeof matchedRaw.type === "string" ? matchedRaw.type : null,
          }
        : null,
    suggestLinkEquipment: raw.suggestLinkEquipment === true,
  };
}

function extractServiceActPreviews(message: UIMessage): ServiceActPreview[] {
  const items: ServiceActPreview[] = [];
  for (const part of message.parts) {
    const isPreview =
      part.type === "tool-previewServiceAct" ||
      (part.type === "dynamic-tool" &&
        "toolName" in part &&
        part.toolName === "previewServiceAct");
    if (!isPreview) continue;
    if (!("state" in part) || part.state !== "output-available") continue;
    if (!("output" in part)) continue;
    const preview = normalizeServiceActPreview(part.output);
    if (preview) items.push(preview);
  }
  return items;
}

function ServiceActPreviewCard({
  act,
  actFiles,
}: {
  act: ServiceActPreview;
  actFiles?: File[] | null;
}) {
  const [posting, setPosting] = useState(false);
  const [posted, setPosted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linkEquipment, setLinkEquipment] = useState(
    act.suggestLinkEquipment && Boolean(act.matchedEquipment)
  );
  const files = actFiles?.length ? actFiles : [];

  async function saveAct() {
    if (posting || posted) return;
    setPosting(true);
    setError(null);
    try {
      const attachments =
        files.length > 0
          ? await Promise.all(files.map((f) => fileToBase64Payload(f)))
          : [];
      const result = await executeServiceActSaveAction({
        previewId: act.previewId,
        actNumber: act.actNumber,
        actDate: act.actDate,
        contractorName: act.contractorName,
        contractorEdrpou: act.contractorEdrpou,
        category: act.category,
        totalAmount: act.totalAmount,
        vatAmount: act.vatAmount,
        targetAssetHint: act.targetAssetHint,
        equipmentId: act.matchedEquipment?.id ?? null,
        linkEquipment,
        services: act.services.map((line) => ({
          name: line.name,
          quantity: line.quantity,
          unit: line.unit,
          pricePerUnit: line.pricePerUnit,
          totalAmount: line.totalAmount,
        })),
        attachment: attachments[0] ?? null,
        attachments,
      });
      if (!result.success) {
        setError(result.error);
        return;
      }
      setPosted(true);
      window.dispatchEvent(
        new CustomEvent("accounting-updated", {
          detail: {
            actId: result.actId,
            equipmentId: result.equipmentId,
          },
        })
      );
      if (result.equipmentId) {
        window.dispatchEvent(
          new CustomEvent("equipment-updated", {
            detail: { equipmentId: result.equipmentId },
          })
        );
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Не вдалося записати акт"
      );
    } finally {
      setPosting(false);
    }
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-sky-400/30 bg-gradient-to-br from-sky-500/10 via-zinc-950/85 to-zinc-950/95 shadow-[0_0_0_1px_rgba(56,189,248,0.12)]">
      <div className="border-b border-sky-500/20 px-3.5 py-3">
        <span className="inline-flex items-center gap-1.5 rounded-lg border border-sky-400/25 bg-sky-500/10 px-2 py-0.5 text-[10px] font-bold tracking-wide text-sky-200 uppercase">
          <FileText className="size-3" />
          Акт виконаних послуг
        </span>
        <p className="mt-2 text-sm font-semibold tracking-tight text-white">
          {act.contractorName}
        </p>
        <p className="mt-0.5 text-[11px] text-zinc-400">
          {act.actNumber ? `№ ${act.actNumber}` : "Без номера"}
          {act.actDate ? ` · ${act.actDate}` : ""}
          {act.contractorEdrpou ? ` · ЄДРПОУ ${act.contractorEdrpou}` : ""}
        </p>
        <p className="mt-1 text-[11px] text-sky-200/90">{act.category}</p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[260px] text-left text-xs">
          <thead>
            <tr className="border-b border-white/10 text-[10px] tracking-wide text-zinc-500 uppercase">
              <th className="px-3.5 py-2 font-medium">Послуга</th>
              <th className="px-2 py-2 font-medium">К-сть</th>
              <th className="px-3.5 py-2 text-right font-medium">Сума</th>
            </tr>
          </thead>
          <tbody>
            {act.services.map((line) => (
              <tr
                key={line.lineId}
                className="border-b border-white/[0.06] text-zinc-200"
              >
                <td className="px-3.5 py-2 font-medium text-white">
                  {line.name}
                </td>
                <td className="px-2 py-2 whitespace-nowrap tabular-nums">
                  {line.quantity} {line.unit}
                </td>
                <td className="px-3.5 py-2 text-right font-semibold tabular-nums text-sky-200">
                  {formatMoneyUa(line.totalAmount)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {act.matchedEquipment && act.suggestLinkEquipment ? (
        <div className="border-t border-amber-500/20 bg-amber-500/10 px-3.5 py-3">
          <label className="flex cursor-pointer items-start gap-2.5">
            <input
              type="checkbox"
              checked={linkEquipment}
              disabled={posted || posting}
              onChange={(e) => setLinkEquipment(e.target.checked)}
              className="mt-0.5 size-4 rounded border-white/20 bg-zinc-900 text-amber-500"
            />
            <span className="text-xs leading-relaxed text-amber-100">
              Привʼязати витрату{" "}
              <span className="font-semibold tabular-nums">
                {formatMoneyUa(act.totalAmount)} ₴
              </span>{" "}
              до «{act.matchedEquipment.name}»?
            </span>
          </label>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/10 px-3.5 py-3">
        <div>
          <p className="text-[10px] tracking-wide text-zinc-500 uppercase">
            Разом{act.vatAmount != null ? " з ПДВ" : ""}
          </p>
          <p className="text-sm font-semibold tabular-nums text-white">
            {formatMoneyUa(act.totalAmount)} ₴
          </p>
        </div>
        {posted ? (
          <span className="inline-flex items-center gap-1.5 rounded-xl border border-sky-400/30 bg-sky-500/15 px-3 py-1.5 text-xs font-semibold text-sky-200">
            <CheckCircle2 className="size-3.5" />
            Записано в Бухгалтерію
          </span>
        ) : (
          <button
            type="button"
            disabled={posting}
            onClick={() => void saveAct()}
            className="inline-flex items-center gap-1.5 rounded-xl bg-sky-500 px-3 py-1.5 text-xs font-semibold text-zinc-950 transition hover:bg-sky-400 disabled:opacity-50"
          >
            {posting ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <FileText className="size-3.5" />
            )}
            Записати в Бухгалтерію
          </button>
        )}
      </div>
      {error ? (
        <p className="border-t border-red-500/20 px-3.5 py-2 text-[11px] text-red-300">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function FieldUpdateConfirmCard({
  item,
  onReply,
  disabled,
}: {
  item: FieldUpdateConfirmation;
  onReply?: (text: string) => void;
  disabled?: boolean;
}) {
  const [resolved, setResolved] = useState<"confirm" | "cancel" | null>(null);

  function choose(kind: "confirm" | "cancel") {
    if (disabled || resolved) return;
    setResolved(kind);
    // У чат лише людський текст кнопки — fieldId/confirmed агент бере з попереднього tool-результату
    onReply?.(kind === "confirm" ? item.confirmChoice : item.cancelChoice);
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-amber-400/35 bg-gradient-to-br from-amber-500/15 via-zinc-950/85 to-zinc-950/95 shadow-[0_0_0_1px_rgba(251,191,36,0.12)]">
      <div className="flex items-start gap-2.5 border-b border-amber-500/20 px-3.5 py-3">
        <div className="inline-flex size-8 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 ring-1 ring-amber-400/25">
          <AlertCircle className="size-4 text-amber-300" strokeWidth={2.1} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold tracking-tight text-white">
            Підтвердження зміни поля
          </p>
          <p className="mt-1 text-sm leading-relaxed text-zinc-300">
            {item.userHint}
          </p>
        </div>
      </div>
      <div className="space-y-2 px-3.5 py-3 text-xs text-zinc-300">
        {item.changes.area ? (
          <p>
            Площа:{" "}
            <span className="font-semibold text-white">
              {item.changes.area.from} га
            </span>{" "}
            →{" "}
            <span className="font-semibold text-emerald-300">
              {item.changes.area.to} га
            </span>
          </p>
        ) : null}
        {item.changes.culture ? (
          <p>
            Культура:{" "}
            <span className="font-semibold text-white">
              {item.changes.culture.from || "—"}
            </span>{" "}
            →{" "}
            <span className="font-semibold text-emerald-300">
              {item.changes.culture.to}
            </span>
          </p>
        ) : null}
        {item.changes.name ? (
          <p>
            Назва:{" "}
            <span className="font-semibold text-white">
              {item.changes.name.from}
            </span>{" "}
            →{" "}
            <span className="font-semibold text-emerald-300">
              {item.changes.name.to}
            </span>
          </p>
        ) : null}
        <p className="flex items-start gap-1.5 text-amber-200/90">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
          <span>{item.warning}</span>
        </p>
      </div>
      <div className="flex flex-wrap gap-2 border-t border-white/10 px-3.5 py-3">
        <button
          type="button"
          disabled={disabled || resolved !== null}
          onClick={() => choose("confirm")}
          className="rounded-xl bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-zinc-950 transition hover:bg-emerald-400 disabled:opacity-50"
        >
          {resolved === "confirm" ? "Підтверджено…" : item.confirmChoice}
        </button>
        <button
          type="button"
          disabled={disabled || resolved !== null}
          onClick={() => choose("cancel")}
          className="rounded-xl border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-medium text-zinc-300 transition hover:bg-white/10 disabled:opacity-50"
        >
          {resolved === "cancel" ? "Скасовано" : item.cancelChoice}
        </button>
      </div>
    </div>
  );
}

function ReceiptRollbackConfirmCard({
  item,
  onReply,
  disabled,
}: {
  item: ReceiptRollbackConfirmation;
  onReply?: (text: string) => void;
  disabled?: boolean;
}) {
  const [resolved, setResolved] = useState<"confirm" | "cancel" | null>(null);

  function choose(kind: "confirm" | "cancel") {
    if (disabled || resolved) return;
    setResolved(kind);
    // Лише людський текст кнопки — receiptId агент бере з попереднього tool-результату
    onReply?.(kind === "confirm" ? item.confirmChoice : item.cancelChoice);
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-red-400/40 bg-gradient-to-br from-red-500/20 via-zinc-950/90 to-zinc-950/95 shadow-[0_0_0_1px_rgba(248,113,113,0.14)]">
      <div className="flex items-start gap-2.5 border-b border-red-500/25 px-3.5 py-3">
        <div className="inline-flex size-8 shrink-0 items-center justify-center rounded-xl bg-red-500/20 ring-1 ring-red-400/30">
          <AlertCircle className="size-4 text-red-300" strokeWidth={2.1} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold tracking-tight text-white">
            Скасувати накладну
            {item.invoiceNumber ? ` №${item.invoiceNumber}` : ""}?
          </p>
          <p className="mt-1 text-sm leading-relaxed text-zinc-300">
            {item.userHint}
          </p>
          <p className="mt-1 text-[11px] text-zinc-500">
            {item.supplier}
            {item.invoiceDate ? ` · від ${item.invoiceDate}` : ""}
          </p>
        </div>
      </div>
      {item.items.length > 0 ? (
        <ul className="space-y-1.5 border-b border-white/5 px-3.5 py-3 text-xs text-zinc-300">
          {item.items.map((line, index) => (
            <li
              key={`${item.receiptId}-${line.itemName}-${index}`}
              className="flex items-start justify-between gap-3"
            >
              <span className="min-w-0 font-medium text-zinc-200">
                {line.itemName}
                {line.shortage ? (
                  <span className="ml-1.5 text-[10px] font-semibold text-amber-300">
                    недостача
                  </span>
                ) : null}
              </span>
              <span className="shrink-0 tabular-nums text-red-200">
                −{line.quantity} {line.unit}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="space-y-2 px-3.5 py-3 text-xs text-zinc-300">
        <p className="flex items-start gap-1.5 text-red-200/95">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
          <span>{item.warning}</span>
        </p>
      </div>
      <div className="flex flex-wrap gap-2 border-t border-white/10 px-3.5 py-3">
        <button
          type="button"
          disabled={disabled || resolved !== null}
          onClick={() => choose("confirm")}
          className="rounded-xl bg-red-500 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-red-400 disabled:opacity-50"
        >
          {resolved === "confirm" ? "Анулюю…" : item.confirmChoice}
        </button>
        <button
          type="button"
          disabled={disabled || resolved !== null}
          onClick={() => choose("cancel")}
          className="rounded-xl border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-medium text-zinc-300 transition hover:bg-white/10 disabled:opacity-50"
        >
          {resolved === "cancel" ? "Залишено" : item.cancelChoice}
        </button>
      </div>
    </div>
  );
}

function ServiceActDeleteConfirmCard({
  item,
  onReply,
  disabled,
}: {
  item: ServiceActDeleteConfirmation;
  onReply?: (text: string) => void;
  disabled?: boolean;
}) {
  const [resolved, setResolved] = useState<"confirm" | "cancel" | null>(null);

  function choose(kind: "confirm" | "cancel") {
    if (disabled || resolved) return;
    setResolved(kind);
    onReply?.(kind === "confirm" ? item.confirmChoice : item.cancelChoice);
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-red-400/40 bg-gradient-to-br from-red-500/20 via-zinc-950/90 to-zinc-950/95 shadow-[0_0_0_1px_rgba(248,113,113,0.14)]">
      <div className="flex items-start gap-2.5 border-b border-red-500/25 px-3.5 py-3">
        <div className="inline-flex size-8 shrink-0 items-center justify-center rounded-xl bg-red-500/20 ring-1 ring-red-400/30">
          <AlertCircle className="size-4 text-red-300" strokeWidth={2.1} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold tracking-tight text-white">
            Видалити акти з Бухгалтерії?
          </p>
          <p className="mt-1 text-sm leading-relaxed text-zinc-300">
            {item.userHint}
          </p>
        </div>
      </div>
      <ul className="space-y-1.5 border-b border-white/5 px-3.5 py-3 text-xs text-zinc-300">
        {item.acts.map((act) => (
          <li
            key={act.id}
            className="flex items-start justify-between gap-3"
          >
            <span className="min-w-0 font-medium text-zinc-200">
              {act.actNumber ? `№ ${act.actNumber}` : "Без номера"}
              <span className="text-zinc-400"> · {act.contractorName}</span>
              {act.actDate ? (
                <span className="text-zinc-500"> · {act.actDate}</span>
              ) : null}
            </span>
            <span className="shrink-0 tabular-nums text-red-200">
              {formatMoneyUa(act.totalAmount)} ₴
            </span>
          </li>
        ))}
      </ul>
      <div className="space-y-2 px-3.5 py-3 text-xs text-zinc-300">
        <p className="flex items-start gap-1.5 text-red-200/95">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
          <span>{item.warning}</span>
        </p>
      </div>
      <div className="flex flex-wrap gap-2 border-t border-white/10 px-3.5 py-3">
        <button
          type="button"
          disabled={disabled || resolved !== null}
          onClick={() => choose("confirm")}
          className="rounded-xl bg-red-500 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-red-400 disabled:opacity-50"
        >
          {resolved === "confirm" ? "Видаляю…" : item.confirmChoice}
        </button>
        <button
          type="button"
          disabled={disabled || resolved !== null}
          onClick={() => choose("cancel")}
          className="rounded-xl border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-medium text-zinc-300 transition hover:bg-white/10 disabled:opacity-50"
        >
          {resolved === "cancel" ? "Залишено" : item.cancelChoice}
        </button>
      </div>
    </div>
  );
}

function DeleteWorkOrderCard({
  item,
  onReply,
  disabled,
}: {
  item: DeleteWorkOrderConfirmation;
  onReply?: (text: string) => void;
  disabled?: boolean;
}) {
  const [resolved, setResolved] = useState<"confirm" | "cancel" | null>(null);

  function choose(kind: "confirm" | "cancel") {
    if (disabled || resolved) return;
    setResolved(kind);
    if (kind === "confirm") {
      onReply?.(
        `${item.confirmChoice} (workOrderId: ${item.workOrderId})`
      );
    } else {
      onReply?.(item.cancelChoice);
    }
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-red-400/35 bg-gradient-to-br from-red-500/15 via-zinc-950/85 to-zinc-950/95 shadow-[0_0_0_1px_rgba(248,113,113,0.12)]">
      <div className="flex items-start gap-2.5 border-b border-red-500/20 px-3.5 py-3">
        <div className="inline-flex size-8 shrink-0 items-center justify-center rounded-xl bg-red-500/15 ring-1 ring-red-400/25">
          <AlertCircle className="size-4 text-red-300" strokeWidth={2.1} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold tracking-tight text-white">
            Підтвердження видалення
          </p>
          <p className="mt-1 text-sm leading-relaxed text-zinc-300">
            Ви дійсно хочете видалити наряд{" "}
            <span className="font-semibold text-white">
              {item.operationType}
            </span>{" "}
            від{" "}
            <span className="font-semibold text-white">{item.date}</span> по
            полю{" "}
            <span className="font-semibold text-white">{item.fieldName}</span>?
          </p>
          <p className="mt-1.5 text-[11px] text-zinc-500">
            {item.machinery}
            {item.statusLabel ? ` · ${item.statusLabel}` : ""}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 px-3.5 py-3">
        <button
          type="button"
          disabled={disabled || Boolean(resolved)}
          onClick={() => choose("confirm")}
          className="rounded-xl border border-red-400/40 bg-red-500/90 px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-red-500 active:scale-95 disabled:opacity-50"
        >
          {resolved === "confirm" ? "Видаляю…" : item.confirmChoice}
        </button>
        <button
          type="button"
          disabled={disabled || Boolean(resolved)}
          onClick={() => choose("cancel")}
          className="rounded-xl border border-white/10 bg-zinc-800/80 px-3 py-2 text-xs font-medium text-zinc-300 transition hover:bg-zinc-700/80 active:scale-95 disabled:opacity-50"
        >
          {item.cancelChoice}
        </button>
      </div>
    </div>
  );
}

function operationIconName(operationType: string): IconName {
  const key = operationType.toLocaleLowerCase("uk-UA");
  if (key.includes("посів") || key.includes("збир")) return "Wheat";
  if (key.includes("ззр") || key.includes("добрив")) return "Sparkles";
  return "Tractor";
}

function WorkOrderDraftCard({ draft }: { draft: WorkOrderDraft }) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const Icon = IconMap[operationIconName(draft.operationType)];

  async function confirmDraft() {
    if (saving || saved) return;
    setSaving(true);
    setError(null);
    try {
      const hhmm = /^\d{2}:\d{2}$/.test(draft.timeStart)
        ? draft.timeStart
        : "08:00";
      const occurredAt = `${draft.date}T${hhmm}:00.000Z`;
      const seasonYear =
        Number(draft.date.slice(0, 4)) || new Date().getFullYear();
      const materials =
        draft.warehouseItemId && draft.warehouseItemName
          ? [
              {
                basRefKey: draft.warehouseItemId,
                itemName: draft.warehouseItemName,
                category: draft.warehouseItemCategory || "",
                unit: draft.warehouseItemUnit || "од.",
                qty: draft.materialQty ?? 0,
              },
            ]
          : [];
      // ratePerHa у ТМЦ-операціях — норма висіву/внесення, не ставка ЗП
      const wageRateUahPerHa = draft.warehouseItemId
        ? undefined
        : (draft.ratePerHa ?? undefined);

      const payload: FieldOperation & {
        fieldKey: string;
        fieldId: string;
      } = {
        id: draft.draftId,
        fieldKey: draft.fieldKey,
        fieldId: draft.fieldId,
        seasonYear,
        occurredAt,
        type: draft.operationType,
        crop: draft.crop || "—",
        date: draft.date,
        time: draft.timeLabel,
        machinery: draft.equipmentName || "",
        implement: draft.implementName || "",
        areaDone: draft.areaHa,
        areaTotal: draft.areaHa,
        areaPlan: draft.areaHa,
        fuelUsed: draft.calculatedFuel,
        fuelPlan: draft.calculatedFuel,
        wage: draft.calculatedSalary,
        wagePlan: draft.calculatedSalary,
        wageRateUahPerHa,
        mechanicName: draft.driverName,
        status: "planned",
        equipmentId: draft.equipmentId,
        implementId: draft.implementId,
        implementWidthM: draft.implementWidthM,
        materials,
        exportStatus: "none",
        agronomistComment: draft.agronomistComment ?? undefined,
      };
      await upsertFieldOperation(payload);
      setSaved(true);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Не вдалося зберегти наряд"
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-emerald-400/30 bg-gradient-to-br from-emerald-500/10 via-zinc-950/80 to-zinc-950/90 shadow-[0_0_0_1px_rgba(16,185,129,0.12)]">
      <div className="flex items-center gap-2.5 border-b border-emerald-500/15 px-3.5 py-3">
        <div className="inline-flex size-8 items-center justify-center rounded-xl bg-emerald-500/15 ring-1 ring-emerald-400/25">
          <Icon className="size-4 text-emerald-400" strokeWidth={2.1} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold tracking-tight text-white">
            Новий наряд: {draft.operationType}
          </p>
          <p className="text-[11px] text-zinc-500">
            {draft.timeLabel} ·{" "}
            {draft.source === "wialon_gps"
              ? "з телеметрії Wialon"
              : "готово до Хронології"}
          </p>
        </div>
      </div>

      {draft.agronomistComment ? (
        <div className="border-b border-emerald-500/10 px-3.5 py-2">
          <p className="text-[11px] leading-snug text-zinc-400">
            {draft.agronomistComment}
          </p>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-2 px-3.5 py-3">
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] px-2.5 py-2">
          <p className="text-[10px] tracking-wide text-zinc-500 uppercase">
            Поле
          </p>
          <p className="mt-0.5 truncate text-sm font-semibold text-white">
            {draft.fieldName}
          </p>
          <p className="text-xs font-medium tabular-nums text-emerald-400">
            {draft.areaHa} га
          </p>
        </div>
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] px-2.5 py-2">
          <p className="text-[10px] tracking-wide text-zinc-500 uppercase">
            Дата
          </p>
          <p className="mt-0.5 text-sm font-semibold text-white">{draft.date}</p>
        </div>
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] px-2.5 py-2">
          <p className="text-[10px] tracking-wide text-zinc-500 uppercase">
            Техніка / зчіпка
          </p>
          <p className="mt-0.5 truncate text-sm font-semibold text-white">
            {draft.hitchLabel || draft.equipmentName}
          </p>
          {draft.hitchLabel && draft.implementName ? (
            <p className="truncate text-[10px] text-zinc-500">
              {draft.implementAutoPicked
                ? `Знаряддя підтягнуто: ${draft.implementName}`
                : draft.implementName}
            </p>
          ) : draft.implementName ? (
            <p className="truncate text-[10px] text-zinc-500">
              {draft.implementName}
            </p>
          ) : null}
        </div>
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] px-2.5 py-2">
          <p className="text-[10px] tracking-wide text-zinc-500 uppercase">
            Механізатор
          </p>
          <p className="mt-0.5 flex items-center gap-1.5 truncate text-sm font-semibold text-white">
            <span className="truncate">{draft.driverName}</span>
            {draft.isNewDriver ? (
              <span className="shrink-0 rounded-md border border-sky-400/30 bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-sky-300 uppercase">
                Новий
              </span>
            ) : null}
          </p>
        </div>
        {draft.warehouseItemName ? (
          <div className="col-span-2 rounded-xl border border-white/[0.06] bg-white/[0.03] px-2.5 py-2">
            <p className="text-[10px] tracking-wide text-zinc-500 uppercase">
              Списання ТМЦ
            </p>
            <p className="mt-0.5 flex items-center gap-1.5 truncate text-sm font-semibold text-white">
              <span className="truncate">{draft.warehouseItemName}</span>
              {draft.isNewWarehouseItem ? (
                <span className="shrink-0 rounded-md border border-sky-400/30 bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-sky-300 uppercase">
                  Новий
                </span>
              ) : null}
            </p>
            {draft.materialQty != null ? (
              <p className="text-xs font-medium tabular-nums text-emerald-400">
                {draft.materialQty} {draft.warehouseItemUnit || "од."}
              </p>
            ) : null}
          </div>
        ) : null}
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] px-2.5 py-2">
          <p className="text-[10px] tracking-wide text-zinc-500 uppercase">
            План палива
          </p>
          <p className="mt-0.5 text-sm font-medium tabular-nums text-emerald-400">
            {draft.calculatedFuel} л
          </p>
        </div>
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] px-2.5 py-2">
          <p className="text-[10px] tracking-wide text-zinc-500 uppercase">
            План ЗП
          </p>
          <p className="mt-0.5 text-sm font-medium tabular-nums text-emerald-400">
            {draft.calculatedSalary} ₴
          </p>
        </div>
      </div>

      <div className="border-t border-emerald-500/15 px-3.5 py-3">
        {saved ? (
          <div className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-400/30 bg-emerald-500/15 px-3 py-2.5 text-xs font-semibold text-emerald-300">
            <CheckCircle2 className="size-3.5" strokeWidth={2.2} />
            Внесено в Хронологію
          </div>
        ) : (
          <button
            type="button"
            disabled={saving}
            onClick={() => void confirmDraft()}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-300/40 bg-gradient-to-r from-emerald-500 to-emerald-400 px-3 py-2.5 text-xs font-semibold text-zinc-950 shadow-[0_8px_24px_-12px_rgba(16,185,129,0.8)] transition hover:from-emerald-400 hover:to-emerald-300 active:scale-[0.99] disabled:opacity-60"
          >
            {saving ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                Зберігаю…
              </>
            ) : (
              "Підтвердити та внести в Хронологію"
            )}
          </button>
        )}
        {error ? (
          <p className="mt-2 text-[11px] text-red-300">{error}</p>
        ) : null}
      </div>
    </div>
  );
}

function isToolPart(
  part: UIMessage["parts"][number]
): part is UIMessage["parts"][number] & { type: string } {
  return (
    part.type === "dynamic-tool" ||
    (typeof part.type === "string" && part.type.startsWith("tool-"))
  );
}

function toolPartPending(part: UIMessage["parts"][number]): boolean {
  if (part.type === "dynamic-tool") {
    return part.state !== "output-available" && part.state !== "output-error";
  }
  if (typeof part.type === "string" && part.type.startsWith("tool-")) {
    const state =
      "state" in part ? String((part as { state?: string }).state) : "";
    return state !== "output-available" && state !== "output-error";
  }
  return false;
}

function messageHasTools(message: UIMessage): boolean {
  return message.parts.some(isToolPart);
}

function messageHasPendingTools(message: UIMessage): boolean {
  return message.parts.some(toolPartPending);
}

function toolStatusLines(message: UIMessage): string[] {
  const lines: string[] = [];
  for (const part of message.parts) {
    if (part.type === "dynamic-tool") {
      if (
        (part.toolName === "prepareWorkOrder" ||
          part.toolName === "deleteWorkOrder" ||
          part.toolName === "updateFieldDetails" ||
          part.toolName === "writeOffInventoryToField" ||
          part.toolName === "previewInvoiceReceipt" ||
          part.toolName === "previewServiceAct" ||
          part.toolName === "rollbackWarehouseReceipt") &&
        (part.state === "output-available" || part.state === "output-error")
      ) {
        continue;
      }
      const label =
        TOOL_STATUS_LABELS[part.toolName] ?? `Виконую ${part.toolName}…`;
      if (part.state !== "output-available" && part.state !== "output-error") {
        lines.push(label);
      } else {
        lines.push(label.replace("…", " ✓"));
      }
      continue;
    }
    if (typeof part.type === "string" && part.type.startsWith("tool-")) {
      const toolName = part.type.slice("tool-".length);
      const state =
        "state" in part ? String((part as { state?: string }).state) : "";
      if (
        (toolName === "prepareWorkOrder" ||
          toolName === "deleteWorkOrder" ||
          toolName === "updateFieldDetails" ||
          toolName === "writeOffInventoryToField" ||
          toolName === "previewInvoiceReceipt" ||
          toolName === "previewServiceAct" ||
          toolName === "rollbackWarehouseReceipt") &&
        (state === "output-available" || state === "output-error")
      ) {
        continue;
      }
      const label = TOOL_STATUS_LABELS[toolName] ?? `Виконую ${toolName}…`;
      if (state === "output-available" || state === "output-error") {
        lines.push(label.replace("…", " ✓"));
      } else {
        lines.push(label);
      }
    }
  }
  return lines;
}

function AgentAvatar({ live }: { live: boolean }) {
  return (
    <div className="relative size-10 shrink-0">
      <div className="size-full overflow-hidden rounded-2xl ring-1 ring-emerald-400/35">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/icons/levadius-avatar.jpg"
          alt=""
          className="size-full object-cover object-center"
        />
      </div>
      <span
        className={cn(
          "absolute -right-0.5 -bottom-0.5 z-10 size-2.5 rounded-full ring-2 ring-zinc-950",
          live ? "bg-emerald-400" : "bg-zinc-500"
        )}
      />
      {live ? (
        <span className="absolute -right-0.5 -bottom-0.5 z-10 size-2.5 animate-ping rounded-full bg-emerald-400/70" />
      ) : null}
    </div>
  );
}

/** Прелоадер LEVADIUS (як boot Farm OS) — поки профіль/вітання не готові. */
function LevadiusBootOverlay() {
  return (
    <div
      className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-zinc-950"
      aria-busy
      aria-label="Завантаження LEVADIUS"
    >
      <motion.div
        className="relative flex flex-col items-center px-6"
        initial={{ opacity: 0, filter: "blur(10px)" }}
        animate={{
          opacity: 1,
          filter: "blur(0px)",
          transition: { duration: 0.7, ease: "easeOut" },
        }}
      >
        <div className="relative overflow-hidden">
          <h1
            className="text-[1.35rem] font-thin tracking-[0.28em] text-white sm:text-[1.5rem]"
            style={{ fontWeight: 200 }}
          >
            L E V A D I U S
          </h1>
          <motion.span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-emerald-300/50 to-transparent"
            initial={{ x: "-120%", opacity: 0 }}
            animate={{
              x: ["-120%", "220%", "-120%", "220%"],
              opacity: [0, 1, 0, 1, 0],
            }}
            transition={{
              duration: 2.4,
              times: [0, 0.35, 0.5, 0.85, 1],
              ease: "easeInOut",
              delay: 0.35,
            }}
          />
        </div>
        <p className="mt-3 text-[10px] tracking-[0.22em] text-zinc-500 uppercase">
          Готую диспетчера…
        </p>
      </motion.div>
    </div>
  );
}

function MessageBubble({
  message,
  onNavigate,
  onReply,
  onAttachInvoice,
  invoiceFiles,
  replyDisabled = false,
  hideDrafts = false,
}: {
  message: UIMessage;
  onNavigate?: (path: string) => void;
  onReply?: (text: string) => void;
  onAttachInvoice?: () => void;
  invoiceFiles?: File[] | null;
  replyDisabled?: boolean;
  hideDrafts?: boolean;
}) {
  const text = messageText(message);
  const tools = toolStatusLines(message);
  const isUser = message.role === "user";
  const drafts = useMemo(
    () => (isUser || hideDrafts ? [] : extractWorkOrderDrafts(message)),
    [isUser, hideDrafts, message]
  );
  const deleteConfirmations = useMemo(
    () => (isUser ? [] : extractDeleteConfirmations(message)),
    [isUser, message]
  );
  const fieldUpdateConfirmations = useMemo(
    () => (isUser ? [] : extractFieldUpdateConfirmations(message)),
    [isUser, message]
  );
  const receiptRollbackConfirmations = useMemo(
    () => (isUser ? [] : extractReceiptRollbackConfirmations(message)),
    [isUser, message]
  );
  const serviceActDeleteConfirmations = useMemo(
    () => (isUser ? [] : extractServiceActDeleteConfirmations(message)),
    [isUser, message]
  );
  const invoicePreviews = useMemo(
    () => (isUser ? [] : extractInvoicePreviews(message)),
    [isUser, message]
  );
  const serviceActPreviews = useMemo(
    () => (isUser ? [] : extractServiceActPreviews(message)),
    [isUser, message]
  );
  const scoutingDiagnoses = useMemo(
    () => (isUser ? [] : extractScoutingDiagnoses(message)),
    [isUser, message]
  );
  const createdFields = useMemo(
    () => (isUser ? [] : extractCreatedFields(message)),
    [isUser, message]
  );
  const deleteFieldConfirmations = useMemo(
    () => (isUser ? [] : extractDeleteFieldConfirmations(message)),
    [isUser, message]
  );
  const writeOffPreviews = useMemo(
    () => (isUser ? [] : extractInventoryWriteOffPreviews(message)),
    [isUser, message]
  );
  const writeOffDone = useMemo(
    () => (isUser ? null : extractWriteOffPayload(message)),
    [isUser, message]
  );
  const fuelRefuelPreviews = useMemo(
    () => (isUser ? [] : extractFuelRefuelPreviews(message)),
    [isUser, message]
  );
  const fuelRefuelDone = useMemo(
    () => (isUser ? null : extractFuelRefuelPayload(message)),
    [isUser, message]
  );
  const maintenancePreviews = useMemo(
    () => (isUser ? [] : extractMaintenanceCompletedPreviews(message)),
    [isUser, message]
  );
  const maintenanceDone = useMemo(
    () => (isUser ? null : extractMaintenanceCompletedPayload(message)),
    [isUser, message]
  );
  const { body, actions, choices } = useMemo(
    () =>
      isUser
        ? {
            body: text,
            actions: [] as AgentAction[],
            choices: [] as string[],
            dismissDraft: false,
          }
        : extractAgentActions(text),
    [isUser, text]
  );

  /** Кнопки вже є на картках підтвердження / превʼю — CHOICE не дублюємо. */
  const cardOwnedChoiceKeys = useMemo(() => {
    const keys = new Set<string>();
    const own = (value: string | null | undefined) => {
      const key = normalizeChoiceKey(value);
      if (key) keys.add(key);
    };
    for (const item of deleteConfirmations) {
      own(item.confirmChoice);
      own(item.cancelChoice);
    }
    for (const item of fieldUpdateConfirmations) {
      own(item.confirmChoice);
      own(item.cancelChoice);
    }
    for (const item of deleteFieldConfirmations) {
      own(item.confirmChoice);
      own(item.cancelChoice);
    }
    for (const item of writeOffPreviews) {
      own(item.confirmChoice);
      own(item.cancelChoice);
      own("Підтвердити списання на поле");
    }
    for (const item of fuelRefuelPreviews) {
      own(item.confirmChoice);
      own(item.cancelChoice);
      own("Підтвердити заправку");
    }
    for (const item of maintenancePreviews) {
      own(item.confirmChoice);
      own(item.cancelChoice);
      own("Підтвердити ТО");
    }
    for (const item of receiptRollbackConfirmations) {
      own(item.confirmChoice);
      own(item.cancelChoice);
    }
    for (const item of serviceActDeleteConfirmations) {
      own(item.confirmChoice);
      own(item.cancelChoice);
    }
    if (invoicePreviews.length > 0) {
      own("Підтвердити та оприбуткувати");
      own("Оприбуткувати накладну");
      own("Записати на склад");
      own("Скасувати");
    }
    if (serviceActPreviews.length > 0) {
      own("Підтвердити та зберегти акт");
      own("Записати в Бухгалтерію");
      own("Записати акт");
      own("Зберегти акт");
      own("Скасувати");
    }
    return keys;
  }, [
    deleteConfirmations,
    fieldUpdateConfirmations,
    deleteFieldConfirmations,
    writeOffPreviews,
    fuelRefuelPreviews,
    maintenancePreviews,
    receiptRollbackConfirmations,
    serviceActDeleteConfirmations,
    invoicePreviews,
    serviceActPreviews,
  ]);

  const visibleChoices = useMemo(
    () =>
      choices.filter((choice) => {
        if (isAttachInvoiceChoice(choice)) return true;
        const key = normalizeChoiceKey(choice);
        return !key || !cardOwnedChoiceKeys.has(key);
      }),
    [choices, cardOwnedChoiceKeys]
  );

  const visibleActions = useMemo(
    () =>
      actions.filter((action) => {
        if (action.kind !== "reply") return true;
        const key = normalizeChoiceKey(action.text || action.label);
        return !key || !cardOwnedChoiceKeys.has(key);
      }),
    [actions, cardOwnedChoiceKeys]
  );

  if (
    !body &&
    tools.length === 0 &&
    visibleActions.length === 0 &&
    visibleChoices.length === 0 &&
    drafts.length === 0 &&
    deleteConfirmations.length === 0 &&
    fieldUpdateConfirmations.length === 0 &&
    receiptRollbackConfirmations.length === 0 &&
    serviceActDeleteConfirmations.length === 0 &&
    invoicePreviews.length === 0 &&
    serviceActPreviews.length === 0
  ) {
    return null;
  }

  return (
    <div
      className={cn(
        "flex w-full",
        isUser ? "justify-end" : "justify-start"
      )}
    >
      <div
        className={cn(
          "min-w-0 max-w-[92%] space-y-2",
          isUser ? "w-auto items-end" : "w-full items-start"
        )}
      >
        {tools.length > 0 ? (
          <div className="space-y-1.5">
            {tools.map((line, index) => (
              <div
                key={`${message.id}-tool-${index}`}
                className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-amber-400/20 bg-amber-400/10 px-2.5 py-1 text-[11px] font-medium text-amber-200"
              >
                <Zap className="size-3 shrink-0" />
                <span className="min-w-0 break-words">{line}</span>
              </div>
            ))}
          </div>
        ) : null}
        {body ? (
          <div
            data-allow-select="true"
            className={cn(
              "min-w-0 max-w-full rounded-2xl px-3.5 py-2.5 select-text",
              isUser
                ? "whitespace-pre-wrap break-words bg-emerald-500 text-sm leading-relaxed text-zinc-950"
                : "overflow-hidden border border-white/10 bg-white/[0.05]"
            )}
          >
            {isUser ? body : <AgentMarkdown text={body} accent />}
          </div>
        ) : null}
        {!isUser && writeOffPreviews.length > 0 ? (
          <div className="space-y-2">
            {writeOffPreviews.map((item) => (
              <InventoryWriteOffCard
                key={`${message.id}-wo-${item.itemId}-${item.quantity}`}
                item={item}
                onReply={onReply}
                disabled={replyDisabled}
                alreadyWrittenOff={
                  writeOffDone != null &&
                  writeOffDone.itemId === item.itemId &&
                  Math.abs(writeOffDone.quantity - item.quantity) < 0.0001
                }
              />
            ))}
          </div>
        ) : null}
        {!isUser && fuelRefuelPreviews.length > 0 ? (
          <div className="space-y-2">
            {fuelRefuelPreviews.map((item) => (
              <FuelRefuelCard
                key={`${message.id}-fuel-${item.equipmentId}-${item.storageId}-${item.liters}`}
                item={item}
                onReply={onReply}
                disabled={replyDisabled}
                alreadyRefueled={
                  fuelRefuelDone != null &&
                  fuelRefuelDone.equipmentId === item.equipmentId &&
                  fuelRefuelDone.storageId === item.storageId &&
                  Math.abs(fuelRefuelDone.liters - item.liters) < 0.0001
                }
              />
            ))}
          </div>
        ) : null}
        {!isUser && maintenancePreviews.length > 0 ? (
          <div className="space-y-2">
            {maintenancePreviews.map((item) => (
              <MaintenanceCompletedCard
                key={`${message.id}-maint-${item.equipmentId}-${item.serviceType}`}
                item={item}
                onReply={onReply}
                disabled={replyDisabled}
                alreadyDone={
                  maintenanceDone != null &&
                  maintenanceDone.equipmentId === item.equipmentId &&
                  maintenanceDone.serviceType === item.serviceType
                }
              />
            ))}
          </div>
        ) : null}
        {!isUser && createdFields.length > 0 ? (
          <div className="space-y-2">
            {createdFields.map((item) => (
              <CreatedFieldCard
                key={`${message.id}-create-${item.fieldId}`}
                item={item}
                onNavigate={onNavigate}
              />
            ))}
          </div>
        ) : null}
        {!isUser && deleteFieldConfirmations.length > 0 ? (
          <div className="space-y-2">
            {deleteFieldConfirmations.map((item) => (
              <DeleteFieldConfirmCard
                key={`${message.id}-delfield-${item.fieldId}`}
                item={item}
                onReply={onReply}
                disabled={replyDisabled}
              />
            ))}
          </div>
        ) : null}
        {!isUser && scoutingDiagnoses.length > 0 ? (
          <div className="space-y-2">
            {scoutingDiagnoses.map((item) => (
              <ScoutingDiagnosisCard
                key={`${message.id}-scout-${item.reportId}`}
                item={item}
              />
            ))}
          </div>
        ) : null}
        {!isUser && drafts.length > 0 ? (
          <div className="space-y-2">
            {drafts.map((draft) => (
              <WorkOrderDraftCard key={draft.draftId} draft={draft} />
            ))}
          </div>
        ) : null}
        {!isUser && deleteConfirmations.length > 0 ? (
          <div className="space-y-2">
            {deleteConfirmations.map((item) => (
              <DeleteWorkOrderCard
                key={`${message.id}-del-${item.workOrderId}`}
                item={item}
                onReply={onReply}
                disabled={replyDisabled}
              />
            ))}
          </div>
        ) : null}
        {!isUser && fieldUpdateConfirmations.length > 0 ? (
          <div className="space-y-2">
            {fieldUpdateConfirmations.map((item) => (
              <FieldUpdateConfirmCard
                key={`${message.id}-field-upd-${item.fieldId}`}
                item={item}
                onReply={onReply}
                disabled={replyDisabled}
              />
            ))}
          </div>
        ) : null}
        {!isUser && receiptRollbackConfirmations.length > 0 ? (
          <div className="space-y-2">
            {receiptRollbackConfirmations.map((item) => (
              <ReceiptRollbackConfirmCard
                key={`${message.id}-rcpt-rb-${item.receiptId}`}
                item={item}
                onReply={onReply}
                disabled={replyDisabled}
              />
            ))}
          </div>
        ) : null}
        {!isUser && serviceActDeleteConfirmations.length > 0 ? (
          <div className="space-y-2">
            {serviceActDeleteConfirmations.map((item) => (
              <ServiceActDeleteConfirmCard
                key={`${message.id}-act-del-${item.actIds.join("-")}`}
                item={item}
                onReply={onReply}
                disabled={replyDisabled}
              />
            ))}
          </div>
        ) : null}
        {!isUser && invoicePreviews.length > 0 ? (
          <div className="space-y-2">
            {invoicePreviews.map((invoice) => (
              <InvoicePreviewCard
                key={`${message.id}-inv-${invoice.receiptId}`}
                invoice={invoice}
                invoiceFiles={invoiceFiles}
              />
            ))}
          </div>
        ) : null}
        {!isUser && serviceActPreviews.length > 0 ? (
          <div className="space-y-2">
            {serviceActPreviews.map((act) => (
              <ServiceActPreviewCard
                key={`${message.id}-act-${act.previewId}`}
                act={act}
                actFiles={invoiceFiles}
              />
            ))}
          </div>
        ) : null}
        {!isUser && visibleChoices.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {visibleChoices.map((choice, index) => (
              <button
                key={`${message.id}-choice-${index}-${choice}`}
                type="button"
                disabled={replyDisabled}
                onClick={() => {
                  if (isAttachInvoiceChoice(choice)) {
                    onAttachInvoice?.();
                    return;
                  }
                  onReply?.(choice);
                }}
                className="rounded-xl border border-white/10 bg-zinc-800/80 px-3 py-1.5 text-xs font-medium text-zinc-200 shadow-sm transition-all hover:border-emerald-500/30 hover:bg-emerald-500/20 hover:text-emerald-300 active:scale-95 disabled:pointer-events-none disabled:opacity-50"
              >
                {isAttachInvoiceChoice(choice) ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Paperclip className="size-3.5 shrink-0" />
                    Прикріпити накладну
                  </span>
                ) : (
                  choice
                )}
              </button>
            ))}
          </div>
        ) : null}
        {!isUser && visibleActions.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {visibleActions.map((action, index) => {
              const ActionIcon = action.icon
                ? IconMap[action.icon]
                : ArrowUpRight;
              const key =
                action.kind === "navigate"
                  ? `${message.id}-nav-${index}-${action.path}`
                  : `${message.id}-reply-${index}-${action.label}`;
              return (
                <button
                  key={key}
                  type="button"
                  disabled={
                    action.kind === "reply" ? replyDisabled : false
                  }
                  onClick={() => {
                    if (action.kind === "navigate") onNavigate?.(action.path);
                    else onReply?.(action.text);
                  }}
                  className="inline-flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-400 transition-all hover:bg-emerald-500/20 active:scale-95 disabled:pointer-events-none disabled:opacity-50"
                >
                  <ActionIcon className="size-3.5 shrink-0" strokeWidth={2.2} />
                  {action.label}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function LevadaCopilotDrawer({
  open,
  onOpenChange,
  variant = "drawer",
}: LevadaCopilotDrawerProps) {
  const fullscreen = variant === "fullscreen";
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const isMobile = useIsMobile();
  const effectiveOpen = fullscreen ? true : open;
  const [me, setMe] = useState<AppActor | null>(null);
  const [bootReady, setBootReady] = useState(false);
  const [input, setInput] = useState("");
  const [welcome, setWelcome] = useState<{ hi: string; tip: string } | null>(
    null
  );
  const frozenWelcomeRef = useRef<{ hi: string; tip: string } | null>(null);
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [compressingAttach, setCompressingAttach] = useState(false);
  const [dragOverComposer, setDragOverComposer] = useState(false);
  /** Файли накладної/акта після відправки в чат — щоб прикріпити при оприбуткуванні */
  const [lastInvoiceFiles, setLastInvoiceFiles] = useState<File[]>([]);
  const lastInvoiceFilesRef = useRef<File[]>([]);
  const listRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dragDepthRef = useRef(0);
  const dropLockRef = useRef(false);
  const activeFieldId = searchParams.get("field");

  function resizeComposerTextarea() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const styles = window.getComputedStyle(el);
    const lineHeight = Number.parseFloat(styles.lineHeight) || 24;
    const padY =
      (Number.parseFloat(styles.paddingTop) || 0) +
      (Number.parseFloat(styles.paddingBottom) || 0);
    const minH = lineHeight + padY;
    // ~10 рядків або 40% екрана — далі скрол зверху, як у Gemini
    const maxH = Math.min(
      lineHeight * 10 + padY,
      Math.round(window.innerHeight * 0.4)
    );
    const next = Math.min(Math.max(el.scrollHeight, minH), maxH);
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > maxH + 1 ? "auto" : "hidden";
  }

  useEffect(() => {
    resizeComposerTextarea();
  }, [input, effectiveOpen, fullscreen]);

  useEffect(() => {
    return () => {
      for (const item of attachments) {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      }
    };
  }, [attachments]);

  function openFilePicker() {
    setAttachError(null);
    fileInputRef.current?.click();
  }

  function clearAttachments() {
    setAttachments((prev) => {
      for (const item of prev) {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      }
      return [];
    });
    setAttachError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removeAttachment(id: string) {
    setAttachments((prev) => {
      const next: PendingAttachment[] = [];
      for (const item of prev) {
        if (item.id === id) {
          if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
          continue;
        }
        next.push(item);
      }
      return next;
    });
    setAttachError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function addFiles(rawFiles: File[]) {
    if (rawFiles.length === 0) return;

    setAttachError(null);
    setCompressingAttach(true);

    let errorMsg: string | null = null;
    let prepared: File[] = [];

    try {
      const needsCompress = rawFiles.some((f) => f.type.startsWith("image/"));
      prepared = needsCompress
        ? await compressAgentFiles(rawFiles)
        : rawFiles;
    } catch {
      prepared = rawFiles;
      errorMsg = "Не вдалося стиснути фото — пробую як є.";
    } finally {
      setCompressingAttach(false);
    }

    setAttachments((prev) => {
      const room = MAX_PENDING_ATTACHMENTS - prev.length;
      if (room <= 0) {
        errorMsg = `Максимум ${MAX_PENDING_ATTACHMENTS} файлів за раз.`;
        return prev;
      }

      const accepted: PendingAttachment[] = [];
      let truncated = false;

      for (const file of prepared) {
        if (accepted.length >= room) {
          truncated = true;
          break;
        }
        if (file.size > MAX_ATTACHMENT_BYTES) {
          errorMsg = `«${file.name}» завеликий навіть після стиснення.`;
          continue;
        }
        if (!isAcceptedAgentFile(file)) {
          errorMsg = `«${file.name}» — лише зображення або PDF.`;
          continue;
        }
        const duplicate = prev.some(
          (p) =>
            p.file.name === file.name &&
            p.file.size === file.size &&
            p.file.lastModified === file.lastModified
        );
        if (duplicate) continue;
        if (
          accepted.some(
            (p) =>
              p.file.name === file.name &&
              p.file.size === file.size &&
              p.file.lastModified === file.lastModified
          )
        ) {
          continue;
        }

        const isImage = file.type.startsWith("image/");
        accepted.push({
          id: `${file.name}-${file.size}-${file.lastModified}-${accepted.length}`,
          file,
          previewUrl: isImage ? URL.createObjectURL(file) : null,
        });
      }

      if (truncated && !errorMsg) {
        errorMsg = `Додано лише ${room} з ${prepared.length} (ліміт ${MAX_PENDING_ATTACHMENTS}).`;
      }

      return accepted.length > 0 ? [...prev, ...accepted] : prev;
    });

    setAttachError(errorMsg);
  }

  function onFileSelected(event: ChangeEvent<HTMLInputElement>) {
    const list = event.target.files ? Array.from(event.target.files) : [];
    void addFiles(list);
    event.target.value = "";
  }

  function onComposerDragEnter(event: DragEvent) {
    const types = Array.from(event.dataTransfer?.types ?? []);
    if (!types.includes("Files")) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current += 1;
    setDragOverComposer(true);
  }

  function onComposerDragLeave(event: DragEvent) {
    const types = Array.from(event.dataTransfer?.types ?? []);
    if (!types.includes("Files")) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDragOverComposer(false);
  }

  function onComposerDragOver(event: DragEvent) {
    const types = Array.from(event.dataTransfer?.types ?? []);
    if (!types.includes("Files")) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
  }

  function onComposerDrop(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = 0;
    setDragOverComposer(false);
    if (busy || compressingAttach || dropLockRef.current) return;
    dropLockRef.current = true;
    window.setTimeout(() => {
      dropLockRef.current = false;
    }, 400);
    void addFiles(filesFromDataTransfer(event.dataTransfer));
  }

  function onComposerPaste(event: ClipboardEvent) {
    const items = event.clipboardData?.items;
    if (!items?.length) return;
    const files: File[] = [];
    for (const item of Array.from(items)) {
      if (item.kind !== "file") continue;
      const file = item.getAsFile();
      if (file) files.push(file);
    }
    if (files.length === 0) return;
    event.preventDefault();
    void addFiles(files);
  }

  useEffect(() => {
    lastInvoiceFilesRef.current = lastInvoiceFiles;
  }, [lastInvoiceFiles]);

  useEffect(() => {
    let cancelled = false;
    const startedAt = Date.now();
    void getMyProfileAction()
      .then((actor) => {
        if (cancelled) return;
        setMe(actor);
        const wait = Math.max(0, 420 - (Date.now() - startedAt));
        window.setTimeout(() => {
          if (!cancelled) setBootReady(true);
        }, wait);
      })
      .catch(() => {
        if (cancelled) return;
        const wait = Math.max(0, 420 - (Date.now() - startedAt));
        window.setTimeout(() => {
          if (!cancelled) setBootReady(true);
        }, wait);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Вітання фіксуємо один раз на відкриття — не стрибає, коли підвантажився профіль / змінився field
  useLayoutEffect(() => {
    if (!effectiveOpen) {
      frozenWelcomeRef.current = null;
      setWelcome(null);
      return;
    }
    if (!bootReady) return;
    if (frozenWelcomeRef.current) {
      setWelcome((prev) => prev ?? frozenWelcomeRef.current);
      return;
    }
    const next = pickWelcomeGreeting({
      seed: Math.floor(Math.random() * 1000),
      name: greetingFirstName(me),
      pathname: pathname || "/",
      hasField: Boolean(activeFieldId),
    });
    frozenWelcomeRef.current = next;
    setWelcome(next);
  }, [effectiveOpen, bootReady, me, pathname, activeFieldId]);

  useEffect(() => {
    liveUserContext = {
      pathname,
      ...(activeFieldId ? { activeFieldId } : {}),
      userName: me?.fullName || me?.label || "Користувач",
      userRole: roleBadgeLabel(me?.role),
    };
  }, [pathname, activeFieldId, me]);

  const showBoot = !bootReady || (effectiveOpen && !welcome);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/agent",
        // iOS standalone PWA: явно слати cookies (інакше /api/agent → 401)
        credentials: "include",
        prepareSendMessagesRequest({ id, messages, body, trigger, messageId }) {
          return {
            body: {
              ...(body && typeof body === "object" ? body : {}),
              id,
              messages,
              trigger,
              messageId,
              userContext: {
                ...liveUserContext,
                client: fullscreen ? "pwa" : "drawer",
              },
            },
          };
        },
      }),
    [fullscreen]
  );

  const { messages, sendMessage, status, error, stop, setMessages, clearError } =
    useChat({
      id: fullscreen ? "levadius-copilot-pwa" : "levadius-copilot",
      transport,
    });

  const busy = status === "submitted" || status === "streaming";

  const refreshedFieldUpdateKeysRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (status === "streaming" || status === "submitted") return;
    for (const message of messages) {
      if (message.role !== "assistant") continue;
      const updated = extractUpdatedFieldPayload(message);
      if (updated) {
        const key = `field:${message.id}:${updated.id}:${updated.name}`;
        if (!refreshedFieldUpdateKeysRef.current.has(key)) {
          refreshedFieldUpdateKeysRef.current.add(key);
          router.refresh();
          window.dispatchEvent(
            new CustomEvent("field-updated", { detail: updated })
          );
          window.dispatchEvent(new CustomEvent("levada:fields-updated"));
        }
      }
      const writeOff = extractWriteOffPayload(message);
      if (writeOff) {
        const key = `wo:${message.id}:${writeOff.itemId}:${writeOff.quantity}`;
        if (!refreshedFieldUpdateKeysRef.current.has(key)) {
          refreshedFieldUpdateKeysRef.current.add(key);
          router.refresh();
          window.dispatchEvent(
            new CustomEvent("warehouse-updated", {
              detail: {
                itemId: writeOff.itemId,
                itemName: writeOff.itemName,
                quantity: writeOff.quantity,
                unit: writeOff.unit,
                newStockBalance: writeOff.newStockBalance,
              },
            })
          );
          if (writeOff.fieldId) {
            window.dispatchEvent(
              new CustomEvent("field-updated", {
                detail: { id: writeOff.fieldId },
              })
            );
            window.dispatchEvent(new CustomEvent("levada:fields-updated"));
          }
        }
      }

      const priceUpd = extractInventoryPriceUpdatePayload(message);
      if (priceUpd) {
        const key = `price:${message.id}:${priceUpd.itemId}:${priceUpd.newPrice}`;
        if (!refreshedFieldUpdateKeysRef.current.has(key)) {
          refreshedFieldUpdateKeysRef.current.add(key);
          router.refresh();
          window.dispatchEvent(
            new CustomEvent("warehouse-updated", {
              detail: {
                itemId: priceUpd.itemId,
                itemName: priceUpd.itemName,
                newPrice: priceUpd.newPrice,
              },
            })
          );
          for (const fieldId of priceUpd.fieldsAffected.slice(0, 20)) {
            window.dispatchEvent(
              new CustomEvent("field-updated", { detail: { id: fieldId } })
            );
          }
          if (priceUpd.fieldsAffected.length > 0) {
            window.dispatchEvent(new CustomEvent("levada:fields-updated"));
          }
        }
      }

      const fuelRefuel = extractFuelRefuelPayload(message);
      if (fuelRefuel) {
        const key = `fuel:${message.id}:${fuelRefuel.transactionId ?? fuelRefuel.equipmentId}:${fuelRefuel.liters}`;
        if (!refreshedFieldUpdateKeysRef.current.has(key)) {
          refreshedFieldUpdateKeysRef.current.add(key);
          router.refresh();
          window.dispatchEvent(
            new CustomEvent("fuel-updated", {
              detail: {
                transactionId: fuelRefuel.transactionId,
                equipmentId: fuelRefuel.equipmentId,
                equipmentName: fuelRefuel.equipmentName,
                storageId: fuelRefuel.storageId,
                storageName: fuelRefuel.storageName,
                liters: fuelRefuel.liters,
                volumeAfter: fuelRefuel.volumeAfter,
              },
            })
          );
        }
      }

      const linkedAct = extractLinkedServiceActPayload(message);
      if (linkedAct) {
        const key = `linkact:${message.id}:${linkedAct.actId}:${linkedAct.equipmentId}`;
        if (!refreshedFieldUpdateKeysRef.current.has(key)) {
          refreshedFieldUpdateKeysRef.current.add(key);
          router.refresh();
          window.dispatchEvent(
            new CustomEvent("accounting-updated", { detail: linkedAct })
          );
          window.dispatchEvent(
            new CustomEvent("equipment-updated", {
              detail: { id: linkedAct.equipmentId },
            })
          );
        }
      }

      const maintDone = extractMaintenanceCompletedPayload(message);
      if (maintDone) {
        const key = `maint:${message.id}:${maintDone.equipmentId}:${maintDone.serviceType}:${maintDone.nextServiceHours}`;
        if (!refreshedFieldUpdateKeysRef.current.has(key)) {
          refreshedFieldUpdateKeysRef.current.add(key);
          router.refresh();
          window.dispatchEvent(
            new CustomEvent("equipment-updated", { detail: maintDone })
          );
        }
      }

      const closedOp = extractClosedWorkOrderPayload(message);
      if (closedOp) {
        const key = `close:${message.id}:${closedOp.workOrderId}:${closedOp.factArea}`;
        if (!refreshedFieldUpdateKeysRef.current.has(key)) {
          refreshedFieldUpdateKeysRef.current.add(key);
          router.refresh();
          window.dispatchEvent(
            new CustomEvent("field-updated", {
              detail: { id: closedOp.fieldId },
            })
          );
          window.dispatchEvent(new CustomEvent("levada:fields-updated"));
        }
      }

      const budgetOp = extractBudgetUpdatePayload(message);
      if (budgetOp) {
        const key = `budget:${message.id}:${budgetOp.fieldId}:${budgetOp.plannedBudgetPerHa}`;
        if (!refreshedFieldUpdateKeysRef.current.has(key)) {
          refreshedFieldUpdateKeysRef.current.add(key);
          router.refresh();
          window.dispatchEvent(
            new CustomEvent("field-updated", {
              detail: { id: budgetOp.fieldId },
            })
          );
          window.dispatchEvent(new CustomEvent("levada:fields-updated"));
        }
      }

      const geofenceSync = extractGeofenceSyncPayload(message);
      if (geofenceSync) {
        const key = `geofence:${message.id}:${geofenceSync.fieldId}:${geofenceSync.wialonGeofenceId}`;
        if (!refreshedFieldUpdateKeysRef.current.has(key)) {
          refreshedFieldUpdateKeysRef.current.add(key);
          router.refresh();
          window.dispatchEvent(
            new CustomEvent("field-updated", {
              detail: {
                id: geofenceSync.fieldId,
                wialonZoneId: geofenceSync.wialonGeofenceId,
              },
            })
          );
          window.dispatchEvent(new CustomEvent("levada:fields-updated"));
        }
      }

      for (const scout of extractScoutingDiagnoses(message)) {
        const key = `scout:${message.id}:${scout.reportId}`;
        if (refreshedFieldUpdateKeysRef.current.has(key)) continue;
        refreshedFieldUpdateKeysRef.current.add(key);
        router.refresh();
        window.dispatchEvent(
          new CustomEvent("field-updated", {
            detail: { id: scout.fieldId },
          })
        );
        window.dispatchEvent(new CustomEvent("levada:fields-updated"));
      }

      for (const created of extractCreatedFields(message)) {
        const key = `createfield:${message.id}:${created.fieldId}`;
        if (refreshedFieldUpdateKeysRef.current.has(key)) continue;
        refreshedFieldUpdateKeysRef.current.add(key);
        router.refresh();
        window.dispatchEvent(
          new CustomEvent("field-updated", {
            detail: {
              id: created.fieldId,
              name: created.name,
              area: created.area,
              crop: created.crop,
            },
          })
        );
        window.dispatchEvent(new CustomEvent("levada:fields-updated"));
      }

      const deletedField = extractDeletedOrArchivedFieldPayload(message);
      if (deletedField) {
        const key = `delfield:${message.id}:${deletedField.fieldId}:${deletedField.status}`;
        if (!refreshedFieldUpdateKeysRef.current.has(key)) {
          refreshedFieldUpdateKeysRef.current.add(key);
          router.refresh();
          window.dispatchEvent(
            new CustomEvent("field-updated", {
              detail: { id: deletedField.fieldId, status: deletedField.status },
            })
          );
          window.dispatchEvent(new CustomEvent("levada:fields-updated"));
        }
      }

      const focusField = extractFocusFieldPayload(message);
      if (focusField) {
        const key = `focus:${message.id}:${focusField.fieldId}`;
        if (!refreshedFieldUpdateKeysRef.current.has(key)) {
          refreshedFieldUpdateKeysRef.current.add(key);
          const path = focusField.openFieldPath.startsWith("/")
            ? focusField.openFieldPath
            : `/?field=${focusField.fieldId}`;
          // Не закриваємо drawer примусово — лише фокус карти
          if (pathname === "/" || pathname === "") {
            router.replace(path);
          } else {
            router.push(path);
          }
          window.setTimeout(() => {
            window.dispatchEvent(
              new CustomEvent("focus-field-map", {
                detail: { fieldId: focusField.fieldId },
              })
            );
            window.dispatchEvent(
              new CustomEvent(LEVADA_OPEN_FIELD_EVENT, {
                detail: { fieldId: focusField.fieldId },
              })
            );
          }, 80);
        }
      }

      for (const part of message.parts) {
        const isExec =
          part.type === "tool-executeWarehouseReceipt" ||
          (part.type === "dynamic-tool" &&
            "toolName" in part &&
            part.toolName === "executeWarehouseReceipt");
        if (!isExec) continue;
        if (!("state" in part) || part.state !== "output-available") continue;
        if (
          !("output" in part) ||
          !part.output ||
          typeof part.output !== "object"
        ) {
          continue;
        }
        const raw = part.output as { success?: boolean; receiptId?: string };
        if (raw.success !== true) continue;
        const key = `rcpt:${message.id}:${raw.receiptId ?? "ok"}`;
        if (refreshedFieldUpdateKeysRef.current.has(key)) continue;
        refreshedFieldUpdateKeysRef.current.add(key);
        router.refresh();
        window.dispatchEvent(
          new CustomEvent("warehouse-updated", { detail: raw })
        );
      }

      if (messageHasRolledBackReceipt(message)) {
        const key = `rcpt-rb:${message.id}`;
        if (!refreshedFieldUpdateKeysRef.current.has(key)) {
          refreshedFieldUpdateKeysRef.current.add(key);
          router.refresh();
          window.dispatchEvent(new Event("warehouse-updated"));
        }
      }

      if (messageHasDeletedServiceActs(message)) {
        const key = `act-del:${message.id}`;
        if (!refreshedFieldUpdateKeysRef.current.has(key)) {
          refreshedFieldUpdateKeysRef.current.add(key);
          router.refresh();
          window.dispatchEvent(new Event("accounting-updated"));
        }
      }

      for (const part of message.parts) {
        const isAct =
          part.type === "tool-executeServiceActSave" ||
          (part.type === "dynamic-tool" &&
            "toolName" in part &&
            part.toolName === "executeServiceActSave");
        if (!isAct) continue;
        if (!("state" in part) || part.state !== "output-available") continue;
        if (
          !("output" in part) ||
          !part.output ||
          typeof part.output !== "object"
        ) {
          continue;
        }
        const raw = part.output as {
          success?: boolean;
          actId?: string;
          equipmentId?: string | null;
        };
        if (raw.success !== true) continue;
        const key = `act:${message.id}:${raw.actId ?? "ok"}`;
        if (refreshedFieldUpdateKeysRef.current.has(key)) continue;
        refreshedFieldUpdateKeysRef.current.add(key);
        const actId = typeof raw.actId === "string" ? raw.actId : null;
        const files = lastInvoiceFilesRef.current;
        if (actId && files.length > 0) {
          void Promise.all(files.map((f) => fileToBase64Payload(f)))
            .then((attachmentsPayload) =>
              attachServiceActDocumentsAction({
                actId,
                attachments: attachmentsPayload,
              })
            )
            .catch(() => null)
            .finally(() => {
              router.refresh();
              window.dispatchEvent(
                new CustomEvent("accounting-updated", { detail: raw })
              );
            });
        } else {
          router.refresh();
          window.dispatchEvent(
            new CustomEvent("accounting-updated", { detail: raw })
          );
        }
        if (raw.equipmentId) {
          window.dispatchEvent(
            new CustomEvent("equipment-updated", {
              detail: { equipmentId: raw.equipmentId },
            })
          );
        }
      }
    }
  }, [messages, status, router, pathname]);

  const hideDraftCards = useMemo(
    () =>
      messages.some((message) => {
        if (message.role !== "assistant") return false;
        return extractAgentActions(messageText(message)).dismissDraft;
      }),
    [messages]
  );

  const lastAssistant = useMemo(
    () => [...messages].reverse().find((message) => message.role === "assistant"),
    [messages]
  );

  const lastAssistantText = lastAssistant ? messageText(lastAssistant) : "";
  const lastHasTools = lastAssistant ? messageHasTools(lastAssistant) : false;
  const lastHasPendingTools = lastAssistant
    ? messageHasPendingTools(lastAssistant)
    : false;

  // Не дублюємо «думає…», коли вже видно tool-статус або текст стрімиться.
  // Після завершення tools і до тексту — короткий статус «формує відповідь».
  const showThinking =
    status === "submitted" ||
    (status === "streaming" &&
      !lastHasPendingTools &&
      !lastAssistantText &&
      !lastHasTools);

  const showComposing =
    status === "streaming" &&
    lastHasTools &&
    !lastHasPendingTools &&
    !lastAssistantText;

  useEffect(() => {
    if (!effectiveOpen) return;
    const node = listRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [messages, status, effectiveOpen]);

  function handleNavigate(path: string) {
    const normalized = normalizeAgentPath(path);
    const fieldId = extractFieldIdFromAgentPath(normalized);
    onOpenChange(false);
    router.push(normalized);
    if (fieldId) {
      // Навіть якщо ?field= уже стоїть — форсуємо центрування/шторку паспорта
      window.setTimeout(() => {
        window.dispatchEvent(
          new CustomEvent(LEVADA_OPEN_FIELD_EVENT, {
            detail: { fieldId },
          })
        );
      }, 120);
    }
  }

  async function submitText(text: string, files?: File[]) {
    const trimmed = text.trim();
    const fileList = files?.length
      ? (() => {
          const dt = new DataTransfer();
          for (const file of files) dt.items.add(file);
          return dt.files;
        })()
      : attachments.length > 0
        ? (() => {
            const dt = new DataTransfer();
            for (const item of attachments) dt.items.add(item.file);
            return dt.files;
          })()
        : undefined;

    if ((!trimmed && !fileList?.length) || busy || compressingAttach) return;
    if (fileList?.length) {
      setLastInvoiceFiles(Array.from(fileList));
    }
    setInput("");
    clearError();
    clearAttachments();
    await sendMessage({
      text:
        trimmed ||
        (fileList?.length
          ? fileList.length > 1
            ? `Ось ${fileList.length} документи для опрацювання.`
            : "Ось накладна / документ для оприбуткування на склад."
          : ""),
      ...(fileList?.length ? { files: fileList } : {}),
    });
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void submitText(input);
  }

  const panel = (
    <div
      className={cn(
        "relative flex min-h-0 flex-col overflow-hidden bg-zinc-950 text-zinc-50",
        fullscreen
          ? "h-[100dvh] w-full border-0"
          : cn(
              "h-full border-white/10 bg-zinc-950/90 shadow-2xl backdrop-blur-xl",
              isMobile ? "rounded-t-3xl border-t" : "rounded-l-3xl border-l"
            )
      )}
    >
      {showBoot ? <LevadiusBootOverlay /> : null}

      <header
        className={cn(
          "flex shrink-0 items-center gap-3 border-b border-white/10 px-4",
          fullscreen
            ? "pt-[max(0.75rem,env(safe-area-inset-top))] pb-3"
            : "py-3",
          showBoot && "invisible"
        )}
      >
        <AgentAvatar live={busy || effectiveOpen} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-sm font-semibold tracking-tight">
              LEVADIUS
            </h2>
            <span className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-bold tracking-[0.12em] text-emerald-300 uppercase">
              LIVE
            </span>
          </div>
        </div>
        {fullscreen ? (
          <button
            type="button"
            onClick={() => setMessages([])}
            disabled={messages.length === 0}
            className="inline-flex size-9 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-zinc-300 transition hover:bg-white/10 hover:text-white disabled:opacity-40"
            aria-label="Очистити діалог"
            title="Очистити діалог"
          >
            <Eraser className="size-4" />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="inline-flex size-9 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-zinc-300 transition hover:bg-white/10 hover:text-white"
            aria-label="Закрити LEVADIUS"
          >
            <X className="size-4" />
          </button>
        )}
      </header>

      <div
        ref={listRef}
        data-allow-select="true"
        className="custom-scrollbar min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-4 select-text"
      >
        {messages.length === 0 && welcome ? (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-5">
            <p className="text-sm font-medium text-zinc-100">{welcome.hi}</p>
            <p className="mt-1 text-sm leading-relaxed text-zinc-400">
              {welcome.tip}
            </p>
          </div>
        ) : null}

        {messages.map((message) => (
          <MessageBubble
            key={message.id}
            message={message}
            onNavigate={handleNavigate}
            onReply={(text) => void submitText(text)}
            onAttachInvoice={openFilePicker}
            invoiceFiles={lastInvoiceFiles}
            replyDisabled={busy}
            hideDrafts={hideDraftCards}
          />
        ))}

        {showThinking ? (
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-zinc-400">
            <Loader2 className="size-3.5 animate-spin text-emerald-300" />
            LEVADIUS думає…
          </div>
        ) : null}

        {showComposing ? (
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-zinc-400">
            <Loader2 className="size-3.5 animate-spin text-emerald-300" />
            Формую відповідь…
          </div>
        ) : null}

        {error || status === "error" ? (
          <div className="space-y-2 rounded-2xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            <p>{formatChatError(error)}</p>
            <button
              type="button"
              onClick={() => clearError()}
              className="text-xs font-medium text-red-100/80 underline-offset-2 hover:underline"
            >
              Закрити помилку
            </button>
          </div>
        ) : null}
      </div>

      <div
        className={cn(
          "shrink-0 border-t border-white/10 px-3 pt-3",
          fullscreen
            ? "pb-[max(0.75rem,env(safe-area-inset-bottom))]"
            : "pb-[max(0.75rem,env(safe-area-inset-bottom))]",
          dragOverComposer && "bg-emerald-500/[0.04]"
        )}
        onDragEnter={onComposerDragEnter}
        onDragLeave={onComposerDragLeave}
        onDragOver={onComposerDragOver}
        onDrop={onComposerDrop}
      >
        {messages.length === 0 ? (
          <div className="mb-3 flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {QUICK_CHIPS.map((chip) => (
              <button
                key={chip}
                type="button"
                disabled={busy}
                onClick={() => void submitText(chip)}
                className="shrink-0 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-zinc-300 transition hover:border-emerald-400/30 hover:bg-emerald-400/10 hover:text-emerald-100 disabled:opacity-50"
              >
                {chip}
              </button>
            ))}
          </div>
        ) : null}

        {attachments.length > 0 || attachError || compressingAttach ? (
          <div className="mb-2 space-y-1.5">
            {compressingAttach ? (
              <p className="flex items-center gap-1.5 px-1 text-[11px] text-zinc-400">
                <Loader2 className="size-3 animate-spin text-emerald-300" />
                Стискаю фото перед відправкою…
              </p>
            ) : null}
            {attachments.length > 0 ? (
              <div className="flex gap-1.5 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {attachments.map((item) => (
                  <div
                    key={item.id}
                    className="flex min-w-[9.5rem] max-w-[11rem] shrink-0 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-2 py-1.5"
                  >
                    {item.previewUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={item.previewUrl}
                        alt=""
                        className="size-9 shrink-0 rounded-lg object-cover"
                      />
                    ) : (
                      <div className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-zinc-800 text-zinc-300">
                        <FileText className="size-4" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-zinc-200">
                        {item.file.name}
                      </p>
                      <p className="text-[10px] text-zinc-500">
                        {formatFileKib(item.file.size)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeAttachment(item.id)}
                      className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-zinc-400 transition hover:bg-white/10 hover:text-white"
                      aria-label="Видалити файл"
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                ))}
                {attachments.length > 1 ? (
                  <button
                    type="button"
                    onClick={clearAttachments}
                    className="inline-flex shrink-0 items-center rounded-xl px-2 text-[11px] font-medium text-zinc-500 transition hover:text-zinc-200"
                  >
                    Очистити
                  </button>
                ) : null}
              </div>
            ) : null}
            {attachError ? (
              <p className="px-1 text-[11px] text-red-300">{attachError}</p>
            ) : null}
          </div>
        ) : null}

        <form
          onSubmit={onSubmit}
          className={cn(
            "relative flex items-end gap-2 rounded-2xl transition",
            dragOverComposer &&
              "ring-2 ring-emerald-400/50 ring-offset-2 ring-offset-zinc-950"
          )}
        >
          {dragOverComposer ? (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-2xl border border-dashed border-emerald-400/50 bg-emerald-500/10 text-xs font-semibold text-emerald-200">
              Відпусти файли сюди
            </div>
          ) : null}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,application/pdf"
            multiple
            className="hidden"
            onChange={onFileSelected}
          />
          <button
            type="button"
            onClick={openFilePicker}
            disabled={busy || compressingAttach || attachments.length >= MAX_PENDING_ATTACHMENTS}
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.05] text-zinc-400 transition-colors hover:border-emerald-400/35 hover:bg-emerald-400/10 hover:text-emerald-400 disabled:pointer-events-none disabled:opacity-40"
            aria-label={fullscreen ? "Камера або файл" : "Прикріпити файли"}
            title={
              fullscreen
                ? "Фото / PDF накладної або акта"
                : `Прикріпити фото або PDF (до ${MAX_PENDING_ATTACHMENTS})`
            }
          >
            {fullscreen ? (
              <Camera className="size-4" strokeWidth={2.1} />
            ) : (
              <Paperclip className="size-4" strokeWidth={2.1} />
            )}
          </button>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(event) => {
              setInput(event.target.value);
              requestAnimationFrame(resizeComposerTextarea);
            }}
            onInput={resizeComposerTextarea}
            onPaste={(event) => {
              onComposerPaste(event);
              requestAnimationFrame(resizeComposerTextarea);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void submitText(input);
              }
            }}
            rows={1}
            placeholder={dragOverComposer ? "Кидай файли…" : "Питай LEVADIUS…"}
            className="max-h-[min(40dvh,15rem)] min-h-11 min-w-0 flex-1 resize-none overflow-hidden rounded-2xl border border-white/10 bg-white/[0.05] px-3.5 py-2.5 text-sm leading-6 text-zinc-50 outline-none placeholder:truncate placeholder:text-zinc-500 focus:border-emerald-500/40 focus:ring-2 focus:ring-emerald-500/15"
          />
          <VoiceInputButton
            disabled={busy || compressingAttach}
            value={input}
            onTranscript={(text) => {
              setInput(text);
              requestAnimationFrame(resizeComposerTextarea);
            }}
            onAutoSend={(text) => {
              void submitText(text);
            }}
          />
          {busy ? (
            <button
              type="button"
              onClick={() => stop()}
              className="inline-flex size-11 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-zinc-200 transition hover:bg-white/10"
              aria-label="Зупинити"
            >
              <Loader2 className="size-4 animate-spin" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={
                compressingAttach ||
                (!input.trim() && attachments.length === 0)
              }
              className="inline-flex size-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-500 text-zinc-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Надіслати"
            >
              <ArrowUp className="size-4" strokeWidth={2.4} />
            </button>
          )}
        </form>

        {fullscreen ? null : messages.length > 0 ? (
          <button
            type="button"
            onClick={() => setMessages([])}
            className="mt-2 w-full text-center text-[11px] text-zinc-500 transition hover:text-zinc-300"
          >
            Очистити діалог
          </button>
        ) : null}
      </div>
    </div>
  );

  if (fullscreen) {
    return panel;
  }

  return (
    <AnimatePresence>
      {effectiveOpen ? (
        <>
          <motion.button
            type="button"
            aria-label="Закрити фон LEVADIUS"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[240] bg-black/55 supports-backdrop-filter:backdrop-blur-[2px]"
            onClick={() => onOpenChange(false)}
          />
          <motion.div
            initial={
              isMobile
                ? { y: "100%", opacity: 0.8 }
                : { x: "100%", opacity: 0.8 }
            }
            animate={{ x: 0, y: 0, opacity: 1 }}
            exit={
              isMobile
                ? { y: "100%", opacity: 0.6 }
                : { x: "100%", opacity: 0.6 }
            }
            transition={{ type: "spring", stiffness: 380, damping: 36 }}
            className={cn(
              "fixed z-[250]",
              isMobile
                ? "inset-x-0 bottom-0 h-[min(88dvh,44rem)]"
                : "top-0 right-0 h-full w-full max-w-[26rem]"
            )}
          >
            {panel}
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>
  );
}

export function LevadaCopilotFullscreen(): ReactNode {
  return (
    <Suspense
      fallback={
        <div className="relative flex h-[100dvh] w-full overflow-hidden bg-zinc-950">
          <LevadiusBootOverlay />
        </div>
      }
    >
      <LevadaCopilotDrawer
        open
        onOpenChange={() => {}}
        variant="fullscreen"
      />
    </Suspense>
  );
}

export function LevadaCopilotHost(): ReactNode {
  const [open, setOpen] = useState(false);
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getMyProfileAction().then((me) => {
      if (cancelled) return;
      setAllowed(canAccessLevadius(me));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!allowed) return null;

  return (
    <>
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Відкрити LEVADIUS"
          className={cn(
            "fixed z-[120] size-12 overflow-visible rounded-full",
            "border border-white/15 bg-zinc-950/80 shadow-[0_12px_40px_-12px_rgba(16,185,129,0.55)]",
            "backdrop-blur-xl transition hover:border-emerald-400/40 hover:bg-zinc-900/90",
            "active:scale-[0.97]",
            "right-4 bottom-[calc(var(--bottom-nav-height)+0.85rem)] md:right-6 md:bottom-6"
          )}
        >
          <span className="absolute inset-0 overflow-hidden rounded-full">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/icons/levadius-avatar.jpg"
              alt=""
              className="size-full object-cover object-center"
            />
          </span>
          <span className="absolute top-1.5 right-1.5 z-10 size-2 rounded-full bg-emerald-400 ring-2 ring-zinc-950" />
        </button>
      ) : null}
      <Suspense fallback={null}>
        <LevadaCopilotDrawer open={open} onOpenChange={setOpen} />
      </Suspense>
    </>
  );
}

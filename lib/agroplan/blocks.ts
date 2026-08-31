import type { InsightCardData } from "@/lib/agronomy-engine";
import type { AgroplanSeasonOperation } from "@/lib/agroplan/season-ops";
import { kyivDayBoundsUnix, shiftKyivYmd, todayKyivYmd } from "@/lib/kyiv-date";

export type AgroplanBlockSource = "insight" | "operation";

export type AgroplanBlock = {
  id: string;
  source: AgroplanBlockSource;
  insight: InsightCardData;
  fieldId: string;
  fieldName: string;
  /** Початок блоку (unix ms, Europe/Kyiv wall) */
  startMs: number;
  /** Тривалість для ширини на таймлайні */
  durationHours: number;
  /** client_key наряду з БД */
  operationClientKey?: string;
  operationFieldKey?: string;
  operationStatus?: import("@/lib/field-operations").FieldOperationStatus;
};

function kyivYmdFromParts(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function msOnKyivDay(ymd: string, hour = 8): number {
  const { fromUnix } = kyivDayBoundsUnix(ymd);
  return fromUnix * 1000 + hour * 3_600_000;
}

function defaultStartMs(insight: InsightCardData, now: Date): number {
  const today = todayKyivYmd(now);

  if (insight.kind === "anomaly") {
    return msOnKyivDay(today, 10);
  }

  if (insight.status === "PERFECT_CONDITIONS") {
    return msOnKyivDay(today, 8);
  }
  if (insight.status === "WAITING_WEATHER") {
    return msOnKyivDay(shiftKyivYmd(today, 2), 8);
  }

  const day = Math.min(28, 15);
  const ymd = kyivYmdFromParts(insight.targetYear, insight.targetMonth, day);
  return msOnKyivDay(ymd, 8);
}

function defaultDurationHours(insight: InsightCardData): number {
  if (insight.kind === "anomaly") return 3;
  if (insight.operationType === "Збір") return 10;
  if (insight.operationType === "ТМЦ") return 4;
  return 6;
}

/** Розгортає інсайти в блоки по полях з дефолтними датами */
export function insightsToBlocks(
  insights: readonly InsightCardData[],
  now = new Date()
): AgroplanBlock[] {
  const blocks: AgroplanBlock[] = [];
  for (const insight of insights) {
    const fields =
      insight.fields.length > 0
        ? insight.fields
        : [{ id: "unknown", name: "Поле", areaHa: undefined }];

    for (const field of fields) {
      blocks.push({
        id: `${insight.id}:${field.id}`,
        source: "insight",
        insight,
        fieldId: field.id,
        fieldName: field.name,
        startMs: defaultStartMs(insight, now),
        durationHours: defaultDurationHours(insight),
      });
    }
  }
  return blocks;
}

export type SeasonMonth = { year: number; month: number };

/** Місяці для генерації інсайтів (січень… + 3 місяці наступного року) */
export function buildSeasonMonths(now = new Date()): SeasonMonth[] {
  const year = now.getFullYear();
  const out: SeasonMonth[] = [];
  for (let m = 1; m <= 12; m++) out.push({ year, month: m });
  for (let m = 1; m <= 3; m++) out.push({ year: year + 1, month: m });
  return out;
}

function normalizeWorkName(value: string): string {
  return value
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ")
    .trim();
}

function insightDuplicatedByOperation(
  block: AgroplanBlock,
  operations: readonly AgroplanSeasonOperation[]
): boolean {
  if (block.source !== "insight") return false;
  const work = normalizeWorkName(block.insight.operationName);
  const month = block.insight.targetMonth;
  const year = block.insight.targetYear;
  return operations.some((op) => {
    if (op.fieldId !== block.fieldId) return false;
    const opMonth = Number(op.occurredAt.slice(5, 7));
    const opYear = Number(op.occurredAt.slice(0, 4));
    if (opMonth !== month || opYear !== year) return false;
    const opWork = normalizeWorkName(op.workType);
    return opWork.includes(work) || work.includes(opWork);
  });
}

export function mergeAgroplanBlocks(input: {
  insightBlocks: readonly AgroplanBlock[];
  operationBlocks: readonly AgroplanBlock[];
  hiddenIds: ReadonlySet<string>;
  operations: readonly AgroplanSeasonOperation[];
}): AgroplanBlock[] {
  const filteredInsights = input.insightBlocks.filter(
    (b) =>
      !input.hiddenIds.has(b.id) &&
      !insightDuplicatedByOperation(b, input.operations)
  );
  const ops = input.operationBlocks.filter((b) => !input.hiddenIds.has(b.id));
  return [...filteredInsights, ...ops];
}

export function groupBlocksByField(
  blocks: readonly AgroplanBlock[]
): Map<string, AgroplanBlock[]> {
  const map = new Map<string, AgroplanBlock[]>();
  for (const block of blocks) {
    const list = map.get(block.fieldId) ?? [];
    list.push(block);
    map.set(block.fieldId, list);
  }
  for (const list of map.values()) {
    list.sort((a, b) => a.startMs - b.startMs);
  }
  return map;
}

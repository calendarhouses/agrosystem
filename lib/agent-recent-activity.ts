/**
 * LEVADIUS: журнал дій команди (activity_log → /journal).
 */

import {
  listActivityLog,
  type ActivityLogRow,
} from "@/lib/activity-log";
import { ROLE_LABEL_UK, type AppRole } from "@/lib/app-actor-shared";
import { shiftKyivYmd, todayKyivYmd } from "@/lib/kyiv-date";

export type AgentActivityCategory =
  | "all"
  | "operations"
  | "inventory"
  | "fuel"
  | "equipment"
  | "accounting";

export type AgentActivityActionFilter =
  | "all"
  | "create"
  | "update"
  | "delete"
  | "close";

export type AgentActivityPeriod =
  | "today"
  | "yesterday"
  | "last_7_days"
  | "all";

export type AgentActivityItem = {
  timestamp: string;
  user: string;
  category: Exclude<AgentActivityCategory, "all"> | "other";
  action: string;
  description: string;
  targetId: string | null;
  entityType: string;
};

const CATEGORY_ENTITY_TYPES: Record<
  Exclude<AgentActivityCategory, "all">,
  readonly string[]
> = {
  operations: [
    "field_operation",
    "scouting_report",
    "farm_field",
    "field",
  ],
  inventory: ["inventory_move", "inventory_item"],
  fuel: ["fuel_transaction", "fuel_storage"],
  equipment: ["equipment"],
  accounting: ["accounting_act", "bas_request", "mapping"],
};

function periodWindow(period: AgentActivityPeriod): {
  fromIso: string | null;
  toExclusiveIso: string | null;
} {
  const todayIso = todayKyivYmd();
  const tomorrowIso = shiftKyivYmd(todayIso, 1);

  if (period === "all") {
    return { fromIso: null, toExclusiveIso: null };
  }
  if (period === "today") {
    return { fromIso: todayIso, toExclusiveIso: tomorrowIso };
  }
  if (period === "yesterday") {
    return {
      fromIso: shiftKyivYmd(todayIso, -1),
      toExclusiveIso: todayIso,
    };
  }
  return {
    fromIso: shiftKyivYmd(todayIso, -6),
    toExclusiveIso: tomorrowIso,
  };
}

export function mapEntityTypeToCategory(
  entityType: string
): Exclude<AgentActivityCategory, "all"> | "other" {
  const key = entityType.trim().toLowerCase();
  for (const [category, types] of Object.entries(CATEGORY_ENTITY_TYPES) as Array<
    [Exclude<AgentActivityCategory, "all">, readonly string[]]
  >) {
    if (types.includes(key)) return category;
  }
  return "other";
}

function formatActor(row: ActivityLogRow): string {
  const name = row.actorName.trim() || "Система";
  if (row.actorRole && row.actorRole in ROLE_LABEL_UK) {
    return `${name} (${ROLE_LABEL_UK[row.actorRole as AppRole]})`;
  }
  return name;
}

function inPeriod(
  createdAt: string,
  fromIso: string | null,
  toExclusiveIso: string | null
): boolean {
  if (!fromIso && !toExclusiveIso) return true;
  const day = createdAt.slice(0, 10);
  if (fromIso && day < fromIso) return false;
  if (toExclusiveIso && day >= toExclusiveIso) return false;
  return true;
}

export async function listAgentRecentActivity(input: {
  category?: AgentActivityCategory;
  actionType?: AgentActivityActionFilter;
  limit?: number;
  period?: AgentActivityPeriod;
}): Promise<{
  success: true;
  totalEvents: number;
  period: AgentActivityPeriod;
  category: AgentActivityCategory;
  actionType: AgentActivityActionFilter;
  activities: AgentActivityItem[];
  navigatePath: "/journal";
  empty: boolean;
  emptyHint?: string;
}> {
  const category = input.category ?? "all";
  const actionType = input.actionType ?? "all";
  const period = input.period ?? "today";
  const limit = Math.min(Math.max(1, Math.round(input.limit ?? 25)), 100);
  const { fromIso, toExclusiveIso } = periodWindow(period);

  // Тягнемо з запасом — далі фільтр category/period/action
  const rows = await listActivityLog({ limit: 500 });

  const filtered = rows.filter((row) => {
    if (!inPeriod(row.createdAt, fromIso, toExclusiveIso)) return false;
    if (actionType !== "all" && row.action !== actionType) return false;
    const cat = mapEntityTypeToCategory(row.entityType);
    if (category !== "all" && cat !== category) return false;
    return true;
  });

  const activities: AgentActivityItem[] = filtered.slice(0, limit).map((row) => ({
    timestamp: row.createdAt,
    user: formatActor(row),
    category: mapEntityTypeToCategory(row.entityType),
    action: row.action,
    description: row.summary.trim() || `${row.action} · ${row.entityType}`,
    targetId: row.entityId,
    entityType: row.entityType,
  }));

  return {
    success: true as const,
    totalEvents: filtered.length,
    period,
    category,
    actionType,
    activities,
    navigatePath: "/journal",
    empty: activities.length === 0,
    emptyHint:
      activities.length === 0
        ? "За вибраний період подій у журналі немає."
        : undefined,
  };
}

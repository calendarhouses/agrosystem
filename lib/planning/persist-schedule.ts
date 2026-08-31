import { queuePlacementSync, savePlacementPatch } from "@/lib/agroplan/placements";
import { kyivDayBoundsUnix } from "@/lib/kyiv-date";
import type { PlanningTask } from "@/lib/planning/types";
import { currentAgroSeason } from "@/lib/season";

export async function persistTaskSchedule(
  task: PlanningTask,
  dateYmd: string
): Promise<{ ok: boolean; error?: string }> {
  if (task.operationClientKey) {
    try {
      const res = await fetch("/api/agroplan/reschedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientKey: task.operationClientKey,
          occurredAt: dateYmd,
        }),
      });
      const body = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) {
        return {
          ok: false,
          error: body.error ?? "Не вдалося перенести наряд",
        };
      }
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error:
          error instanceof Error ? error.message : "Помилка мережі (reschedule)",
      };
    }
  }

  const { fromUnix } = kyivDayBoundsUnix(dateYmd);
  const startMs = fromUnix * 1000;
  const durationHours = Math.max(8, Math.round(task.durationDays * 8));
  const season = currentAgroSeason();

  savePlacementPatch(task.id, { startMs, durationHours });

  try {
    const res = await fetch("/api/agroplan/placements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        season,
        placements: [
          {
            blockId: task.id,
            season,
            startMs,
            durationHours,
          },
        ],
      }),
    });
    const body = (await res.json()) as { ok?: boolean; error?: string };
    if (!res.ok || !body.ok) {
      queuePlacementSync(season, task.id, { startMs, durationHours });
      return {
        ok: false,
        error: body.error ?? "Не вдалося зберегти позицію",
      };
    }
    return { ok: true };
  } catch (error) {
    queuePlacementSync(season, task.id, { startMs, durationHours });
    return {
      ok: false,
      error:
        error instanceof Error ? error.message : "Помилка мережі (placements)",
    };
  }
}

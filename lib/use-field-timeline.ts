"use client";

import { useCallback, useEffect, useState } from "react";

import type { FieldWithTimeline } from "@/lib/field-timeline";
import { useSeasonStore } from "@/lib/season-store";

type FieldTimelineResponse = {
  ok?: boolean;
  error?: string;
  fieldsWithTimeline?: FieldWithTimeline[];
};

export function useFieldTimeline(season?: string) {
  const activeSeason = useSeasonStore((s) => s.activeSeason);
  const resolvedSeason = season ?? activeSeason;

  const [fieldsWithTimeline, setFieldsWithTimeline] = useState<FieldWithTimeline[]>(
    []
  );
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/field-timeline?season=${encodeURIComponent(resolvedSeason)}`,
        { cache: "no-store", signal }
      );

      const data = (await response.json()) as FieldTimelineResponse;

      if (!response.ok || data.ok === false) {
        throw new Error(
          data.error ?? `Не вдалося завантажити хронологію (HTTP ${response.status})`
        );
      }

      setFieldsWithTimeline(data.fieldsWithTimeline ?? []);
    } catch (err) {
      if (signal?.aborted) return;
      setFieldsWithTimeline([]);
      setError(
        err instanceof Error ? err.message : "Не вдалося завантажити хронологію"
      );
    } finally {
      if (!signal?.aborted) setIsLoading(false);
    }
  }, [resolvedSeason]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const refresh = useCallback(() => {
    void load();
  }, [load]);

  return {
    fieldsWithTimeline,
    isLoading,
    error,
    refresh,
    season: resolvedSeason,
  };
}

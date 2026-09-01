"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { loadFieldTimeline } from "@/lib/field-timeline-data";
import type { FieldWithTimeline } from "@/lib/field-timeline-types";
import { createBrowserSupabase } from "@/lib/supabase/client";
import { useSeasonStore } from "@/lib/season-store";

type TimelineCacheEntry = {
  data: FieldWithTimeline[];
  fetchedAt: number;
};

const timelineCache = new Map<string, TimelineCacheEntry>();
const CACHE_TTL_MS = 30_000;

function readCache(season: string): FieldWithTimeline[] | null {
  const entry = timelineCache.get(season);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > CACHE_TTL_MS) {
    timelineCache.delete(season);
    return null;
  }
  return entry.data;
}

function writeCache(season: string, data: FieldWithTimeline[]) {
  timelineCache.set(season, { data, fetchedAt: Date.now() });
}

/**
 * Хронологія полів: 4 паралельні запити до Supabase (Promise.all),
 * мапінг у UnifiedTimelineEvent, групування за field_id.
 *
 * У проєкті немає React Query / SWR — використовуємо браузерний Supabase
 * + легкий in-memory cache на сезон (30 с) і дедуплікацію in-flight запитів.
 */
export function useFieldTimeline(season?: string) {
  const activeSeason = useSeasonStore((s) => s.activeSeason);
  const resolvedSeason = season ?? activeSeason;

  const [fieldsWithTimeline, setFieldsWithTimeline] = useState<FieldWithTimeline[]>(
    () => readCache(resolvedSeason) ?? []
  );
  const [isLoading, setIsLoading] = useState(
    () => readCache(resolvedSeason) == null
  );
  const [error, setError] = useState<string | null>(null);

  const inflightRef = useRef<Promise<FieldWithTimeline[]> | null>(null);
  const generationRef = useRef(0);

  const load = useCallback(
    async (options?: { force?: boolean }) => {
      const force = options?.force ?? false;
      const generation = ++generationRef.current;

      if (!force) {
        const cached = readCache(resolvedSeason);
        if (cached) {
          setFieldsWithTimeline(cached);
          setIsLoading(false);
          setError(null);
          return cached;
        }
      }

      if (inflightRef.current && !force) {
        try {
          const shared = await inflightRef.current;
          if (generation === generationRef.current) {
            setFieldsWithTimeline(shared);
            setIsLoading(false);
          }
          return shared;
        } catch {
          // Падіння спільного запиту — пробуємо свій нижче
        }
      }

      setIsLoading(true);
      setError(null);

      const task = (async () => {
        const supabase = createBrowserSupabase();
        return loadFieldTimeline(supabase, resolvedSeason, {
          fieldSort: "last_activity",
        });
      })();

      inflightRef.current = task;

      try {
        const data = await task;
        writeCache(resolvedSeason, data);

        if (generation === generationRef.current) {
          setFieldsWithTimeline(data);
          setError(null);
        }

        return data;
      } catch (err) {
        if (generation === generationRef.current) {
          setFieldsWithTimeline([]);
          setError(
            err instanceof Error
              ? err.message
              : "Не вдалося завантажити хронологію"
          );
        }
        throw err;
      } finally {
        if (inflightRef.current === task) {
          inflightRef.current = null;
        }
        if (generation === generationRef.current) {
          setIsLoading(false);
        }
      }
    },
    [resolvedSeason]
  );

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = useCallback(() => {
    timelineCache.delete(resolvedSeason);
    void load({ force: true });
  }, [load, resolvedSeason]);

  return {
    fieldsWithTimeline,
    isLoading,
    isError: error != null,
    error,
    refresh,
    season: resolvedSeason,
  };
}

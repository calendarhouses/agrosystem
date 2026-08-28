"use client";

import { MapPin, Satellite } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { InsightCardData } from "@/lib/agronomy-engine";
import { cn } from "@/lib/utils";

type AnomalyInsightCardProps = {
  insight: InsightCardData;
  onScout: (insight: InsightCardData) => void;
};

/** Картка NDVI-аномалії — червоний/помаранчевий акцент */
export function AnomalyInsightCard({
  insight,
  onScout,
}: AnomalyInsightCardProps) {
  const field = insight.fields[0];
  const drop = insight.ndviDropPercent ?? 0;

  return (
    <article
      className={cn(
        "group relative overflow-hidden rounded-3xl p-5 pb-16",
        "border border-rose-500/40 bg-gradient-to-br from-rose-500/15 via-orange-500/10 to-card/40",
        "shadow-sm backdrop-blur-2xl transition-all hover:shadow-md"
      )}
    >
      <div
        className="pointer-events-none absolute -top-10 -right-8 h-32 w-32 rounded-full bg-rose-500/20 blur-2xl"
        aria-hidden
      />

      <div className="relative flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-rose-500/20 text-rose-600 dark:text-rose-400">
            <Satellite className="h-5 w-5" strokeWidth={1.8} />
          </div>
          <div className="min-w-0">
            <h3 className="text-base font-semibold tracking-tight text-foreground">
              {insight.operationName}
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {insight.crop}
              {field?.areaHa != null
                ? ` · ${Math.round(field.areaHa * 10) / 10} га`
                : ""}
            </p>
          </div>
        </div>
        <Badge
          variant="destructive"
          className="animate-pulse shrink-0 border-0"
        >
          Критичний пріоритет
        </Badge>
      </div>

      <div className="mt-3 flex flex-wrap gap-1">
        {insight.fields.map((f) => (
          <span
            key={f.id}
            className="rounded-md border border-rose-500/30 bg-background/60 px-2 py-1 text-xs text-rose-800 dark:text-rose-200"
          >
            {f.name}
          </span>
        ))}
        <span className="rounded-md border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-xs font-medium text-rose-600">
          −{Math.round(drop)}% NDVI
        </span>
      </div>

      <p className="mt-4 text-xs leading-relaxed text-rose-950/80 italic dark:text-rose-100/80">
        {insight.explanation}
      </p>

      <div className="absolute right-4 bottom-4">
        <Button
          type="button"
          size="sm"
          onClick={() => onScout(insight)}
          className={cn(
            "rounded-full px-4 shadow-lg",
            "bg-rose-600 text-white hover:bg-rose-700"
          )}
        >
          <MapPin className="h-3.5 w-3.5" />
          Створити завдання на Скаутинг
        </Button>
      </div>
    </article>
  );
}

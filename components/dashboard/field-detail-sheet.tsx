"use client";

import { useState, type ComponentType } from "react";
import {
  Cloud,
  Droplets,
  Sprout,
  Tractor,
  TrendingUp,
} from "lucide-react";
import { Area, AreaChart, CartesianGrid, XAxis } from "recharts";

import { DatePicker } from "@/components/ui/date-picker";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  FIELD_ANALYTICS,
  type Field,
  type TimelineIcon,
} from "@/lib/dashboard-data";
import { cn } from "@/lib/utils";

type FieldDetailSheetProps = {
  field: Field | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const timelineIconMap: Record<
  TimelineIcon,
  ComponentType<{ className?: string }>
> = {
  tractor: Tractor,
  droplet: Droplets,
  cloud: Cloud,
};

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

/** Широка панель глибокої аналітики поля */
export function FieldDetailSheet({
  field,
  open,
  onOpenChange,
}: FieldDetailSheetProps) {
  const [period, setPeriod] = useState<Date | undefined>(new Date(2026, 4, 1));
  const analytics = field ? FIELD_ANALYTICS[field.id] : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className={cn(
          "w-full gap-0 border-l border-[#E5DFD3] bg-[#F4F1EA] p-0 text-zinc-900 shadow-sm",
          "sm:max-w-2xl",
          "[&_[data-slot=sheet-close]]:text-zinc-500 [&_[data-slot=sheet-close]]:hover:bg-[#E5DFD3]/40"
        )}
      >
        {field && analytics ? (
          <>
            <SheetHeader className="space-y-4 border-b border-[#E5DFD3] px-6 py-5">
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
              <DatePicker
                date={period}
                onChange={setPeriod}
                seasonLabel
                className="w-full sm:w-auto"
              />
            </SheetHeader>

            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <Tabs defaultValue="overview" className="flex min-h-0 flex-1 gap-0">
                <div className="border-b border-[#E5DFD3] px-6 pt-4">
                  <TabsList className="h-10 w-full rounded-xl bg-zinc-100 p-1">
                    <TabsTrigger
                      value="overview"
                      className="rounded-lg data-active:bg-[#F4F1EA] data-active:text-[#276749] data-active:shadow-sm"
                    >
                      Огляд
                    </TabsTrigger>
                    <TabsTrigger
                      value="history"
                      className="rounded-lg data-active:bg-[#F4F1EA] data-active:text-[#276749] data-active:shadow-sm"
                    >
                      Агро-історія
                    </TabsTrigger>
                    <TabsTrigger
                      value="economy"
                      className="rounded-lg data-active:bg-[#F4F1EA] data-active:text-[#276749] data-active:shadow-sm"
                    >
                      Економіка
                    </TabsTrigger>
                  </TabsList>
                </div>

                <TabsContent
                  value="overview"
                  className="overflow-y-auto px-6 py-5 outline-none"
                >
                  <div className="mb-4 grid grid-cols-2 gap-3">
                    <div className="rounded-xl border border-[#E5DFD3] bg-zinc-100 p-3.5">
                      <p className="text-[11px] uppercase tracking-wider text-zinc-500">
                        Рентабельність
                      </p>
                      <p className="mt-1 text-2xl font-extrabold tracking-tight text-[#276749]">
                        {analytics.profitabilityPercent}%
                      </p>
                    </div>
                    <div className="rounded-xl border border-[#E5DFD3] bg-zinc-100 p-3.5">
                      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-zinc-500">
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

                  <p className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-zinc-500">
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
                        <linearGradient id="fillFieldProfit" x1="0" y1="0" x2="0" y2="1">
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

                <TabsContent
                  value="history"
                  className="overflow-y-auto px-6 py-5 outline-none"
                >
                  <ol className="relative space-y-0 pl-1">
                    {analytics.agroHistory.map((item, index) => {
                      const Icon = timelineIconMap[item.icon];
                      const isLast = index === analytics.agroHistory.length - 1;
                      const isWaiting = item.status === "waiting";

                      return (
                        <li
                          key={item.id}
                          className="relative flex gap-4 pb-6 last:pb-0"
                        >
                          {!isLast && (
                            <span
                              aria-hidden
                              className="absolute top-10 left-[19px] h-[calc(100%-1.5rem)] w-px bg-[#E5DFD3]"
                            />
                          )}
                          <div
                            className={cn(
                              "relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border",
                              isWaiting
                                ? "border-[#D69E2E]/30 bg-[#D69E2E]/10 text-[#D69E2E]"
                                : "border-[#276749]/30 bg-[#276749]/10 text-[#276749]"
                            )}
                          >
                            <Icon className="h-4 w-4" />
                          </div>
                          <div className="min-w-0 pt-1">
                            <p className="text-xs font-medium text-zinc-500">
                              {item.dateLabel}
                            </p>
                            <p className="mt-0.5 text-sm font-semibold text-zinc-900">
                              {item.title}
                            </p>
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                </TabsContent>

                <TabsContent
                  value="economy"
                  className="overflow-y-auto px-6 py-5 outline-none"
                >
                  <p className="mb-3 text-xs font-medium uppercase tracking-wider text-zinc-500">
                    Витрати на 1 гектар
                  </p>
                  <ul className="space-y-2">
                    {analytics.costsPerHa.map((item) => (
                      <li
                        key={item.label}
                        className="flex items-center justify-between rounded-xl border border-[#E5DFD3] bg-zinc-100 px-3.5 py-3"
                      >
                        <span className="text-sm text-zinc-900">{item.label}</span>
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
              </Tabs>
            </div>

            <SheetFooter className="border-t border-[#E5DFD3] px-6 py-5">
              <button
                type="button"
                className="w-full rounded-xl bg-[#276749] px-5 py-3.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-[#276749]/90"
              >
                Запланувати роботи
              </button>
            </SheetFooter>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

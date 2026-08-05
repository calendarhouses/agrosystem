"use client";

import { Package, Warehouse } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { GlassCard } from "@/components/ui/glass-card";
import { INVENTORY_ITEMS } from "@/lib/dashboard-data";
import { cn } from "@/lib/utils";

/** Склад та врожай */
export function InventoryView() {
  return (
    <main className="mx-auto h-full w-full max-w-7xl overflow-y-auto overscroll-none px-4 pt-3 pb-6 sm:px-6 lg:px-8">
      <PageHeader
        icon={Warehouse}
        title="Склад та Врожай"
        description="Залишки продукції, насіння та ЗЗР"
      />

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-5">
        {INVENTORY_ITEMS.map((item) => {
          const low = item.status === "Низький запас";
          return (
            <GlassCard key={item.id}>
              <div className="flex items-start gap-3">
                <div
                  className={cn(
                    "flex h-11 w-11 items-center justify-center rounded-xl",
                    low
                      ? "bg-[#C05621]/10 text-[#C05621]"
                      : "bg-[#276749]/10 text-[#276749]"
                  )}
                >
                  {low ? (
                    <Package className="h-5 w-5" />
                  ) : (
                    <Warehouse className="h-5 w-5" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-zinc-900">{item.name}</p>
                  <p className="mt-1 text-2xl font-extrabold tracking-tight text-zinc-900">
                    {item.qty}
                  </p>
                  <span
                    className={cn(
                      "mt-2 inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold",
                      low
                        ? "border-[#C05621]/30 bg-[#C05621]/10 text-[#C05621]"
                        : "border-[#276749]/30 bg-[#276749]/10 text-[#276749]"
                    )}
                  >
                    {item.status}
                  </span>
                </div>
              </div>
            </GlassCard>
          );
        })}
      </section>
    </main>
  );
}

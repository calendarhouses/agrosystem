"use client";

import { useState } from "react";

import { PlanInsightSheet } from "@/components/dashboard/calendar/plan-insight-sheet";
import { OrderTmcSheet } from "@/components/dashboard/calendar/order-tmc-sheet";
import { AgroplanDesktop } from "@/components/dashboard/agroplan/agroplan-desktop";
import { AgroplanMobileHud } from "@/components/dashboard/agroplan/agroplan-mobile-hud";
import { AgroplanSkeleton } from "@/components/dashboard/agroplan/agroplan-skeleton";
import { useAgroplanData } from "@/components/dashboard/agroplan/use-agroplan-data";
import type { InsightCardData } from "@/lib/agronomy-engine";
import { useIsMobile } from "@/lib/use-mobile";

/** Агроплан — Tech-Noir таймлайн сезону + польовий HUD на мобільному */
export function AgroplanView() {
  const isMobile = useIsMobile();
  const data = useAgroplanData();

  const [planInsight, setPlanInsight] = useState<InsightCardData | null>(null);
  const [planOpen, setPlanOpen] = useState(false);
  const [scoutCoords, setScoutCoords] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [orderInsight, setOrderInsight] = useState<InsightCardData | null>(
    null
  );
  const [orderOpen, setOrderOpen] = useState(false);

  function openPlan(insight: InsightCardData) {
    setScoutCoords(null);
    setPlanInsight(insight);
    setPlanOpen(true);
  }

  function openOrder(insight: InsightCardData) {
    setOrderInsight(insight);
    setOrderOpen(true);
  }

  if (data.fieldsLoading && data.fields.length === 0) {
    return <AgroplanSkeleton />;
  }

  return (
    <>
      {isMobile ? (
        <AgroplanMobileHud data={data} onPlan={openPlan} onOrder={openOrder} />
      ) : (
        <AgroplanDesktop data={data} onPlan={openPlan} onOrder={openOrder} />
      )}

      <PlanInsightSheet
        open={planOpen}
        onOpenChange={(open) => {
          setPlanOpen(open);
          if (!open) {
            setPlanInsight(null);
            setScoutCoords(null);
          }
        }}
        insight={planInsight}
        scoutCoords={scoutCoords}
        onSaved={() => {
          data.refreshSeasonOps();
          data.refreshStock();
        }}
      />

      <OrderTmcSheet
        open={orderOpen}
        onOpenChange={(open) => {
          setOrderOpen(open);
          if (!open) setOrderInsight(null);
        }}
        insight={orderInsight}
        onSaved={data.refreshStock}
      />
    </>
  );
}

/** @deprecated Використовуйте AgroplanView */
export function AgroRadarView() {
  return <AgroplanView />;
}

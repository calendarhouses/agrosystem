import type { Metadata } from "next";

import { PlanningDashboard } from "@/components/dashboard/planning/PlanningDashboard";

export const metadata: Metadata = {
  title: "Агроплан",
};

export default function CalendarPage() {
  return <PlanningDashboard />;
}

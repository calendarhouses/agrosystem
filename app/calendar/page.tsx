import type { Metadata } from "next";

import { AgroRadarView } from "@/components/dashboard/agro-radar-view";

export const metadata: Metadata = {
  title: "Агро-Радар",
};

export default function CalendarPage() {
  return <AgroRadarView />;
}

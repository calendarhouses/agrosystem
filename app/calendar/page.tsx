import type { Metadata } from "next";

import { AgroplanView } from "@/components/dashboard/agroplan/agroplan-view";

export const metadata: Metadata = {
  title: "Агроплан",
};

export default function CalendarPage() {
  return <AgroplanView />;
}

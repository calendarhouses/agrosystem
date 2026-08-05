import type { Metadata } from "next";

import { FleetView } from "@/components/dashboard/fleet-view";

export const metadata: Metadata = {
  title: "Техніка та Паливо",
};

export default function FleetPage() {
  return <FleetView />;
}

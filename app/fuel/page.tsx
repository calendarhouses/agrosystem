import type { Metadata } from "next";

import { FuelRoute } from "@/components/dashboard/fuel-route";

export const metadata: Metadata = {
  title: "Паливо",
};

export default function FuelPage() {
  return <FuelRoute />;
}

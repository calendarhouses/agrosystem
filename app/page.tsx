import type { Metadata } from "next";

import { FieldsView } from "@/components/dashboard/fields-view";

export const metadata: Metadata = {
  title: "Карта Полів",
};

/** Головний розділ — карта полів */
export default function HomePage() {
  return <FieldsView />;
}

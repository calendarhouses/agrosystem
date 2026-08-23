import { Suspense } from "react";
import type { Metadata } from "next";

import { FieldsView } from "@/components/dashboard/fields-view";

export const metadata: Metadata = {
  title: "Карта полів",
};

/** Головний розділ — карта полів */
export default function HomePage() {
  return (
    <Suspense fallback={null}>
      <FieldsView />
    </Suspense>
  );
}

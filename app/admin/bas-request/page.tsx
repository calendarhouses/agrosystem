import type { Metadata } from "next";
import { FileOutput } from "lucide-react";

import { BasRequestView } from "@/components/admin/bas-request-view";
import { PageHeader } from "@/components/layout/page-header";
import {
  buildBasChangeRequest,
  orphanCollisions,
} from "@/lib/bas-change-request";
import { loadBasFields, loadRegistryRows } from "@/lib/field-registry-data";
import { unmatchedBasFields } from "@/lib/field-registry";

export const metadata: Metadata = {
  title: "Заявка бухгалтеру",
};

export const dynamic = "force-dynamic";

export default async function BasRequestPage() {
  const [rows, basFields] = await Promise.all([
    loadRegistryRows(),
    loadBasFields(),
  ]);

  const request = buildBasChangeRequest(rows, basFields.items);
  const orphans = unmatchedBasFields(rows, basFields.items);
  const collisions = orphanCollisions(rows, orphans);

  return (
    <main className="mx-auto h-full w-full max-w-7xl overflow-y-auto overscroll-none px-4 pt-3 pb-6 sm:px-6 lg:px-8">
      <PageHeader
        icon={FileOutput}
        title="Заявка бухгалтеру"
        description="Перелік змін у довіднику полів 1С, які випливають із нашого реєстру. Вносить їх бухгалтер — ми в BAS нічого не пишемо"
      />

      <BasRequestView
        request={request}
        orphans={orphans}
        collisions={collisions}
        basError={basFields.error}
      />
    </main>
  );
}

import type { Metadata } from "next";
import { Sprout } from "lucide-react";

import { FieldRegistry } from "@/components/admin/field-registry";
import { PageHeader } from "@/components/layout/page-header";
import { loadBasFields, loadRegistryRows } from "@/lib/field-registry-data";
import { syncWialonGeofencesToFarmFields } from "@/lib/wialon-farm-sync";

export const metadata: Metadata = {
  title: "Реєстр полів",
};

export const dynamic = "force-dynamic";

async function syncWialonFields() {
  try {
    const result = await syncWialonGeofencesToFarmFields();
    console.info(
      `[field-registry] Wialon: ${result.total} geofences, +${result.inserted} new, ${result.updated} updated`
    );
  } catch (error) {
    console.error("[field-registry] sync Wialon fields:", error);
  }
}

export default async function FieldRegistryPage() {
  await syncWialonFields();

  const [rows, basFields] = await Promise.all([
    loadRegistryRows(),
    loadBasFields(),
  ]);

  return (
    <main className="mx-auto h-full w-full max-w-7xl overflow-y-auto overscroll-none px-4 pt-3 pb-6 sm:px-6 lg:px-8">
      <PageHeader
        icon={Sprout}
        title="Реєстр полів"
        description="Wialon дає межі й площу, ви задаєте канонічну назву й номер. У 1С тільки читаємо довідник"
      />

      <FieldRegistry
        rows={rows}
        basFields={basFields.items}
        basError={basFields.error}
      />
    </main>
  );
}

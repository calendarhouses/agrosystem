"use client";

import { Fuel, Link2, Map as MapIcon, Tractor } from "lucide-react";

import { MappingBlock } from "@/components/admin/mapping-block";
import { PageHeader } from "@/components/layout/page-header";
import { saveBasMapping } from "@/app/admin/mapping/actions";
import {
  autoMapFieldRows,
  autoMapMachineryRows,
  type BasSelectOption,
  type MappingLocalRow,
} from "@/lib/bas-mapping";

type MappingViewProps = {
  storages: MappingLocalRow[];
  fields: MappingLocalRow[];
  machinery: MappingLocalRow[];
  storageOptions: BasSelectOption[];
  fieldOptions: BasSelectOption[];
  machineryOptions: BasSelectOption[];
  storageError: string | null;
  fieldError: string | null;
  machineryError: string | null;
};

export function MappingView({
  storages,
  fields,
  machinery,
  storageOptions,
  fieldOptions,
  machineryOptions,
  storageError,
  fieldError,
  machineryError,
}: MappingViewProps) {
  return (
    <main className="mx-auto h-full w-full max-w-7xl overflow-y-auto overscroll-none px-4 pt-3 pb-6 sm:px-6 lg:px-8">
      <PageHeader
        icon={Link2}
        title="Мапінг BAS AGRO"
        description="Зіставте склади, поля та техніку AgroSystem з довідниками 1С"
      />

      <div className="flex flex-col gap-4">
        <MappingBlock
          icon={Fuel}
          title="Склади палива"
          description="Склади AgroSystem ↔ довідник складів 1С. Усі 4 цистерни в BAS зведені в один склад «Паливо в цестернах» (група ППМ); бензовоз мапиться на нього ж, бо окремого складу для нього в 1С немає."
          rows={storages}
          options={storageOptions}
          optionsError={storageError}
          emptyText="У таблиці fuel_storages ще немає складів"
          onSave={(id, basRefKey) =>
            persistMapping("fuel_storages", id, basRefKey)
          }
        />

        <MappingBlock
          icon={MapIcon}
          title="Поля"
          description="Канонічні поля з реєстру ↔ довідник підрозділів 1С. Двори, городи й соцсфера сюди не потрапляють — вони позначені як не поля."
          rows={fields}
          options={fieldOptions}
          optionsError={fieldError}
          emptyText="Немає полів у farm_fields. Синхронізація Wialon не знайшла геозон."
          enableAutoMap
          autoMapRows={autoMapFieldRows}
          autoMapMessages={{
            success: (filled) =>
              `Підставлено ${filled} полів за № / площею (1С). Перевірте і збережіть.`,
            empty:
              "Збігів не знайдено. Шукаємо № поля (Поле 6) або площу ±8% між Wialon і 1С.",
          }}
          onSave={(id, basRefKey) =>
            persistMapping("farm_fields", id, basRefKey)
          }
        />

        <MappingBlock
          icon={Tractor}
          title="Техніка"
          description="Юніти Wialon ↔ основні засоби 1С"
          rows={machinery}
          options={machineryOptions}
          optionsError={machineryError}
          emptyText="Немає записів у wialon_bas_mapping. Перевірте Wialon API."
          enableAutoMap
          autoMapRows={autoMapMachineryRows}
          autoMapMessages={{
            success: (filled) =>
              `Підставлено ${filled} збіг(ів) за держномером / кодом. Перевірте і збережіть.`,
            empty:
              "Збігів не знайдено. Шукаємо 4+ цифри з назви Wialon у коді, повній назві або паспорті 1С.",
          }}
          onSave={(id, basRefKey) =>
            persistMapping("wialon_bas_mapping", id, basRefKey)
          }
        />
      </div>
    </main>
  );
}

async function persistMapping(
  table: "fuel_storages" | "farm_fields" | "wialon_bas_mapping",
  id: string,
  basRefKey: string | null
) {
  const result = await saveBasMapping({ table, id, basRefKey });
  if (!result.ok) {
    throw new Error(result.error);
  }
}

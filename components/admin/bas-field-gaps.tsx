import { FileQuestion } from "lucide-react";

import { GlassCard } from "@/components/ui/glass-card";
import type { BasFieldSummary } from "@/lib/field-registry";

const numberFormat = new Intl.NumberFormat("uk-UA", {
  maximumFractionDigits: 2,
});

/**
 * Поля, які є в BAS AGRO, але на які не вказує жоден наш запис. Нічого не змінюємо —
 * це підказка бухгалтеру, які записи вже застаріли після розбиття полів.
 */
export function BasFieldGaps({ fields }: { fields: BasFieldSummary[] }) {
  const totalHa = fields.reduce((sum, field) => sum + (field.areaHa ?? 0), 0);

  return (
    <GlassCard className="hover:translate-y-0 hover:shadow-sm">
      <div className="mb-4 flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-zinc-300/60 bg-white text-zinc-600">
          <FileQuestion className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <h2 className="text-base font-bold text-zinc-900">
            Поля BAS AGRO без відповідника у нас
          </h2>
          <p className="mt-0.5 text-sm text-zinc-500">
            Тільки читаємо і показуємо. Зазвичай це записи, які ми замістили
            розбиттям на кілька полів — долю таких вирішує бухгалтер у BAS AGRO.
          </p>
        </div>
      </div>

      {fields.length === 0 ? (
        <p className="rounded-xl border border-dashed border-[#E5DFD3] bg-zinc-100/50 px-4 py-6 text-center text-sm text-zinc-500">
          Кожне поле BAS AGRO зіставлене з нашим записом.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {fields.map((field) => (
              <span
                key={field.refKey}
                className="inline-flex items-center gap-2 rounded-lg border border-[#E5DFD3] bg-[#F4F1EA] px-3 py-1.5 text-sm text-zinc-800"
              >
                <span className="font-medium">
                  {field.description || "Без назви"}
                </span>
                <span className="text-xs text-zinc-500">
                  {field.fieldNo ? `№${field.fieldNo} · ` : ""}
                  {field.areaHa != null
                    ? `${numberFormat.format(field.areaHa)} га`
                    : "без площі"}
                </span>
              </span>
            ))}
          </div>
          <p className="mt-3 text-xs text-zinc-500">
            Разом {fields.length} запис(ів) на{" "}
            {numberFormat.format(totalHa)} га.
          </p>
        </>
      )}
    </GlassCard>
  );
}

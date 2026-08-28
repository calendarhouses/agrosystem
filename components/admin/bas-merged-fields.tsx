import { Split } from "lucide-react";

import { GlassCard } from "@/components/ui/glass-card";
import type { MergedBasRecord } from "@/lib/field-registry";

const numberFormat = new Intl.NumberFormat("uk-UA", {
  maximumFractionDigits: 2,
});

function formatHa(value: number | null) {
  return value == null ? "—" : `${numberFormat.format(value)} га`;
}

/**
 * Записи BAS AGRO, які покривають кілька наших полів. Нічого не міняємо в BAS —
 * це перелік для бухгалтера, що саме треба розділити, щоб витрати лягали
 * на конкретне поле, а не купою на спільну назву.
 */
export function BasMergedFields({ records }: { records: MergedBasRecord[] }) {
  if (records.length === 0) return null;

  const affected = records.reduce((sum, record) => sum + record.rows.length, 0);

  return (
    <GlassCard className="hover:translate-y-0 hover:shadow-sm">
      <div className="mb-4 flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-amber-300/60 bg-amber-50 text-amber-700">
          <Split className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <h2 className="text-base font-bold text-zinc-900">
            Злиті записи BAS AGRO
          </h2>
          <p className="mt-0.5 text-sm text-zinc-500">
            {affected} наших полів діляться {records.length} записами в BAS AGRO. Поки
            бухгалтер їх не розділить, гектари з чернеток лягатимуть на спільну
            назву сумарно.
          </p>
        </div>
      </div>

      <div className="space-y-3">
        {records.map((record) => {
          const delta =
            record.basField.areaHa == null
              ? null
              : record.ourAreaHa - record.basField.areaHa;

          return (
            <div
              key={record.basField.refKey}
              className="rounded-xl border border-[#E5DFD3] bg-[#F4F1EA]/60 p-3"
            >
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="text-sm font-semibold text-zinc-900">
                  {record.basField.description || "Без назви"}
                </span>
                <span className="text-xs text-zinc-500">
                  {formatHa(record.basField.areaHa)} в BAS AGRO проти{" "}
                  {formatHa(record.ourAreaHa)} у нас
                </span>
                {delta != null && Math.abs(delta) >= 0.5 ? (
                  <span className="text-xs font-medium text-amber-700">
                    {delta > 0 ? "+" : ""}
                    {numberFormat.format(delta)} га
                  </span>
                ) : null}
              </div>

              <ul className="mt-2 space-y-1">
                {record.rows.map((row) => (
                  <li
                    key={row.id}
                    className="flex items-baseline justify-between gap-3 text-sm text-zinc-700"
                  >
                    <span className="min-w-0 truncate">
                      {row.canonicalName.trim() || row.wialonName.trim()}
                    </span>
                    <span className="shrink-0 tabular-nums text-xs text-zinc-500">
                      {formatHa(row.areaHa)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </GlassCard>
  );
}

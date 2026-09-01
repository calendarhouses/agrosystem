"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { format, startOfWeek } from "date-fns";
import { uk } from "date-fns/locale";
import { Check, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { listEquipmentForOps } from "@/app/admin/equipment/actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  OperationMaterialsPicker,
  type OperationMaterialDraft,
} from "@/components/dashboard/operation-materials-picker";
import { mapDictionaryOpToWorkType } from "@/lib/agronomy-dictionary";
import type { InsightCardData } from "@/lib/agronomy-engine";
import type { EquipmentForOpsRow } from "@/lib/equipment-ops-options";
import {
  IMPLEMENT_PRESETS,
  IMPLEMENT_WIDTH_DEFAULTS,
  estimatePlanFuelLiters,
  estimatePlanWageUah,
} from "@/lib/field-operation-norms";
import { operationRequiresMaterial } from "@/lib/operation-material-categories";
import {
  upsertFieldOperation,
  type FieldOperationInput,
} from "@/lib/field-operations";
import { cn } from "@/lib/utils";

const MONTH_LABELS_UK = [
  "Січень",
  "Лютий",
  "Березень",
  "Квітень",
  "Травень",
  "Червень",
  "Липень",
  "Серпень",
  "Вересень",
  "Жовтень",
  "Листопад",
  "Грудень",
] as const;

function defaultOccurredAt(
  targetMonth: number,
  targetYear: number,
  now = new Date()
): string {
  const isCurrent =
    targetMonth === now.getMonth() + 1 && targetYear === now.getFullYear();
  if (isCurrent) {
    const weekStart = startOfWeek(now, { weekStartsOn: 1 });
    return format(weekStart, "yyyy-MM-dd");
  }
  const day = Math.min(15, daysInMonth(targetYear, targetMonth));
  return `${targetYear}-${String(targetMonth).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function periodLabel(ymd: string, month: number, year: number): string {
  try {
    const d = new Date(`${ymd}T12:00:00`);
    return `${format(d, "d MMM yyyy", { locale: uk })} · ${MONTH_LABELS_UK[month - 1]} ${year}`;
  } catch {
    return ymd;
  }
}

type PlanInsightSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  insight: InsightCardData | null;
  /** Координати центру поля для скаутингу */
  scoutCoords?: { latitude: number; longitude: number } | null;
  onSaved?: () => void;
};

/** Zero-Data Entry: наряд з автозаповненням з Агро-Радара */
export function PlanInsightSheet({
  open,
  onOpenChange,
  insight,
  scoutCoords = null,
  onSaved,
}: PlanInsightSheetProps) {
  const [selectedFieldIds, setSelectedFieldIds] = useState<string[]>([]);
  const [occurredAt, setOccurredAt] = useState("");
  const [normPerHa, setNormPerHa] = useState("");
  const [equipmentId, setEquipmentId] = useState<string>("");
  const [equipment, setEquipment] = useState<EquipmentForOpsRow[]>([]);
  const [material, setMaterial] = useState<OperationMaterialDraft | null>(null);
  const [pending, startTransition] = useTransition();

  const isScout = insight?.kind === "anomaly";
  const workType = insight
    ? isScout
      ? "Скаутинг"
      : mapDictionaryOpToWorkType(insight.operationName)
    : "Посів";

  useEffect(() => {
    if (!open || !insight) return;
    setSelectedFieldIds(insight.fields.map((f) => f.id));
    setOccurredAt(
      defaultOccurredAt(insight.targetMonth, insight.targetYear)
    );
    setNormPerHa("");
    setEquipmentId("");
    setMaterial(null);
  }, [open, insight]);

  useEffect(() => {
    if (!open) return;
    void listEquipmentForOps().then((res) => {
      if (res.ok) setEquipment(res.data);
    });
  }, [open]);

  const selectedEquipment = useMemo(
    () => equipment.find((e) => e.id === equipmentId) ?? null,
    [equipment, equipmentId]
  );

  const selectedFields = useMemo(() => {
    if (!insight) return [];
    return insight.fields.filter((f) => selectedFieldIds.includes(f.id));
  }, [insight, selectedFieldIds]);

  const totalSelectedAreaHa = useMemo(
    () =>
      selectedFields.reduce(
        (sum, field) =>
          sum +
          (field.areaHa != null && Number.isFinite(field.areaHa)
            ? field.areaHa
            : 0),
        0
      ),
    [selectedFields]
  );

  const needsMaterial = !isScout && operationRequiresMaterial(workType);

  function toggleField(id: string) {
    setSelectedFieldIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  function handleSave() {
    if (!insight) return;
    if (selectedFieldIds.length === 0) {
      toast.error("Оберіть хоча б одне поле");
      return;
    }
    if (
      needsMaterial &&
      (!material?.basRefKey || !(material.qty > 0))
    ) {
      toast.error("Оберіть матеріал зі складу та кількість");
      return;
    }

    const fields = selectedFields;
    const implement = IMPLEMENT_PRESETS[workType] ?? "";
    const implementWidth = IMPLEMENT_WIDTH_DEFAULTS[workType] ?? null;
    const dateLabel = (() => {
      try {
        return format(new Date(`${occurredAt}T12:00:00`), "d MMM", {
          locale: uk,
        });
      } catch {
        return occurredAt;
      }
    })();

    startTransition(async () => {
      let saved = 0;
      const errors: string[] = [];

      for (const field of fields) {
        const area =
          field.areaHa != null && Number.isFinite(field.areaHa)
            ? field.areaHa
            : 0;
        const fuelPlan = estimatePlanFuelLiters(workType, area || 1);
        const wagePlan = estimatePlanWageUah(area || 1);
        const commentParts = [
          isScout
            ? "Агроплан: скаутинг NDVI"
            : "Агроплан: автозаповнення",
          isScout && insight.ndviDropPercent != null
            ? `падіння ${Math.round(insight.ndviDropPercent)}%`
            : null,
          isScout && insight.ndviZoneNote
            ? insight.ndviZoneNote
            : null,
          scoutCoords
            ? `координати ${scoutCoords.latitude.toFixed(5)}, ${scoutCoords.longitude.toFixed(5)}`
            : null,
          !isScout && normPerHa.trim()
            ? `норма ${normPerHa.trim()}`
            : null,
        ].filter(Boolean);

        const input: FieldOperationInput = {
          id:
            typeof crypto !== "undefined" && "randomUUID" in crypto
              ? crypto.randomUUID()
              : `agro-${Date.now()}-${field.id.slice(0, 8)}`,
          fieldKey: `farm:${field.id}`,
          fieldId: field.id,
          seasonYear: insight.targetYear,
          occurredAt,
          type: workType,
          crop: insight.crop,
          date: dateLabel,
          time: "",
          machinery: selectedEquipment?.name?.trim() || "",
          implement,
          areaDone: 0,
          areaTotal: area,
          areaPlan: area > 0 ? area : undefined,
          fuelPlan,
          wagePlan,
          fuelUsed: 0,
          wage: 0,
          status: "planned",
          agronomistComment: commentParts.join(" · "),
          equipmentId: selectedEquipment?.id ?? null,
          wialonUnitId: selectedEquipment?.wialonId ?? null,
          implementWidthM: implementWidth,
          exportStatus: "none",
          materials:
            material && area > 0
              ? [
                  {
                    ...material,
                    qty:
                      fields.length > 1 && totalSelectedAreaHa > 0
                        ? Math.round(
                            (material.qty * area) / totalSelectedAreaHa * 1000
                          ) / 1000
                        : material.qty,
                  },
                ]
              : [],
        };

        try {
          await upsertFieldOperation(input);
          saved += 1;
        } catch (err) {
          errors.push(
            err instanceof Error ? err.message : `Помилка: ${field.name}`
          );
        }
      }

      if (saved > 0) {
        toast.success(
          saved === 1
            ? "Наряд створено"
            : `Створено нарядів: ${saved}`
        );
        onOpenChange(false);
        onSaved?.();
      }
      if (errors.length > 0) {
        toast.error(errors[0]!);
      }
    });
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 overflow-hidden sm:max-w-lg"
      >
        <SheetHeader className="border-b border-border/60 px-5 py-4">
          <SheetTitle>
            {isScout ? "Завдання на скаутинг" : "Спланувати наряд"}
          </SheetTitle>
          <SheetDescription>
            {isScout
              ? "NDVI-аномалія · автозаповнення огляду поля"
              : "Zero-Data Entry · параметри з Агроплану"}
          </SheetDescription>
        </SheetHeader>

        <div className="custom-scrollbar flex-1 space-y-5 overflow-y-auto px-5 py-4">
          <Alert
            className={
              isScout
                ? "border-rose-500/25 bg-rose-500/10 text-foreground"
                : "border-emerald-500/25 bg-emerald-500/10 text-foreground"
            }
          >
            <Sparkles
              className={
                isScout
                  ? "text-rose-600"
                  : "text-emerald-600 dark:text-emerald-400"
              }
            />
            <AlertTitle
              className={
                isScout
                  ? "text-rose-900 dark:text-rose-200"
                  : "text-emerald-900 dark:text-emerald-200"
              }
            >
              {isScout ? "Скаутинг з супутника" : "Автозаповнення"}
            </AlertTitle>
            <AlertDescription className="text-muted-foreground">
              {isScout
                ? "Завдання на фізичний огляд поля автозаповнено (NDVI). Перевірте дату та збережіть."
                : "Параметри автозаповнено на основі агро-рекомендації. Перевірте та призначте техніку."}
              {scoutCoords
                ? ` Координати: ${scoutCoords.latitude.toFixed(5)}, ${scoutCoords.longitude.toFixed(5)}.`
                : ""}
            </AlertDescription>
          </Alert>

          {!insight ? (
            <p className="text-sm text-muted-foreground">Немає даних картки</p>
          ) : (
            <>
              <div className="space-y-2">
                <Label>Культура</Label>
                <Input
                  value={insight.crop}
                  disabled
                  className="bg-muted/40"
                />
              </div>

              <div className="space-y-2">
                <Label>Операція</Label>
                <Input
                  value={`${insight.operationName} → ${workType}`}
                  disabled
                  className="bg-muted/40"
                />
              </div>

              <div className="space-y-2">
                <Label>Поля</Label>
                <div className="flex flex-wrap gap-2 rounded-xl border border-border/60 bg-background/40 p-3">
                  {insight.fields.map((field) => {
                    const on = selectedFieldIds.includes(field.id);
                    return (
                      <button
                        key={field.id}
                        type="button"
                        onClick={() => toggleField(field.id)}
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors",
                          on
                            ? "border-primary/40 bg-primary/10 font-medium text-primary"
                            : "border-border/60 bg-background/50 text-muted-foreground hover:bg-muted/50"
                        )}
                      >
                        {on ? <Check className="h-3 w-3" /> : null}
                        {field.name}
                      </button>
                    );
                  })}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Клік — додати / прибрати поле з наряду
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="agro-period">Період (дата старту)</Label>
                <Input
                  id="agro-period"
                  type="date"
                  value={occurredAt}
                  onChange={(e) => setOccurredAt(e.target.value)}
                />
                <p className="text-[11px] text-muted-foreground">
                  {periodLabel(
                    occurredAt,
                    insight.targetMonth,
                    insight.targetYear
                  )}
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="agro-norm">
                  Норма висіву / витрати (необовʼязково)
                </Label>
                <Input
                  id="agro-norm"
                  placeholder="напр. 25 кг/га"
                  value={normPerHa}
                  onChange={(e) => setNormPerHa(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label>Техніка / тракторист</Label>
                <Select
                  value={equipmentId || undefined}
                  onValueChange={(v) => setEquipmentId(v ?? "")}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Оберіть техніку" />
                  </SelectTrigger>
                  <SelectContent>
                    {equipment.map((eq) => (
                      <SelectItem key={eq.id} value={eq.id}>
                        {eq.name}
                        {eq.wialonId != null ? " · GPS" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {needsMaterial ? (
                <OperationMaterialsPicker
                  workType={workType}
                  areaHa={totalSelectedAreaHa || 1}
                  crop={insight.crop}
                  value={material}
                  onChange={setMaterial}
                  theme="light"
                  required
                />
              ) : null}
            </>
          )}
        </div>

        <SheetFooter className="border-t border-border/60 px-5 py-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Скасувати
          </Button>
          <Button type="button" onClick={handleSave} disabled={pending || !insight}>
            {pending ? (
              <>
                <Loader2 className="animate-spin" />
                Збереження…
              </>
            ) : (
              "Зберегти"
            )}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

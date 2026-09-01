"use client";

import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { format } from "date-fns";
import { ChevronLeft, Loader2, Tractor } from "lucide-react";
import { toast } from "sonner";

import { listEquipmentForOps } from "@/app/admin/equipment/actions";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
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
  findEquipmentOpsOption,
  mergeEquipmentOpsOptions,
  type EquipmentForOpsRow,
  type EquipmentOpsOption,
} from "@/lib/equipment-ops-options";
import {
  estimatePlanFuelLiters,
  estimatePlanWageUah,
  IMPLEMENT_PRESETS,
  IMPLEMENT_WIDTH_DEFAULTS,
  OPERATION_TYPES,
} from "@/lib/field-operation-norms";
import {
  listFieldOperations,
  upsertFieldOperation,
  type FieldOperation,
} from "@/lib/field-operations";
import { fieldOperationsKeyFromFarmId } from "@/lib/field-timeline-ids";
import type { FieldTimelineField } from "@/lib/field-timeline";
import { cn } from "@/lib/utils";

function formatOpDateLabel(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return format(d, "d MMM yyyy", { locale: undefined });
}

type OperationsOperationFormSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  field: FieldTimelineField | null;
  seasonYear: number;
  initial?: FieldOperation | null;
  onSaved: () => void;
};

export function OperationsOperationFormSheet({
  open,
  onOpenChange,
  field,
  seasonYear,
  initial = null,
  onSaved,
}: OperationsOperationFormSheetProps) {
  const fieldKey = field ? fieldOperationsKeyFromFarmId(field.id) : "";
  const isEdit = Boolean(initial);

  const [equipmentLoading, setEquipmentLoading] = useState(false);
  const [catalogEquipment, setCatalogEquipment] = useState<EquipmentForOpsRow[]>(
    []
  );
  const [type, setType] = useState<string>(OPERATION_TYPES[0]);
  const [date, setDate] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [unitKey, setUnitKey] = useState<string | null>(null);
  const [implement, setImplement] = useState(IMPLEMENT_PRESETS.Посів);
  const [areaDone, setAreaDone] = useState("");
  const [fuelUsed, setFuelUsed] = useState("");
  const [wage, setWage] = useState("");
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unitOptions = useMemo(
    () => mergeEquipmentOpsOptions(catalogEquipment, []),
    [catalogEquipment]
  );

  const selectedUnit = useMemo(
    () => findEquipmentOpsOption(unitOptions, { key: unitKey }),
    [unitKey, unitOptions]
  );

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setEquipmentLoading(true);
    void listEquipmentForOps().then((res) => {
      if (cancelled) return;
      if (res.ok) setCatalogEquipment(res.data);
      setEquipmentLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open || !field) return;
    const areaDefault = Number(field.areaHa) || 0;
    if (initial) {
      setType(initial.type || OPERATION_TYPES[0]);
      setDate(initial.occurredAt?.slice(0, 10) || format(new Date(), "yyyy-MM-dd"));
      setImplement(initial.implement || IMPLEMENT_PRESETS.Посів);
      setAreaDone(String(initial.areaDone || areaDefault));
      setFuelUsed(String(initial.fuelUsed ?? estimatePlanFuelLiters(initial.type, initial.areaDone)));
      setWage(String(initial.wage ?? estimatePlanWageUah(initial.areaDone)));
      setComment(initial.agronomistComment ?? "");
      const match = findEquipmentOpsOption(unitOptions, {
        equipmentId: initial.equipmentId,
        wialonUnitId: initial.wialonUnitId,
      });
      setUnitKey(match?.key ?? null);
      return;
    }
    setType(OPERATION_TYPES[0]);
    setDate(format(new Date(), "yyyy-MM-dd"));
    setImplement(IMPLEMENT_PRESETS.Посів);
    setAreaDone(String(areaDefault));
    setFuelUsed(String(estimatePlanFuelLiters(OPERATION_TYPES[0], areaDefault)));
    setWage(String(estimatePlanWageUah(areaDefault)));
    setComment("");
    setUnitKey(unitOptions[0]?.key ?? null);
  }, [field, initial, open, unitOptions]);

  useEffect(() => {
    if (!open || initial) return;
    const area = Number(String(areaDone).replace(",", "."));
    if (!Number.isFinite(area) || area <= 0) return;
    setFuelUsed(String(estimatePlanFuelLiters(type, area)));
    setWage(String(estimatePlanWageUah(area)));
  }, [areaDone, initial, open, type]);

  useEffect(() => {
    if (!open || initial) return;
    setImplement(IMPLEMENT_PRESETS[type] ?? "Знаряддя");
  }, [initial, open, type]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!field || !fieldKey) return;

    const area = Number(String(areaDone).replace(",", "."));
    const fuel = Number(String(fuelUsed).replace(",", "."));
    const pay = Number(String(wage).replace(",", "."));
    const width = IMPLEMENT_WIDTH_DEFAULTS[type] ?? 6;

    if (!selectedUnit) {
      setError(
        equipmentLoading
          ? "Завантаження техніки…"
          : "Оберіть техніку"
      );
      return;
    }
    if (!implement.trim()) {
      setError("Вкажіть знаряддя");
      return;
    }
    if (!Number.isFinite(area) || area <= 0) {
      setError("Вкажіть коректну площу");
      return;
    }
    if (!Number.isFinite(fuel) || fuel < 0 || !Number.isFinite(pay) || pay < 0) {
      setError("Перевірте паливо та оплату");
      return;
    }

    const occurred = new Date(`${date}T12:00:00`);
    const opSeason = Number.isNaN(occurred.getTime())
      ? seasonYear
      : occurred.getMonth() >= 2
        ? occurred.getFullYear()
        : occurred.getFullYear() - 1;

    const op: FieldOperation = {
      id: initial?.id ?? crypto.randomUUID(),
      seasonYear: opSeason,
      occurredAt: date,
      type: type.trim(),
      crop: field.crop || "—",
      date: formatOpDateLabel(date),
      time: initial?.time ?? "08:00 – 18:00",
      machinery: selectedUnit.label,
      implement: implement.trim(),
      areaDone: Math.round(area * 100) / 100,
      areaTotal: Number(field.areaHa) || area,
      fuelUsed: Math.round(fuel),
      wage: Math.round(pay),
      status: "completed",
      agronomistComment: comment.trim() || undefined,
      equipmentId: selectedUnit.equipmentId,
      wialonUnitId: selectedUnit.wialonUnitId,
      implementWidthM: width,
      exportStatus: initial?.exportStatus ?? "none",
    };

    setSaving(true);
    setError(null);
    try {
      await upsertFieldOperation({
        ...op,
        fieldKey,
        fieldId: field.id,
      });
      toast.success(isEdit ? "Наряд оновлено" : "Операцію додано");
      onSaved();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не вдалося зберегти");
    } finally {
      setSaving(false);
    }
  }

  const inputClass = cn(
    "h-11 border-white/10 bg-white/5 text-zinc-50 placeholder:text-zinc-500",
    "focus-visible:border-emerald-500/40 focus-visible:ring-emerald-500/20"
  );

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[92dvh] border-white/10 bg-zinc-950 text-zinc-50">
        <DrawerHeader className="border-b border-white/5 text-left">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="mb-2 inline-flex items-center gap-1 text-sm text-zinc-400 hover:text-zinc-100"
          >
            <ChevronLeft className="size-4" />
            Назад
          </button>
          <DrawerTitle className="flex items-center gap-2 text-zinc-50">
            <Tractor className="size-5 text-orange-400" />
            {isEdit ? "Редагувати наряд" : "Додати наряд"}
          </DrawerTitle>
          <DrawerDescription className="text-zinc-400">
            {field?.name ?? "Поле"} · виконана робота
          </DrawerDescription>
        </DrawerHeader>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
            {error ? (
              <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                {error}
              </p>
            ) : null}

            <div className="space-y-1.5">
              <Label className="text-zinc-400">Тип робіт</Label>
              <Select
                value={type}
                onValueChange={(value) => {
                  if (value) setType(value);
                }}
              >
                <SelectTrigger className={inputClass}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OPERATION_TYPES.map((item) => (
                    <SelectItem key={item} value={item}>
                      {item}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-zinc-400">Дата</Label>
                <Input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-zinc-400">Площа, га</Label>
                <Input
                  inputMode="decimal"
                  value={areaDone}
                  onChange={(e) => setAreaDone(e.target.value)}
                  className={inputClass}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-zinc-400">Техніка</Label>
              <Select
                value={unitKey ?? undefined}
                onValueChange={(value) => setUnitKey(value ?? null)}
                disabled={equipmentLoading || unitOptions.length === 0}
              >
                <SelectTrigger className={inputClass}>
                  <SelectValue
                    placeholder={
                      equipmentLoading ? "Завантаження…" : "Оберіть техніку"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {unitOptions.map((unit: EquipmentOpsOption) => (
                    <SelectItem key={unit.key} value={unit.key}>
                      {unit.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-zinc-400">Знаряддя</Label>
              <Input
                value={implement}
                onChange={(e) => setImplement(e.target.value)}
                className={inputClass}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-zinc-400">Паливо, л</Label>
                <Input
                  inputMode="decimal"
                  value={fuelUsed}
                  onChange={(e) => setFuelUsed(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-zinc-400">Оплата, ₴</Label>
                <Input
                  inputMode="decimal"
                  value={wage}
                  onChange={(e) => setWage(e.target.value)}
                  className={inputClass}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-zinc-400">Коментар</Label>
              <Input
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                className={inputClass}
                placeholder="Необовʼязково"
              />
            </div>
          </div>

          <div className="border-t border-white/5 px-4 py-4">
            <Button
              type="submit"
              disabled={saving || !field}
              className="h-11 w-full bg-emerald-600 text-white hover:bg-emerald-500"
            >
              {saving ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Збереження…
                </>
              ) : isEdit ? (
                "Зберегти зміни"
              ) : (
                "Додати операцію"
              )}
            </Button>
          </div>
        </form>
      </DrawerContent>
    </Drawer>
  );
}

export async function loadFieldOperationByClientKey(
  fieldId: string,
  clientKey: string
): Promise<FieldOperation | null> {
  const fieldKey = fieldOperationsKeyFromFarmId(fieldId);
  const ops = await listFieldOperations(fieldKey);
  return ops.find((op) => op.id === clientKey) ?? null;
}

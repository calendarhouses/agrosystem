"use client";

import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { format } from "date-fns";
import { Loader2, Tractor } from "lucide-react";
import { toast } from "sonner";

import { listEquipmentForOps, listImplementsForOps, type ImplementOption } from "@/app/admin/equipment/actions";
import { Button } from "@/components/ui/button";
import {
  OperationsDatePicker,
  OperationsPanelShell,
  OperationsSheetFooter,
  OperationsSheetHeader,
  useOpsChrome,
} from "@/components/dashboard/operations-sheet-chrome";
import {
  OperationMaterialsPicker,
  type OperationMaterialDraft,
} from "@/components/dashboard/operation-materials-picker";
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
import { operationRequiresMaterial } from "@/lib/operation-material-categories";
import {
  listFieldOperations,
  upsertFieldOperation,
  type FieldOperation,
} from "@/lib/field-operations";
import { fieldOperationsKeyFromFarmId } from "@/lib/field-timeline-ids";
import type { FieldTimelineField } from "@/lib/field-timeline";

function formatOpDateLabel(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return format(d, "d MMM yyyy", { locale: undefined });
}

type OperationsOperationFormProps = {
  field: FieldTimelineField;
  seasonYear: number;
  initial?: FieldOperation | null;
  onBack?: () => void;
  onSaved: () => void;
  onCancel?: () => void;
};

export function OperationsOperationForm({
  field,
  seasonYear,
  initial = null,
  onBack,
  onSaved,
  onCancel,
}: OperationsOperationFormProps) {
  const chrome = useOpsChrome();
  const fieldKey = fieldOperationsKeyFromFarmId(field.id);
  const isEdit = Boolean(initial);

  const [equipmentLoading, setEquipmentLoading] = useState(false);
  const [catalogEquipment, setCatalogEquipment] = useState<EquipmentForOpsRow[]>(
    []
  );
  const [type, setType] = useState<string>(OPERATION_TYPES[0]);
  const [date, setDate] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [unitKey, setUnitKey] = useState<string | null>(null);
  const [implement, setImplement] = useState(IMPLEMENT_PRESETS.Посів);
  const [implementId, setImplementId] = useState<string | null>(null);
  const [implementOptions, setImplementOptions] = useState<ImplementOption[]>([]);
  const [areaDone, setAreaDone] = useState("");
  const [fuelUsed, setFuelUsed] = useState("");
  const [wage, setWage] = useState("");
  const [comment, setComment] = useState("");
  const [material, setMaterial] = useState<OperationMaterialDraft | null>(null);
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
    let cancelled = false;
    void listImplementsForOps().then((res) => {
      if (cancelled || !res.ok) return;
      setImplementOptions(res.data);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
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
  }, []);

  useEffect(() => {
    const areaDefault = Number(field.areaHa) || 0;
    if (initial) {
      setType(initial.type || OPERATION_TYPES[0]);
      setDate(initial.occurredAt?.slice(0, 10) || format(new Date(), "yyyy-MM-dd"));
      setImplement(initial.implement || IMPLEMENT_PRESETS.Посів);
      setImplementId(null);
      setAreaDone(String(initial.areaDone || areaDefault));
      setFuelUsed(
        String(initial.fuelUsed ?? estimatePlanFuelLiters(initial.type, initial.areaDone))
      );
      setWage(String(initial.wage ?? estimatePlanWageUah(initial.areaDone)));
      setComment(initial.agronomistComment ?? "");
      setMaterial(initial.materials?.[0] ?? null);
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
    setImplementId(null);
    setAreaDone(String(areaDefault));
    setFuelUsed(String(estimatePlanFuelLiters(OPERATION_TYPES[0], areaDefault)));
    setWage(String(estimatePlanWageUah(areaDefault)));
    setComment("");
    setMaterial(null);
    setUnitKey(unitOptions[0]?.key ?? null);
  }, [field, initial, unitOptions]);

  useEffect(() => {
    if (initial) return;
    const area = Number(String(areaDone).replace(",", "."));
    if (!Number.isFinite(area) || area <= 0) return;
    setFuelUsed(String(estimatePlanFuelLiters(type, area)));
    setWage(String(estimatePlanWageUah(area)));
  }, [areaDone, initial, type]);

  useEffect(() => {
    if (initial) return;
    setImplement(IMPLEMENT_PRESETS[type] ?? "Знаряддя");
    setImplementId(null);
  }, [initial, type]);

  useEffect(() => {
    if (implementOptions.length === 0 || !implement.trim()) return;
    const matched = implementOptions.find(
      (item) =>
        item.name.trim().toLowerCase() === implement.trim().toLowerCase()
    );
    if (matched) setImplementId(matched.id);
  }, [implementOptions, implement]);

  function handleImplementSelect(id: string) {
    const item = implementOptions.find((row) => row.id === id);
    if (!item) return;
    setImplementId(item.id);
    setImplement(item.name);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();

    const area = Number(String(areaDone).replace(",", "."));
    const fuel = Number(String(fuelUsed).replace(",", "."));
    const pay = Number(String(wage).replace(",", "."));
    const width = IMPLEMENT_WIDTH_DEFAULTS[type] ?? 6;

    if (!selectedUnit) {
      setError(
        equipmentLoading ? "Завантаження техніки…" : "Оберіть техніку"
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
    if (
      operationRequiresMaterial(type) &&
      (!material?.basRefKey || !(material.qty > 0))
    ) {
      setError("Оберіть матеріал зі складу та кількість");
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
      materials: material ? [material] : [],
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
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не вдалося зберегти");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
      <OperationsSheetHeader
        icon={Tractor}
        accent="orange"
        title={isEdit ? "Редагувати наряд" : "Додати наряд"}
        description={
          <>
            {field.name}
            {field.crop ? ` · ${field.crop}` : ""}
          </>
        }
        onBack={onBack ?? onCancel}
      />

      <div className={chrome.body} data-vaul-no-drag="" data-allow-pan="true">
        {error ? (
          <p className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {error}
          </p>
        ) : null}

        <section className="space-y-2">
          <p className={chrome.label}>Тип робіт</p>
          <Select
            value={type}
            onValueChange={(value) => {
              if (value) setType(value);
            }}
          >
            <SelectTrigger className={chrome.selectTrigger}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent className={chrome.selectContent}>
              {OPERATION_TYPES.map((item) => (
                <SelectItem key={item} value={item} className={chrome.selectItem}>
                  {item}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </section>

        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="min-w-0 space-y-2">
            <Label className={chrome.label}>Дата</Label>
            <OperationsDatePicker value={date} onChange={setDate} />
          </div>
          <div className="min-w-0 space-y-2">
            <Label className={chrome.label}>Площа, га</Label>
            <input
              inputMode="decimal"
              value={areaDone}
              onChange={(e) => setAreaDone(e.target.value)}
              className={chrome.input}
            />
          </div>
        </section>

        <section className="space-y-2">
          <p className={chrome.label}>Техніка</p>
          <Select
            value={unitKey ?? undefined}
            onValueChange={(value) => setUnitKey(value ?? null)}
            disabled={equipmentLoading || unitOptions.length === 0}
          >
            <SelectTrigger className={chrome.selectTrigger}>
              <SelectValue
                placeholder={
                  equipmentLoading ? "Завантаження…" : "Оберіть техніку"
                }
              />
            </SelectTrigger>
            <SelectContent className={chrome.selectContent}>
              {unitOptions.map((unit: EquipmentOpsOption) => (
                <SelectItem
                  key={unit.key}
                  value={unit.key}
                  className={chrome.selectItem}
                >
                  {unit.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </section>

        <section className="space-y-2">
          <Label className={chrome.label}>Знаряддя</Label>
          {implementOptions.length > 0 ? (
            <Select
              value={implementId ?? undefined}
              onValueChange={(value) => {
                if (value) handleImplementSelect(value);
              }}
            >
              <SelectTrigger className={chrome.selectTrigger}>
                <SelectValue placeholder="Оберіть знаряддя" />
              </SelectTrigger>
              <SelectContent className={chrome.selectContent}>
                {implementOptions.map((item) => (
                  <SelectItem
                    key={item.id}
                    value={item.id}
                    className={chrome.selectItem}
                  >
                    {item.name}
                    {item.workingWidthM > 0
                      ? ` · ${item.workingWidthM} м`
                      : " · 0 м"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <input
              value={implement}
              onChange={(e) => setImplement(e.target.value)}
              className={chrome.input}
              placeholder="Сівалка, культиватор…"
            />
          )}
        </section>

        <OperationMaterialsPicker
          workType={type}
          areaHa={Number(String(areaDone).replace(",", ".")) || Number(field.areaHa) || 0}
          crop={field.crop}
          value={material}
          onChange={setMaterial}
          theme="dark"
        />

        <section className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label className={chrome.label}>Паливо, л</Label>
            <input
              inputMode="decimal"
              value={fuelUsed}
              onChange={(e) => setFuelUsed(e.target.value)}
              className={chrome.input}
            />
          </div>
          <div className="space-y-2">
            <Label className={chrome.label}>Оплата, ₴</Label>
            <input
              inputMode="decimal"
              value={wage}
              onChange={(e) => setWage(e.target.value)}
              className={chrome.input}
            />
          </div>
        </section>

        <section className="space-y-2">
          <Label className={chrome.label}>Коментар</Label>
          <input
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            className={chrome.input}
            placeholder="Необовʼязково"
          />
        </section>
      </div>

      <OperationsSheetFooter>
        <Button
          type="submit"
          disabled={saving}
          className={chrome.primaryBtn}
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
      </OperationsSheetFooter>
    </form>
  );
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
  return (
    <OperationsPanelShell
      open={open}
      onOpenChange={onOpenChange}
      title={initial ? "Редагувати наряд" : "Додати наряд"}
    >
      {field ? (
        <OperationsOperationForm
          field={field}
          seasonYear={seasonYear}
          initial={initial}
          onBack={() => onOpenChange(false)}
          onSaved={() => {
            onSaved();
            onOpenChange(false);
          }}
        />
      ) : null}
    </OperationsPanelShell>
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

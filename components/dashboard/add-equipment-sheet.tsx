"use client";

import { useState, useTransition, type FormEvent } from "react";
import { AlertCircle, Loader2, MapPinned, Plus, Tractor, Warehouse } from "lucide-react";
import { toast } from "sonner";

import {
  createLocalEquipment,
} from "@/app/admin/equipment/actions";
import {
  EQUIPMENT_WORK_SCOPE_OPTIONS,
  LOCAL_EQUIPMENT_TYPE_OPTIONS,
  type EquipmentWorkScope,
  type LocalEquipmentType,
} from "@/lib/equipment-local";
import {
  FuelPanelShell,
  FuelSheetHeader,
  fuelFieldLabelClass,
  fuelInputClass,
  fuelPrimaryBtnClass,
  fuelSelectTriggerClass,
  fuelSheetBodyClass,
  fuelSheetStickyFooterClass,
} from "@/components/dashboard/fuel-sheet-chrome";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (payload: { id: string; name: string }) => void;
};

export function AddEquipmentSheet({ open, onOpenChange, onCreated }: Props) {
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [type, setType] = useState<LocalEquipmentType>("tractor");
  const [workScope, setWorkScope] = useState<EquipmentWorkScope | null>(null);
  const [code, setCode] = useState("");
  const [tankLiters, setTankLiters] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  function reset() {
    setName("");
    setType("tractor");
    setWorkScope(null);
    setCode("");
    setTankLiters("");
    setFormError(null);
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      setFormError("Вкажіть назву техніки");
      return;
    }
    if (workScope !== "field" && workScope !== "base") {
      setFormError("Оберіть категорію: Поля або База");
      return;
    }

    const tankRaw = tankLiters.trim().replace(",", ".");
    const tankNum = tankRaw ? Number(tankRaw) : null;
    if (tankRaw && (!Number.isFinite(tankNum) || (tankNum ?? 0) <= 0)) {
      setFormError("Обʼєм бака має бути більше нуля");
      return;
    }

    startTransition(async () => {
      const res = await createLocalEquipment({
        name: trimmed,
        type,
        workScope,
        code: code.trim() || null,
        fuelTankVolume: tankNum,
      });
      if (!res.ok) {
        setFormError(res.error);
        return;
      }
      const scopeLabel = workScope === "base" ? "База" : "Поля";
      toast.success(`Додано: ${res.name} · ${scopeLabel}`);
      reset();
      onCreated?.({ id: res.id, name: res.name });
      onOpenChange(false);
    });
  }

  const canSubmit =
    !pending && name.trim().length >= 2 && (workScope === "field" || workScope === "base");

  return (
    <FuelPanelShell
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
      title="Нова техніка"
    >
      <FuelSheetHeader
        icon={Plus}
        title="Додати техніку"
        description="Обовʼязково оберіть Поля або База — для бухгалтерії / BAS. Техніка зʼявиться в Паливі для ручного списання"
        accent="emerald"
      />

      <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
        <div
          className={cn(fuelSheetBodyClass, "space-y-5")}
          data-vaul-no-drag=""
          data-allow-pan="true"
        >
          <section className="space-y-2.5">
            <p className={fuelFieldLabelClass}>Категорія для бухгалтерії</p>
            <div className="grid grid-cols-2 gap-2.5">
              {EQUIPMENT_WORK_SCOPE_OPTIONS.map((option) => {
                const active = workScope === option.id;
                const Icon = option.id === "field" ? MapPinned : Warehouse;
                return (
                  <button
                    key={option.id}
                    type="button"
                    disabled={pending}
                    onClick={() => setWorkScope(option.id)}
                    className={cn(
                      "flex min-h-[3.75rem] flex-col items-start gap-1.5 rounded-2xl border px-3.5 py-3 text-left transition-all",
                      active
                        ? "border-[#276749] bg-[#276749] text-white shadow-[0_8px_20px_-10px_rgba(39,103,73,0.55)]"
                        : "border-[#E0DBD0] bg-white text-zinc-800 hover:border-[#276749]/40"
                    )}
                  >
                    <span
                      className={cn(
                        "inline-flex h-8 w-8 items-center justify-center rounded-xl",
                        active ? "bg-white/15" : "bg-[#276749]/10 text-[#276749]"
                      )}
                    >
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="text-[14px] font-bold tracking-tight">
                      {option.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="space-y-2.5">
            <div>
              <p className={fuelFieldLabelClass}>Назва</p>
              <p className="mt-0.5 text-xs text-zinc-400">
                Як у журналі заправок і нарядах
              </p>
            </div>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Напр. МТЗ-82 · без GPS"
              className={fuelInputClass}
              autoFocus
              disabled={pending}
            />
          </section>

          <section className="space-y-2.5">
            <p className={fuelFieldLabelClass}>Тип</p>
            <Select
              value={type}
              onValueChange={(v) => setType(v as LocalEquipmentType)}
              disabled={pending}
            >
              <SelectTrigger className={fuelSelectTriggerClass}>
                <SelectValue placeholder="Оберіть тип">
                  {LOCAL_EQUIPMENT_TYPE_OPTIONS.find((o) => o.id === type)
                    ?.label ?? "Оберіть тип"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent sheetOnMobile={false} className="z-[280]">
                {LOCAL_EQUIPMENT_TYPE_OPTIONS.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </section>

          <section className="space-y-2.5">
            <div>
              <p className={fuelFieldLabelClass}>Код / інвентарний (необовʼязково)</p>
            </div>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Напр. Т-14"
              className={fuelInputClass}
              disabled={pending}
            />
          </section>

          <section className="space-y-2.5">
            <div>
              <p className={fuelFieldLabelClass}>Обʼєм бака, л (необовʼязково)</p>
              <p className="mt-0.5 text-xs text-zinc-400">
                Допомагає в Паливі розуміти заправки
              </p>
            </div>
            <input
              inputMode="decimal"
              value={tankLiters}
              onChange={(e) => setTankLiters(e.target.value)}
              placeholder="Напр. 180"
              className={fuelInputClass}
              disabled={pending}
            />
          </section>

          <div className="flex items-start gap-2 rounded-2xl border border-[#276749]/15 bg-[#276749]/[0.06] px-3.5 py-3 text-[12px] leading-snug text-zinc-700">
            <Tractor className="mt-0.5 h-4 w-4 shrink-0 text-[#276749]" />
            <p>
              Категорія <strong>Поля</strong> — у списку «Без трекера»;{" "}
              <strong>База</strong> — в окремий список «База»
            </p>
          </div>

          {formError ? (
            <div className="flex items-start gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-sm text-rose-900">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>{formError}</p>
            </div>
          ) : null}
        </div>

        <div className={fuelSheetStickyFooterClass}>
          <Button
            type="submit"
            disabled={!canSubmit}
            className={cn(fuelPrimaryBtnClass, "w-full")}
          >
            {pending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Збереження…
              </>
            ) : (
              <>
                <Plus className="h-4 w-4" />
                Додати в довідник
              </>
            )}
          </Button>
        </div>
      </form>
    </FuelPanelShell>
  );
}

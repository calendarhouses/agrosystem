"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Loader2, Save } from "lucide-react";
import { toast } from "sonner";

import { patchFieldPassportQuick } from "@/app/admin/fields/actions";
import {
  FIELD_CROP_OPTIONS,
  normalizeFieldCrop,
} from "@/components/dashboard/field-passport-form";
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
  hasFieldArea,
  hasFieldCrop,
} from "@/lib/field-passport";
import { suppressLocalFarmFieldsRealtimeToast } from "@/lib/realtime-toast-guard";
import { cn } from "@/lib/utils";

type FieldPassportQuickFixProps = {
  fieldId: string;
  fieldName: string;
  crop: string;
  areaHa: number;
  onSaved: (patch: { crop: string; areaHa: number }) => void;
  className?: string;
};

/**
 * Компактна картка: дописати культуру / площу прямо в потоці (списання, наряд).
 */
export function FieldPassportQuickFix({
  fieldId,
  fieldName,
  crop,
  areaHa,
  onSaved,
  className,
}: FieldPassportQuickFixProps) {
  const needsCrop = !hasFieldCrop(crop);
  const needsArea = !hasFieldArea(areaHa);

  const [draftCrop, setDraftCrop] = useState(() =>
    hasFieldCrop(crop) ? normalizeFieldCrop(crop) : FIELD_CROP_OPTIONS[0]
  );
  const [draftArea, setDraftArea] = useState(() =>
    hasFieldArea(areaHa) ? String(areaHa) : ""
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraftCrop(
      hasFieldCrop(crop) ? normalizeFieldCrop(crop) : FIELD_CROP_OPTIONS[0]
    );
    setDraftArea(hasFieldArea(areaHa) ? String(areaHa) : "");
  }, [crop, areaHa, fieldId]);

  if (!needsCrop && !needsArea) return null;

  async function handleSave() {
    setError(null);
    const nextCrop = needsCrop ? normalizeFieldCrop(draftCrop) : normalizeFieldCrop(crop);
    const nextArea = needsArea
      ? Number(String(draftArea).replace(",", "."))
      : Number(areaHa);

    if (needsCrop && !hasFieldCrop(nextCrop)) {
      setError("Оберіть культуру");
      return;
    }
    if (needsArea && !hasFieldArea(nextArea)) {
      setError("Вкажіть площу поля (га)");
      return;
    }

    setSaving(true);
    suppressLocalFarmFieldsRealtimeToast();
    const res = await patchFieldPassportQuick(fieldId, {
      crop: needsCrop ? nextCrop : undefined,
      areaHa: needsArea ? nextArea : undefined,
    });
    setSaving(false);

    if (!res.ok) {
      setError(res.error);
      toast.error(res.error);
      return;
    }

    onSaved({ crop: res.data.crop, areaHa: res.data.areaHa });
    toast.success("Паспорт поля оновлено");
  }

  return (
    <div
      className={cn(
        "rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 via-white to-amber-50/40 p-4 shadow-sm",
        className
      )}
    >
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
          <AlertTriangle className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-zinc-900">Паспорт поля</p>
          <p className="mt-0.5 text-xs leading-relaxed text-zinc-600">
            Для «{fieldName}» потрібно дописати{" "}
            {needsCrop && needsArea
              ? "культуру та площу"
              : needsCrop
                ? "культуру"
                : "площу"}
            . Збережеться в картці поля — більше не питатиме.
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {needsCrop ? (
          <div className="space-y-1.5">
            <Label className="text-[10px] font-semibold tracking-wider text-zinc-500 uppercase">
              Культура
            </Label>
            <Select
              value={draftCrop}
              onValueChange={(value) => {
                if (typeof value === "string" && value) {
                  setDraftCrop(normalizeFieldCrop(value));
                }
              }}
            >
              <SelectTrigger className="h-10 w-full rounded-xl border-[#E5DFD3] bg-white text-sm">
                <SelectValue placeholder="Оберіть культуру" />
              </SelectTrigger>
              <SelectContent className="z-[200] border-[#E5DFD3] bg-white">
                {FIELD_CROP_OPTIONS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}

        {needsArea ? (
          <div className="space-y-1.5">
            <Label className="text-[10px] font-semibold tracking-wider text-zinc-500 uppercase">
              Площа, га
            </Label>
            <Input
              value={draftArea}
              onChange={(e) => setDraftArea(e.target.value)}
              inputMode="decimal"
              placeholder="Напр. 22.5"
              className="h-10 rounded-xl border-[#E5DFD3] bg-white text-sm tabular-nums"
            />
          </div>
        ) : null}
      </div>

      {error ? (
        <p className="mt-3 text-xs text-red-600">{error}</p>
      ) : null}

      <Button
        type="button"
        disabled={saving}
        onClick={() => void handleSave()}
        className="mt-4 h-10 w-full rounded-xl bg-[#276749] text-sm font-semibold text-white hover:bg-[#1f5339]"
      >
        {saving ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Зберігаємо…
          </>
        ) : (
          <>
            <Save className="h-4 w-4" />
            Зберегти паспорт
          </>
        )}
      </Button>
    </div>
  );
}

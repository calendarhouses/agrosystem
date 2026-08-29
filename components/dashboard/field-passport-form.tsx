"use client";

import { Pentagon, Save, Trash2 } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FIELD_COLOR_OPTIONS } from "@/lib/farm-fields";
import type { MapFieldSource } from "@/lib/map-fields";
import { cn } from "@/lib/utils";

export const FIELD_CROP_OPTIONS = [
  "Кукурудза",
  "Ріпак",
  "Соняшник",
  "Пшениця",
  "Соя",
  "Ячмінь",
  "Цукровий буряк",
  "Гречка",
] as const;

/**
 * Нормалізує культуру до каталогу. Порожнє лишається порожнім —
 * не підставляємо «Кукурудзу» мовчки. Невідому назву зберігаємо як є.
 */
export function normalizeFieldCrop(value: string | null | undefined): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return "";
  const match = FIELD_CROP_OPTIONS.find(
    (option) => option.toLowerCase() === trimmed.toLowerCase()
  );
  return match ?? trimmed;
}

export function isCatalogFieldCrop(value: string): boolean {
  return FIELD_CROP_OPTIONS.some(
    (option) => option.toLowerCase() === value.trim().toLowerCase()
  );
}

type FieldPassportFormProps = {
  mode: "create" | "edit";
  fieldName: string;
  onFieldNameChange: (value: string) => void;
  crop: string;
  onCropChange: (value: string) => void;
  areaHa: number;
  onAreaHaChange: (value: number) => void;
  color: string;
  onColorChange: (value: string) => void;
  busy?: boolean;
  savedFlash?: boolean;
  saveHint?: string | null;
  onSave: () => void;
  source?: MapFieldSource;
  /** Якщо false — кнопка «Видалити» прихована (демо / Wialon без паспорта) */
  canDelete?: boolean;
  confirmDelete?: boolean;
  onConfirmDeleteChange?: (value: boolean) => void;
  onDelete?: () => void;
  onEditGeometry?: () => void;
  showEditGeometry?: boolean;
  className?: string;
};

export function FieldPassportForm({
  mode,
  fieldName,
  onFieldNameChange,
  crop,
  onCropChange,
  areaHa,
  onAreaHaChange,
  color,
  onColorChange,
  busy = false,
  savedFlash = false,
  saveHint = null,
  onSave,
  source = "wialon",
  canDelete: canDeleteProp,
  confirmDelete = false,
  onConfirmDeleteChange,
  onDelete,
  onEditGeometry,
  showEditGeometry = false,
  className,
}: FieldPassportFormProps) {
  const canDelete = canDeleteProp ?? source === "saved";

  return (
    <div className={cn("space-y-5", className)} data-vaul-no-drag="">
      <div className="space-y-1.5">
        <Label className="text-[11px] tracking-wider text-zinc-500 uppercase">
          Назва
        </Label>
        <Input
          value={fieldName}
          onChange={(event) => onFieldNameChange(event.target.value)}
          className="h-11 rounded-xl border-[#E5DFD3] bg-white text-base md:text-sm"
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-[11px] tracking-wider text-zinc-500 uppercase">
          Культура
        </Label>
        <Select
          items={[
            ...(crop && !isCatalogFieldCrop(crop)
              ? [{ value: crop, label: crop }]
              : []),
            ...FIELD_CROP_OPTIONS.map((option) => ({
              value: option,
              label: option,
            })),
          ]}
          value={crop || null}
          onValueChange={(value) => {
            if (typeof value === "string" && value) {
              onCropChange(normalizeFieldCrop(value));
            }
          }}
        >
          <SelectTrigger className="h-11 w-full min-w-0 rounded-xl border-[#E5DFD3] bg-white text-base md:text-sm">
            <SelectValue placeholder="Оберіть культуру" />
          </SelectTrigger>
          <SelectContent className="border-[#E5DFD3] bg-white">
            {crop && !isCatalogFieldCrop(crop) ? (
              <SelectItem value={crop}>{crop}</SelectItem>
            ) : null}
            {FIELD_CROP_OPTIONS.map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label className="text-[11px] tracking-wider text-zinc-500 uppercase">
          Площа, га
        </Label>
        <Input
          type="number"
          min={0}
          step={0.01}
          value={areaHa}
          onChange={(event) => onAreaHaChange(Number(event.target.value) || 0)}
          className="h-11 rounded-xl border-[#E5DFD3] bg-white text-base tabular-nums md:text-sm"
        />
      </div>

      <div className="space-y-2">
        <Label className="text-[11px] tracking-wider text-zinc-500 uppercase">
          Колір на карті
        </Label>
        <div className="flex flex-wrap gap-2.5">
          {FIELD_COLOR_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              title={option.label}
              onClick={() => onColorChange(option.value)}
              className={cn(
                "h-11 w-11 rounded-full border-2 transition-transform md:h-9 md:w-9",
                color === option.value
                  ? "scale-110 border-zinc-900"
                  : "border-white/80 hover:scale-105"
              )}
              style={{ backgroundColor: option.value }}
            />
          ))}
        </div>
      </div>

      {showEditGeometry && onEditGeometry ? (
        <button
          type="button"
          onClick={onEditGeometry}
          className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-[#E5DFD3] bg-white px-4 py-2.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50"
        >
          <Pentagon className="h-4 w-4" />
          Редагувати контур на карті
        </button>
      ) : null}

      <button
        type="button"
        disabled={busy || savedFlash || !fieldName.trim()}
        onClick={onSave}
        className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#276749] text-sm font-bold text-white shadow-sm transition-colors hover:bg-[#22543d] disabled:opacity-60"
      >
        <Save className="h-4 w-4" />
        {savedFlash
          ? "Збережено ✓"
          : busy
            ? "Збереження…"
            : mode === "edit"
              ? "Оновити паспорт"
              : "Зберегти паспорт"}
      </button>

      {saveHint ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {saveHint}
        </p>
      ) : (
        <p className="text-xs leading-relaxed text-zinc-500">
          Паспорт зберігається в базі й одразу оновлює карту та економіку поля.
        </p>
      )}

      {confirmDelete ? (
        <div className="space-y-3 rounded-2xl border border-red-200 bg-red-50 p-4">
          <p className="text-sm font-semibold text-red-800">
            {canDelete
              ? `Видалити «${fieldName}» назавжди?`
              : source === "wialon"
                ? "Геозону Wialon не можна видалити з AgroSystem."
                : "Демо-поле лише для огляду."}
          </p>
          <div className="flex gap-2">
            {canDelete && onDelete ? (
              <button
                type="button"
                disabled={busy}
                onClick={onDelete}
                className="inline-flex h-11 flex-1 items-center justify-center rounded-xl bg-red-600 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-60"
              >
                Так, видалити
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => onConfirmDeleteChange?.(false)}
              className={cn(
                "inline-flex h-11 items-center justify-center rounded-xl border border-[#E5DFD3] bg-white text-sm font-semibold text-zinc-700 hover:bg-zinc-50",
                canDelete ? "flex-1" : "w-full"
              )}
            >
              {canDelete ? "Скасувати" : "Зрозуміло"}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-red-50 py-3 text-sm font-medium text-red-700 transition-colors hover:bg-red-100"
          onClick={() => onConfirmDeleteChange?.(true)}
        >
          <Trash2 className="h-4 w-4" />
          Видалити поле
        </button>
      )}
    </div>
  );
}

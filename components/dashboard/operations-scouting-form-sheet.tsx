"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { format } from "date-fns";
import { Camera, ImageIcon, Loader2, Search, X } from "lucide-react";
import { toast } from "sonner";

import { createScoutingReport } from "@/app/admin/scouting/actions";
import {
  OperationsDatePicker,
  OperationsPanelShell,
  OperationsSheetFooter,
  OperationsSheetHeader,
  useOpsChrome,
} from "@/components/dashboard/operations-sheet-chrome";
import { Label } from "@/components/ui/label";
import type { FieldTimelineField } from "@/lib/field-timeline";
import { cn } from "@/lib/utils";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

type OperationsScoutingFormProps = {
  field: FieldTimelineField;
  onBack?: () => void;
  onSaved: () => void;
};

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const base64 = result.includes(",") ? result.split(",")[1]! : result;
      resolve(base64);
    };
    reader.onerror = () => reject(new Error("Не вдалося прочитати файл"));
    reader.readAsDataURL(file);
  });
}

export function OperationsScoutingForm({
  field,
  onBack,
  onSaved,
}: OperationsScoutingFormProps) {
  const chrome = useOpsChrome();
  const inputRef = useRef<HTMLInputElement>(null);
  const [date, setDate] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [notes, setNotes] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!photo) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(photo);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  function handlePickFile(file: File | null) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Оберіть зображення (JPEG, PNG, WebP)");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      toast.error("Фото має бути до 10 МБ");
      return;
    }
    setPhoto(file);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!photo || submitting) {
      if (!photo) toast.error("Додайте фото з поля");
      return;
    }

    setSubmitting(true);
    try {
      const imageBase64 = await fileToBase64(photo);
      const res = await createScoutingReport({
        fieldId: field.id,
        notes,
        date,
        imageBase64,
        imageMimeType: photo.type,
        imageFileName: photo.name,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Звіт скаутингу збережено");
      onSaved();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Не вдалося зберегти звіт"
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
      <OperationsSheetHeader
        icon={Search}
        accent="sky"
        title="Скаутинг"
        description={field.name}
        onBack={onBack}
      />

      <div className={chrome.body}>
        <section className="space-y-2">
          <Label className={chrome.label}>Дата обходу</Label>
          <OperationsDatePicker value={date} onChange={setDate} />
        </section>

        <section className="space-y-2">
          <Label className={chrome.label}>Фото з поля</Label>
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
            className="sr-only"
            onChange={(e) => handlePickFile(e.target.files?.[0] ?? null)}
          />

          {previewUrl ? (
            <div className="relative overflow-hidden rounded-2xl border border-white/10">
              <img
                src={previewUrl}
                alt=""
                className="aspect-[4/3] w-full object-cover"
              />
              <button
                type="button"
                onClick={() => {
                  setPhoto(null);
                  if (inputRef.current) inputRef.current.value = "";
                }}
                className="absolute top-2 right-2 inline-flex size-9 items-center justify-center rounded-full border border-white/15 bg-black/50 text-zinc-100 backdrop-blur-sm transition hover:bg-black/70"
                aria-label="Прибрати фото"
              >
                <X className="size-4" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className={cn(
                "flex w-full flex-col items-center justify-center gap-3 rounded-2xl border border-dashed px-4 py-10 transition",
                chrome.surface === "light"
                  ? "border-[#E5DFD3] bg-[#F4F1EA]/60 hover:border-sky-300 hover:bg-white"
                  : "border-white/15 bg-white/[0.03] hover:border-sky-500/30 hover:bg-white/[0.05]"
              )}
            >
              <span
                className={cn(
                  "flex size-14 items-center justify-center rounded-2xl ring-1",
                  chrome.surface === "light"
                    ? "bg-sky-50 text-sky-600 ring-sky-200"
                    : "bg-sky-500/15 text-sky-300 ring-sky-500/25"
                )}
              >
                <Camera className="size-6" />
              </span>
              <div className="text-center">
                <p
                  className={cn(
                    "text-sm font-semibold",
                    chrome.surface === "light" ? "text-zinc-800" : "text-zinc-100"
                  )}
                >
                  Додати фото
                </p>
                <p
                  className={cn(
                    "mt-1 text-xs",
                    chrome.surface === "light" ? "text-zinc-500" : "text-zinc-400"
                  )}
                >
                  JPEG, PNG, WebP · до 10 МБ
                </p>
              </div>
            </button>
          )}

          {previewUrl ? (
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className={cn(
                "inline-flex items-center gap-2 text-sm font-medium",
                chrome.surface === "light" ? "text-sky-700" : "text-sky-300"
              )}
            >
              <ImageIcon className="size-4" />
              Замінити фото
            </button>
          ) : null}
        </section>

        <section className="space-y-2">
          <Label className={chrome.label}>Нотатки</Label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={4}
            placeholder="Що побачили на полі: фаза, шкідники, вологість ґрунту…"
            className={cn(
              chrome.input,
              "min-h-[7rem] resize-none py-3 leading-relaxed"
            )}
          />
        </section>
      </div>

      <OperationsSheetFooter>
        <button
          type="submit"
          disabled={submitting || !photo}
          className={cn(
            chrome.primaryBtn,
            "bg-sky-600 shadow-[0_8px_24px_-10px_rgba(2,132,199,0.55)] hover:bg-sky-500"
          )}
        >
          {submitting ? (
            <>
              <Loader2 className="mr-2 inline size-4 animate-spin" />
              Збереження…
            </>
          ) : (
            "Зберегти звіт"
          )}
        </button>
      </OperationsSheetFooter>
    </form>
  );
}

type OperationsScoutingFormSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  field: FieldTimelineField | null;
  onSaved: () => void;
};

export function OperationsScoutingFormSheet({
  open,
  onOpenChange,
  field,
  onSaved,
}: OperationsScoutingFormSheetProps) {
  return (
    <OperationsPanelShell
      open={open}
      onOpenChange={onOpenChange}
      title="Скаутинг"
    >
      {field ? (
        <OperationsScoutingForm
          field={field}
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

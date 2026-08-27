"use client";

import { useEffect, useRef, useState } from "react";
import {
  FileText,
  ImageIcon,
  Loader2,
  Paperclip,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";

import type { AttachmentEntityType } from "@/lib/operation-attachments";
import { cn } from "@/lib/utils";

export type PendingAttachment = {
  id: string;
  file: File;
  previewUrl?: string;
};

export type RemoteAttachment = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  signedUrl?: string | null;
};

type Props = {
  entityType: AttachmentEntityType;
  /** Після збереження операції — upload одразу на сервер */
  entityId?: string | null;
  /** Локальні файли до створення entity */
  pending?: PendingAttachment[];
  onPendingChange?: (files: PendingAttachment[]) => void;
  className?: string;
  compact?: boolean;
};

function isImage(mime: string) {
  return mime.startsWith("image/");
}

export function AttachmentDropzone({
  entityType,
  entityId = null,
  pending = [],
  onPendingChange,
  className,
  compact = false,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [remote, setRemote] = useState<RemoteAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!entityId) {
      setRemote([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void fetch(
      `/api/attachments?entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(entityId)}`
    )
      .then((r) => r.json())
      .then((json: { ok?: boolean; attachments?: RemoteAttachment[] }) => {
        if (cancelled) return;
        if (json.ok && Array.isArray(json.attachments)) {
          setRemote(json.attachments);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [entityType, entityId]);

  async function uploadFile(file: File) {
    if (!entityId) {
      const id = crypto.randomUUID();
      const previewUrl = isImage(file.type)
        ? URL.createObjectURL(file)
        : undefined;
      onPendingChange?.([...pending, { id, file, previewUrl }]);
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.set("entityType", entityType);
      form.set("entityId", entityId);
      form.set("file", file);
      const res = await fetch("/api/attachments", {
        method: "POST",
        body: form,
      });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        attachment?: RemoteAttachment;
      };
      if (!json.ok || !json.attachment) {
        toast.error(json.error || "Не вдалося завантажити");
        return;
      }
      setRemote((prev) => [...prev, json.attachment!]);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Не вдалося завантажити"
      );
    } finally {
      setUploading(false);
    }
  }

  function onPick(files: FileList | null) {
    if (!files?.length) return;
    void (async () => {
      for (const file of Array.from(files)) {
        await uploadFile(file);
      }
    })();
    if (inputRef.current) inputRef.current.value = "";
  }

  async function removeRemote(id: string) {
    const res = await fetch(`/api/attachments/${id}`, { method: "DELETE" });
    const json = (await res.json()) as { ok?: boolean; error?: string };
    if (!json.ok) {
      toast.error(json.error || "Не вдалося видалити");
      return;
    }
    setRemote((prev) => prev.filter((a) => a.id !== id));
  }

  function removePending(id: string) {
    const next = pending.filter((p) => p.id !== id);
    const removed = pending.find((p) => p.id === id);
    if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
    onPendingChange?.(next);
  }

  const total = pending.length + remote.length;

  return (
    <div className={cn("space-y-2", className)}>
      <button
        type="button"
        disabled={uploading || total >= 5}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
        }}
        onDrop={(e) => {
          e.preventDefault();
          onPick(e.dataTransfer.files);
        }}
        className={cn(
          "flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-zinc-300 bg-zinc-50/80 text-sm font-medium text-zinc-600 transition",
          "hover:border-zinc-400 hover:bg-zinc-100/80 hover:text-zinc-900",
          "disabled:opacity-50",
          compact ? "h-11 px-3" : "min-h-[4.5rem] flex-col px-4 py-4"
        )}
      >
        {uploading || loading ? (
          <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />
        ) : (
          <>
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-zinc-200/80">
              <Plus className="h-4 w-4 text-zinc-700" />
            </span>
            <span className={cn(compact && "text-xs")}>
              {compact ? "Накладна" : "Додати накладну"}
            </span>
            {!compact ? (
              <span className="text-[11px] font-normal text-zinc-400">
                PDF або фото · до 10 МБ · макс. 5
              </span>
            ) : null}
          </>
        )}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif"
        multiple
        className="hidden"
        onChange={(e) => onPick(e.target.files)}
      />

      {total > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {pending.map((p) => (
            <li
              key={p.id}
              className="group relative flex h-16 w-16 items-center justify-center overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm"
            >
              {p.previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={p.previewUrl}
                  alt=""
                  className="h-full w-full object-cover"
                />
              ) : (
                <FileText className="h-5 w-5 text-zinc-400" />
              )}
              <button
                type="button"
                onClick={() => removePending(p.id)}
                className="absolute top-1 right-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-zinc-900/80 text-white opacity-0 transition group-hover:opacity-100"
              >
                <X className="h-3 w-3" />
              </button>
            </li>
          ))}
          {remote.map((a) => (
            <li
              key={a.id}
              className="group relative flex h-16 w-16 items-center justify-center overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm"
              title={a.fileName}
            >
              {isImage(a.mimeType) && a.signedUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={a.signedUrl}
                  alt=""
                  className="h-full w-full object-cover"
                />
              ) : isImage(a.mimeType) ? (
                <ImageIcon className="h-5 w-5 text-zinc-400" />
              ) : (
                <FileText className="h-5 w-5 text-zinc-400" />
              )}
              <button
                type="button"
                onClick={() => void removeRemote(a.id)}
                className="absolute top-1 right-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-zinc-900/80 text-white opacity-0 transition group-hover:opacity-100"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {!compact && total === 0 ? (
        <p className="flex items-center gap-1.5 text-[11px] text-zinc-400">
          <Paperclip className="h-3 w-3" />
          Необовʼязково — можна додати пізніше з історії
        </p>
      ) : null}
    </div>
  );
}

/** Заливає pending-файли після створення entityId. */
export async function flushPendingAttachments(
  entityType: AttachmentEntityType,
  entityId: string,
  pending: PendingAttachment[]
): Promise<void> {
  for (const item of pending) {
    const form = new FormData();
    form.set("entityType", entityType);
    form.set("entityId", entityId);
    form.set("file", item.file);
    const res = await fetch("/api/attachments", { method: "POST", body: form });
    const json = (await res.json()) as { ok?: boolean; error?: string };
    if (!json.ok) {
      toast.error(json.error || `Не вдалося завантажити ${item.file.name}`);
    }
    if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
  }
}

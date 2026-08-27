"use client";

import { useEffect, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  Loader2,
  Paperclip,
  X,
} from "lucide-react";

import type { AttachmentEntityType } from "@/lib/operation-attachments";
import { cn } from "@/lib/utils";

type RemoteAttachment = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  signedUrl?: string | null;
};

/** Скріпка → одразу fullscreen lightbox (без проміжного sheet). */
export function AttachmentViewerButton({
  entityType,
  entityId,
  count = 0,
  className,
}: {
  entityType: AttachmentEntityType;
  entityId: string;
  count?: number;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  if (count <= 0) return null;

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        className={cn(
          "inline-flex h-8 items-center gap-1 rounded-full bg-zinc-100 px-2 text-[11px] font-semibold text-zinc-600 transition hover:bg-zinc-200 hover:text-zinc-900",
          className
        )}
        title="Накладні"
      >
        <Paperclip className="h-3.5 w-3.5" />
        {count}
      </button>
      <AttachmentLightbox
        open={open}
        onOpenChange={setOpen}
        entityType={entityType}
        entityId={entityId}
      />
    </>
  );
}

export function AttachmentLightbox({
  open,
  onOpenChange,
  entityType,
  entityId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entityType: AttachmentEntityType;
  entityId: string;
}) {
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<RemoteAttachment[]>([]);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setIndex(0);
    void fetch(
      `/api/attachments?entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(entityId)}`
    )
      .then((r) => r.json())
      .then((json: { ok?: boolean; attachments?: RemoteAttachment[] }) => {
        if (cancelled) return;
        setItems(
          json.ok && Array.isArray(json.attachments) ? json.attachments : []
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, entityType, entityId]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onOpenChange(false);
      if (e.key === "ArrowLeft") {
        setIndex((i) => Math.max(0, i - 1));
      }
      if (e.key === "ArrowRight") {
        setIndex((i) => Math.min(items.length - 1, i + 1));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange, items.length]);

  if (!open) return null;

  const active = items[index] ?? null;
  const hasMany = items.length > 1;

  return (
    <div
      className="fixed inset-0 z-[200] flex flex-col bg-zinc-950/95"
      role="dialog"
      aria-modal="true"
      aria-label="Накладна"
      onClick={() => onOpenChange(false)}
    >
      <div
        className="flex items-center justify-between gap-3 px-4 py-3 text-white sm:px-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold tracking-tight">
            {loading
              ? "Завантаження…"
              : active?.fileName ?? (items.length === 0 ? "Немає файлів" : "")}
          </p>
          {hasMany ? (
            <p className="mt-0.5 text-[11px] text-white/50 tabular-nums">
              {index + 1} / {items.length}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {active?.signedUrl ? (
            <a
              href={active.signedUrl}
              download={active.fileName}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-10 items-center gap-1.5 rounded-full bg-white/10 px-3.5 text-xs font-semibold backdrop-blur transition hover:bg-white/20"
            >
              <Download className="h-3.5 w-3.5" />
              Завантажити
            </a>
          ) : null}
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/10 transition hover:bg-white/20"
            aria-label="Закрити"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div
        className="relative flex min-h-0 flex-1 items-center justify-center px-4 pb-6 sm:px-10"
        onClick={(e) => e.stopPropagation()}
      >
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-white/60">
            <Loader2 className="h-5 w-5 animate-spin" />
            Завантаження…
          </div>
        ) : !active ? (
          <p className="text-sm text-white/50">Немає вкладених файлів</p>
        ) : active.mimeType.startsWith("image/") && active.signedUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={active.signedUrl}
            alt={active.fileName}
            className="max-h-full max-w-full object-contain shadow-2xl"
          />
        ) : active.mimeType === "application/pdf" && active.signedUrl ? (
          <iframe
            title={active.fileName}
            src={active.signedUrl}
            className="h-full w-full max-w-5xl rounded-lg bg-white shadow-2xl"
          />
        ) : (
          <div className="flex flex-col items-center gap-3 text-white/70">
            <FileText className="h-12 w-12 text-white/40" />
            <p className="text-sm">Немає попереднього перегляду</p>
            {active.signedUrl ? (
              <a
                href={active.signedUrl}
                download={active.fileName}
                target="_blank"
                rel="noreferrer"
                className="text-xs font-semibold text-white underline"
              >
                Відкрити файл
              </a>
            ) : null}
          </div>
        )}

        {hasMany ? (
          <>
            <button
              type="button"
              disabled={index <= 0}
              onClick={() => setIndex((i) => Math.max(0, i - 1))}
              className="absolute left-2 top-1/2 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur transition hover:bg-white/20 disabled:opacity-30 sm:left-4"
              aria-label="Попередній"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              type="button"
              disabled={index >= items.length - 1}
              onClick={() =>
                setIndex((i) => Math.min(items.length - 1, i + 1))
              }
              className="absolute right-2 top-1/2 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur transition hover:bg-white/20 disabled:opacity-30 sm:right-4"
              aria-label="Наступний"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}

/** @deprecated — використовуй AttachmentLightbox */
export function AttachmentViewerSheet(
  props: Parameters<typeof AttachmentLightbox>[0]
) {
  return <AttachmentLightbox {...props} />;
}

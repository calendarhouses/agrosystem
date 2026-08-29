"use client";

import type { ReactNode } from "react";
import { Loader2, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type ConfirmDeleteDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  pending?: boolean;
  onConfirm: () => void;
  className?: string;
};

/**
 * Компактне підтвердження видалення (картка по центру на мобілці, не шторка).
 * Кнопка «Видалити» — суцільна червона.
 */
export function ConfirmDeleteDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Видалити",
  cancelLabel = "Скасувати",
  pending = false,
  onConfirm,
  className,
}: ConfirmDeleteDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && pending) return;
        onOpenChange(next);
      }}
    >
      <DialogContent
        presentation="center"
        showCloseButton={false}
        className={cn(
          "gap-0 overflow-hidden rounded-[1.35rem] border border-red-100/90",
          "bg-[#FDFBF7] p-0 text-zinc-900",
          "shadow-[0_24px_60px_-18px_rgba(127,29,29,0.32)]",
          "ring-0 sm:max-w-[22rem]",
          className
        )}
      >
        <div className="px-5 pt-5">
          <DialogHeader className="gap-0 space-y-0 text-left">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-red-600/10 text-red-700 ring-1 ring-red-600/15">
                <Trash2 className="h-4 w-4" strokeWidth={2} />
              </div>
              <div className="min-w-0 pt-0.5">
                <DialogTitle className="text-[1.05rem] leading-snug font-bold tracking-tight text-zinc-900">
                  {title}
                </DialogTitle>
                <DialogDescription className="mt-1.5 text-[13px] leading-snug text-zinc-500">
                  {description}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
        </div>

        <div className="flex gap-2.5 px-5 pt-4 pb-5">
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => onOpenChange(false)}
            className="h-11 flex-1 rounded-xl border-[#E5DFD3] bg-white text-sm font-semibold text-zinc-700 hover:bg-zinc-50"
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            disabled={pending}
            onClick={onConfirm}
            className={cn(
              "h-11 flex-1 rounded-xl text-sm font-bold text-white",
              "bg-red-600 hover:bg-red-700",
              "shadow-[0_8px_18px_-8px_rgba(220,38,38,0.55)]",
              "disabled:bg-red-600/60"
            )}
          >
            {pending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              confirmLabel
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

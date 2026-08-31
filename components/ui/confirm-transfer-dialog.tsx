"use client";

import type { ReactNode } from "react";
import { CheckCircle2, Loader2, Package } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type ConfirmTransferDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  description: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  pending?: boolean;
  onConfirm: () => void;
  className?: string;
};

/** Підтвердження «Позначити як передані» — компактна картка по центру. */
export function ConfirmTransferDialog({
  open,
  onOpenChange,
  title = "Позначити як передані?",
  description,
  confirmLabel = "Так, позначити",
  cancelLabel = "Скасувати",
  pending = false,
  onConfirm,
  className,
}: ConfirmTransferDialogProps) {
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
          "gap-0 overflow-hidden rounded-[1.35rem] border border-[#E5DFD3]/90",
          "bg-[#FDFBF7] p-0 text-zinc-900",
          "shadow-[0_24px_60px_-18px_rgba(39,103,73,0.28)]",
          "ring-0 sm:max-w-[22rem]",
          className
        )}
      >
        <div className="px-5 pt-5">
          <DialogHeader className="gap-0 space-y-0 text-left">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[#276749]/10 text-[#276749] ring-1 ring-[#276749]/15">
                <Package className="h-4 w-4" strokeWidth={2} />
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
              "h-11 flex-1 gap-2 rounded-xl text-sm font-bold text-white",
              "bg-[#276749] hover:bg-[#1f5239]",
              "shadow-[0_8px_18px_-8px_rgba(39,103,73,0.55)]",
              "disabled:bg-[#276749]/60"
            )}
          >
            {pending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <CheckCircle2 className="h-4 w-4" />
                {confirmLabel}
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

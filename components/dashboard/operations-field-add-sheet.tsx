"use client";

import { PackageMinus, Plus, Tractor } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import type { FieldTimelineField } from "@/lib/field-timeline";

type OperationsFieldAddSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  field: FieldTimelineField | null;
  onAddOperation: () => void;
  onAddInventory: () => void;
};

export function OperationsFieldAddSheet({
  open,
  onOpenChange,
  field,
  onAddOperation,
  onAddInventory,
}: OperationsFieldAddSheetProps) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="border-white/10 bg-zinc-950 text-zinc-50">
        <DrawerHeader className="border-b border-white/5 text-left">
          <DrawerTitle className="flex items-center gap-2 text-zinc-50">
            <Plus className="size-5 text-emerald-400" />
            Додати позицію
          </DrawerTitle>
          <DrawerDescription className="text-zinc-400">
            {field?.name ?? "Поле"}
          </DrawerDescription>
        </DrawerHeader>

        <div className="grid gap-3 px-4 py-4">
          <Button
            type="button"
            className="h-12 justify-start bg-orange-500/15 text-orange-100 hover:bg-orange-500/25"
            onClick={() => {
              onOpenChange(false);
              onAddOperation();
            }}
          >
            <Tractor className="mr-3 size-5" />
            Наряд техніки
          </Button>
          <Button
            type="button"
            className="h-12 justify-start bg-emerald-500/15 text-emerald-100 hover:bg-emerald-500/25"
            onClick={() => {
              onOpenChange(false);
              onAddInventory();
            }}
          >
            <PackageMinus className="mr-3 size-5" />
            Списання ТМЦ
          </Button>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

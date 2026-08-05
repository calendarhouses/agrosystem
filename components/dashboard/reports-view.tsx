"use client";

import { useMemo, useState, type FormEvent } from "react";
import { format } from "date-fns";
import { uk } from "date-fns/locale";
import { FileText, Plus } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { GlassCard } from "@/components/ui/glass-card";
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
  FIELDS,
  OPERATION_RECORDS,
  OPERATION_STATUS_META,
  OPERATION_TYPES,
  type OperationKind,
  type OperationRecord,
  type OperationStatus,
} from "@/lib/dashboard-data";
import { cn } from "@/lib/utils";

type FilterTab = "all" | "income" | "expense";

const INCOME_TYPES = new Set<string>(["Продаж врожаю"]);

function formatUah(value: number) {
  return `₴ ${value.toLocaleString("uk-UA")}`;
}

/** Сторінка ручного введення операцій і звітів */
export function ReportsView() {
  const [filter, setFilter] = useState<FilterTab>("all");
  const [records, setRecords] = useState<OperationRecord[]>(OPERATION_RECORDS);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [opType, setOpType] = useState<string>(OPERATION_TYPES[0]);
  const [fieldId, setFieldId] = useState<string>("none");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState<Date | undefined>(new Date());
  const [savedFlash, setSavedFlash] = useState(false);

  const filtered = useMemo(() => {
    if (filter === "all") return records;
    return records.filter((row) => row.kind === filter);
  }, [filter, records]);

  function handleSave(event: FormEvent) {
    event.preventDefault();
    const parsed = Number(amount);
    if (!parsed || !date) return;

    const kind: OperationKind = INCOME_TYPES.has(opType) ? "income" : "expense";
    const selectedField = FIELDS.find((f) => f.id === fieldId);
    const field =
      fieldId === "none" || !selectedField
        ? null
        : `${selectedField.name}: ${selectedField.crop}`;

    const next: OperationRecord = {
      id: `op-${Date.now()}`,
      type: opType as OperationRecord["type"],
      kind,
      fieldLabel: field,
      amountUah: parsed,
      dateLabel: format(date, "dd.MM.yyyy", { locale: uk }),
      status: "pending" as OperationStatus,
    };

    setRecords((prev) => [next, ...prev]);
    setSavedFlash(true);
    window.setTimeout(() => {
      setDialogOpen(false);
      setSavedFlash(false);
      setAmount("");
      setFieldId("none");
    }, 700);
  }

  return (
    <main className="mx-auto flex h-full w-full max-w-7xl flex-col overflow-hidden px-4 pt-3 pb-4 sm:px-6 lg:px-8">
      <PageHeader
        icon={FileText}
        title="Управління операціями"
        description="Ручне внесення доходів і витрат"
        actions={
          <Button
            type="button"
            onClick={() => setDialogOpen(true)}
            className="h-11 gap-2 rounded-xl border-0 bg-[#276749] px-5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-[#276749]/90"
          >
            <Plus className="h-4 w-4" />
            Внести запис
          </Button>
        }
      />

      <div className="mb-4 flex shrink-0 flex-wrap gap-2">
        {(
          [
            { id: "all", label: "Всі" },
            { id: "income", label: "Доходи" },
            { id: "expense", label: "Витрати" },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setFilter(tab.id)}
            className={cn(
              "rounded-xl border px-5 py-2.5 text-sm font-semibold transition-all duration-200",
              filter === tab.id
                ? "border-[#276749]/30 bg-[#276749]/10 text-[#276749]"
                : "border-[#E5DFD3] bg-zinc-100 text-zinc-500 hover:border-[#E5DFD3] hover:text-zinc-900"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <GlassCard className="flex min-h-0 flex-1 flex-col overflow-hidden border-[#E5DFD3] p-0 hover:scale-100">
        <div className="flex shrink-0 items-end justify-between gap-3 border-b border-[#E5DFD3] px-6 py-5">
          <div>
            <p className="text-base font-bold tracking-tight text-zinc-900">
              Останні операції
            </p>
            <p className="mt-1 text-sm text-zinc-500">
              Показано {filtered.length} записів
            </p>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-none">
          <table className="w-full min-w-[720px] border-collapse text-left">
            <thead className="sticky top-0 z-10 bg-[#E5DFD3]/50 backdrop-blur-sm">
              <tr>
                <th className="px-6 py-4 text-xs font-semibold tracking-wider text-zinc-500 uppercase">
                  Дата
                </th>
                <th className="px-4 py-4 text-xs font-semibold tracking-wider text-zinc-500 uppercase">
                  Тип
                </th>
                <th className="px-4 py-4 text-xs font-semibold tracking-wider text-zinc-500 uppercase">
                  Поле
                </th>
                <th className="px-4 py-4 text-xs font-semibold tracking-wider text-zinc-500 uppercase">
                  Статус
                </th>
                <th className="px-6 py-4 text-right text-xs font-semibold tracking-wider text-zinc-500 uppercase">
                  Сума
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => {
                const status = OPERATION_STATUS_META[row.status];
                return (
                  <tr
                    key={row.id}
                    className="border-t border-[#E5DFD3] transition-colors hover:bg-[#E5DFD3]/35"
                  >
                    <td className="px-6 py-5">
                      <span className="inline-flex rounded-lg border border-[#E5DFD3] bg-zinc-100 px-2.5 py-1.5 text-sm font-medium tabular-nums text-zinc-700">
                        {row.dateLabel}
                      </span>
                    </td>
                    <td className="px-4 py-5 text-sm font-semibold text-zinc-900">
                      {row.type}
                    </td>
                    <td className="px-4 py-5 text-sm text-zinc-500">
                      {row.fieldLabel ?? "—"}
                    </td>
                    <td className="px-4 py-5">
                      <Badge
                        variant="outline"
                        className={cn(
                          "h-auto rounded-lg border px-3 py-1 text-xs font-semibold",
                          status.className
                        )}
                      >
                        {status.label}
                      </Badge>
                    </td>
                    <td
                      className={cn(
                        "px-6 py-5 text-right text-base font-extrabold tracking-tight tabular-nums",
                        row.kind === "income"
                          ? "text-[#276749]"
                          : "text-[#C05621]"
                      )}
                    >
                      {row.kind === "income" ? "+" : "−"}
                      {formatUah(row.amountUah)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </GlassCard>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent
          className={cn(
            "gap-0 overflow-hidden rounded-xl border border-[#E5DFD3] bg-[#F4F1EA] p-0 text-zinc-900 shadow-sm ring-0 sm:max-w-md",
            "[&_[data-slot=dialog-close]]:text-zinc-500 [&_[data-slot=dialog-close]]:hover:bg-[#E5DFD3]/40"
          )}
        >
          <DialogHeader className="border-b border-[#E5DFD3] px-6 py-5 pr-12">
            <DialogTitle className="text-lg font-extrabold text-zinc-900">
              Внести запис
            </DialogTitle>
            <DialogDescription className="text-zinc-500">
              Нова фінансова операція для обліку
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSave} className="flex flex-col gap-4 px-6 py-5">
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wider text-zinc-500">
                Тип
              </Label>
              <Select value={opType} onValueChange={(v) => v && setOpType(v)}>
                <SelectTrigger className="h-10 w-full rounded-xl border-[#E5DFD3] bg-zinc-100 text-zinc-900">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-[#E5DFD3] bg-[#F4F1EA] text-zinc-900">
                  {OPERATION_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wider text-zinc-500">
                Поле (опціонально)
              </Label>
              <Select value={fieldId} onValueChange={(v) => v && setFieldId(v)}>
                <SelectTrigger className="h-10 w-full rounded-xl border-[#E5DFD3] bg-zinc-100 text-zinc-900">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-[#E5DFD3] bg-[#F4F1EA] text-zinc-900">
                  <SelectItem value="none">Без привʼязки до поля</SelectItem>
                  {FIELDS.map((field) => (
                    <SelectItem key={field.id} value={field.id}>
                      {field.name}: {field.crop}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wider text-zinc-500">
                Сума
              </Label>
              <div className="relative">
                <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm font-semibold text-zinc-500">
                  ₴
                </span>
                <Input
                  type="number"
                  min={1}
                  required
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="45000"
                  className="h-10 rounded-xl border-[#E5DFD3] bg-zinc-100 pl-8 text-zinc-900"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wider text-zinc-500">
                Дата
              </Label>
              <DatePicker date={date} onChange={setDate} className="w-full" />
            </div>

            <DialogFooter className="mx-0 mb-0 rounded-none border-0 bg-transparent p-0 pt-2 sm:justify-stretch">
              <Button
                type="submit"
                disabled={savedFlash}
                className="h-11 w-full rounded-xl border-0 bg-[#276749] font-bold text-white shadow-sm hover:bg-[#276749]/90"
              >
                {savedFlash ? "Збережено ✓" : "Зберегти запис"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </main>
  );
}

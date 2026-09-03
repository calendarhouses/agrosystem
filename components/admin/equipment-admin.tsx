"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import {
  Check,
  Loader2,
  Power,
  PowerOff,
  RefreshCw,
  Ruler,
  Sparkles,
  Tractor,
  Wrench,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
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
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type {
  EquipmentRow,
  ImplementRow,
} from "@/app/admin/equipment/page";
import {
  syncEquipmentFromBas,
  autoMapWialon,
  toggleEquipmentActive,
  saveEquipmentWialon,
  saveEquipmentFuelTank,
  saveImplementWorkingWidth,
  type AutoMapResult,
  type SyncResult,
} from "@/app/admin/equipment/actions";
import { cn } from "@/lib/utils";

const TYPE_LABELS: Record<string, string> = {
  tractor: "Трактор",
  combine: "Комбайн",
  sprayer: "Оприскувач",
  loader: "Навантажувач",
  seeder: "Сівалка",
  plow: "Плуг",
  harrow: "Борона",
  header: "Жниварка",
  cultivator: "Культиватор",
  spreader: "Розкидач",
  compactor: "Компактор",
  other: "Інше",
};

const NONE = "__none__";

type WialonOption = { id: number; name: string };

type Props = {
  equipment: EquipmentRow[];
  implements_: ImplementRow[];
  wialonUnits: WialonOption[];
};

function formatWidth(m: number | null | undefined): string {
  const n = Number(m) || 0;
  return n.toLocaleString("uk-UA", {
    maximumFractionDigits: 2,
    minimumFractionDigits: Number.isInteger(n) ? 0 : 1,
  });
}

export function EquipmentAdmin({ equipment, implements_, wialonUnits }: Props) {
  const router = useRouter();
  const [syncing, startSync] = useTransition();
  const [mapping, startMap] = useTransition();
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [localWialon, setLocalWialon] = useState<Record<string, string>>({});
  const [localTank, setLocalTank] = useState<Record<string, string>>({});

  const [editImpl, setEditImpl] = useState<ImplementRow | null>(null);
  const [widthDraft, setWidthDraft] = useState("");
  const [savingWidth, startSaveWidth] = useTransition();

  const assignedWialonIds = useMemo(() => {
    const set = new Set<number>();
    for (const eq of equipment) {
      if (eq.wialon_id != null) set.add(eq.wialon_id);
    }
    for (const v of Object.values(localWialon)) {
      if (v !== NONE) set.add(Number(v));
    }
    return set;
  }, [equipment, localWialon]);

  function openImplementSheet(row: ImplementRow) {
    setEditImpl(row);
    setWidthDraft(String(Number(row.working_width_m) || 0));
  }

  function handleSaveWidth() {
    if (!editImpl) return;
    const width = Number(String(widthDraft).replace(",", "."));
    startSaveWidth(async () => {
      const res = await saveImplementWorkingWidth({
        implementId: editImpl.id,
        workingWidthM: width,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Ширину захвату збережено", {
        description: `${editImpl.name}: ${formatWidth(width)} м`,
      });
      setEditImpl(null);
      router.refresh();
    });
  }

  function handleSync() {
    startSync(async () => {
      setMessage(null);
      const res = await syncEquipmentFromBas();
      if (!res.ok) {
        setMessage(`Помилка: ${res.error}`);
        return;
      }
      const d = res.data as SyncResult;
      setMessage(
        `Синхронізовано: ${d.equipment.upserted} техніки, ${d.implements.upserted} обладнання. Запускаю авто-маппінг Wialon...`
      );
      const mapRes = await autoMapWialon();
      if (mapRes.ok) {
        const m = mapRes.data as AutoMapResult;
        setMessage(
          `Готово: ${d.equipment.upserted} техніки, ${d.implements.upserted} обладнання. Wialon: ${m.matched}/${m.total} зіставлено.`
        );
      } else {
        setMessage(
          `Синхронізовано, але авто-маппінг Wialon не вдався: ${mapRes.error}`
        );
      }
      router.refresh();
    });
  }

  function handleAutoMap() {
    startMap(async () => {
      setMessage(null);
      const res = await autoMapWialon();
      if (!res.ok) {
        setMessage(`Помилка: ${res.error}`);
        return;
      }
      const m = res.data as AutoMapResult;
      setMessage(`Авто-маппінг: ${m.matched}/${m.total} зіставлено.`);
      router.refresh();
    });
  }

  async function handleToggle(eq: EquipmentRow) {
    setTogglingId(eq.id);
    const res = await toggleEquipmentActive({
      equipmentId: eq.id,
      isActive: !eq.is_active,
    });
    setTogglingId(null);
    if (!res.ok) {
      setMessage(`Помилка: ${res.error}`);
      return;
    }
    router.refresh();
  }

  async function handleWialonChange(eqId: string, value: string) {
    setSavingId(eqId);
    setLocalWialon((prev) => ({ ...prev, [eqId]: value }));
    const wialonId = value === NONE ? null : Number(value);
    const wialonName =
      wialonId != null
        ? (wialonUnits.find((u) => u.id === wialonId)?.name ?? null)
        : null;
    const res = await saveEquipmentWialon({
      equipmentId: eqId,
      wialonId,
      wialonName,
    });
    setSavingId(null);
    if (!res.ok) {
      setMessage(`Помилка: ${res.error}`);
      return;
    }
    router.refresh();
  }

  async function handleTankBlur(eqId: string) {
    const raw = localTank[eqId];
    if (raw === undefined) return;
    const trimmed = raw.trim();
    const volume =
      trimmed === ""
        ? null
        : Number(String(trimmed).replace(",", "."));
    if (volume != null && (!Number.isFinite(volume) || volume <= 0)) {
      toast.error("Обʼєм бака має бути > 0 л");
      return;
    }
    setSavingId(eqId);
    const res = await saveEquipmentFuelTank({
      equipmentId: eqId,
      fuelTankVolume: volume,
    });
    setSavingId(null);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success(volume != null ? `Бак: ${volume} л` : "Обʼєм бака скинуто");
    router.refresh();
  }

  const isEmpty = equipment.length === 0 && implements_.length === 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={handleSync} disabled={syncing}>
          {syncing ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 h-4 w-4" />
          )}
          Синхронізувати з BAS
        </Button>
        <Button
          variant="outline"
          onClick={handleAutoMap}
          disabled={mapping || equipment.length === 0}
        >
          {mapping ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="mr-2 h-4 w-4" />
          )}
          Авто-маппінг Wialon
        </Button>
      </div>

      {message ? (
        <p className="rounded-lg border bg-muted/40 px-3 py-2 text-sm">
          {message}
        </p>
      ) : null}

      {isEmpty ? (
        <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          Натисніть «Синхронізувати з BAS», щоб завантажити техніку та
          обладнання з BAS AGRO.
        </div>
      ) : (
        <Tabs defaultValue="equipment">
          <TabsList>
            <TabsTrigger value="equipment" className="gap-1.5">
              <Tractor className="h-3.5 w-3.5" />
              Техніка ({equipment.length})
            </TabsTrigger>
            <TabsTrigger value="implements" className="gap-1.5">
              <Wrench className="h-3.5 w-3.5" />
              Обладнання ({implements_.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="equipment" className="mt-4">
            <div className="overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[260px]">Назва</TableHead>
                    <TableHead>Тип</TableHead>
                    <TableHead className="w-[90px]">Контур</TableHead>
                    <TableHead className="min-w-[200px]">Wialon</TableHead>
                    <TableHead className="w-[110px]">Бак, л</TableHead>
                    <TableHead className="w-[90px]">Статус</TableHead>
                    <TableHead className="w-[60px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {equipment.map((row) => {
                    const current =
                      localWialon[row.id] ??
                      (row.wialon_id != null ? String(row.wialon_id) : NONE);
                    const tankValue =
                      localTank[row.id] ??
                      (row.fuel_tank_volume != null
                        ? String(row.fuel_tank_volume)
                        : "");
                    return (
                      <TableRow
                        key={row.id}
                        className={cn(!row.is_active && "opacity-50")}
                      >
                        <TableCell className="font-medium">{row.name}</TableCell>
                        <TableCell>
                          <Badge variant="secondary">
                            {TYPE_LABELS[row.type] ?? row.type}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {row.work_scope === "field" ? (
                            <Badge variant="outline">Поля</Badge>
                          ) : row.work_scope === "base" ? (
                            <Badge variant="outline">База</Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Select
                            value={current}
                            onValueChange={(v) => {
                              if (typeof v === "string") {
                                void handleWialonChange(row.id, v);
                              }
                            }}
                            disabled={savingId === row.id}
                          >
                            <SelectTrigger className="h-8 w-full max-w-xs">
                              <SelectValue placeholder="—" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={NONE}>— без GPS —</SelectItem>
                              {wialonUnits.map((u) => {
                                const taken =
                                  assignedWialonIds.has(u.id) &&
                                  String(u.id) !== current;
                                return (
                                  <SelectItem
                                    key={u.id}
                                    value={String(u.id)}
                                    disabled={taken}
                                  >
                                    {u.name}
                                    {taken ? " (зайнято)" : ""}
                                  </SelectItem>
                                );
                              })}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Input
                            className="h-8 w-[96px] tabular-nums"
                            inputMode="decimal"
                            placeholder="—"
                            value={tankValue}
                            disabled={savingId === row.id}
                            onChange={(e) =>
                              setLocalTank((prev) => ({
                                ...prev,
                                [row.id]: e.target.value,
                              }))
                            }
                            onBlur={() => void handleTankBlur(row.id)}
                          />
                        </TableCell>
                        <TableCell>
                          {row.has_tracker ? (
                            <Badge className="gap-1 bg-emerald-600">
                              <Check className="h-3 w-3" />
                              GPS
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="gap-1">
                              <X className="h-3 w-3" />
                              —
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            disabled={togglingId === row.id}
                            onClick={() => void handleToggle(row)}
                            title={
                              row.is_active ? "Деактивувати" : "Активувати"
                            }
                          >
                            {row.is_active ? (
                              <PowerOff className="h-4 w-4" />
                            ) : (
                              <Power className="h-4 w-4" />
                            )}
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          <TabsContent value="implements" className="mt-4">
            <p className="mb-3 text-xs text-muted-foreground">
              Клік по рядку — редагувати ширину захвату (для розрахунку га з
              GPS).
            </p>
            <div className="overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[320px]">Назва</TableHead>
                    <TableHead>Тип</TableHead>
                    <TableHead>Код</TableHead>
                    <TableHead className="w-[160px] text-right">
                      Ширина захвату (м)
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {implements_.map((row) => {
                    const width = Number(row.working_width_m) || 0;
                    return (
                      <TableRow
                        key={row.id}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => openImplementSheet(row)}
                      >
                        <TableCell className="font-medium">{row.name}</TableCell>
                        <TableCell>
                          <Badge variant="secondary">
                            {TYPE_LABELS[row.type] ?? row.type}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {row.code ?? "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          {width > 0 ? (
                            <span className="inline-flex items-center gap-1.5 text-sm font-semibold tabular-nums text-zinc-900">
                              <Ruler className="h-3.5 w-3.5 text-zinc-400" />
                              {formatWidth(width)}
                            </span>
                          ) : (
                            <Badge
                              variant="outline"
                              className="border-zinc-300 bg-zinc-50 text-zinc-500"
                            >
                              0 м
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </TabsContent>
        </Tabs>
      )}

      <Sheet
        open={editImpl != null}
        onOpenChange={(open) => {
          if (!open) setEditImpl(null);
        }}
      >
        <SheetContent
          side="right"
          className="w-full max-w-md gap-0 sm:max-w-md"
        >
          <SheetHeader className="border-b border-border/60 p-4">
            <SheetTitle>Ширина захвату</SheetTitle>
            <SheetDescription>
              {editImpl?.name ?? "Знаряддя"}
              {editImpl?.type
                ? ` · ${TYPE_LABELS[editImpl.type] ?? editImpl.type}`
                : ""}
            </SheetDescription>
          </SheetHeader>
          <div className="flex flex-1 flex-col gap-4 p-4">
            <div className="space-y-2">
              <Label htmlFor="working-width">Робоча ширина, м</Label>
              <Input
                id="working-width"
                inputMode="decimal"
                value={widthDraft}
                onChange={(e) => setWidthDraft(e.target.value)}
                placeholder="0"
                className="tabular-nums text-base font-semibold"
              />
              <p className="text-xs text-muted-foreground">
                Формула: оброблена площа (га) = пробіг у полі (км) × ширина (м)
                / 10. Для візків, генераторів тощо залиште 0.
              </p>
            </div>
            {Number(String(widthDraft).replace(",", ".")) === 0 ? (
              <Badge
                variant="outline"
                className="w-fit border-zinc-300 bg-zinc-50 text-zinc-600"
              >
                0 м — не для польових робіт
              </Badge>
            ) : null}
          </div>
          <SheetFooter className="border-t border-border/60">
            <Button
              type="button"
              variant="outline"
              onClick={() => setEditImpl(null)}
              disabled={savingWidth}
            >
              Скасувати
            </Button>
            <Button
              type="button"
              onClick={handleSaveWidth}
              disabled={savingWidth}
            >
              {savingWidth ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Зберегти
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}

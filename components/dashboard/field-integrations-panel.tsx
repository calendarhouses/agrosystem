"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Feature, FeatureCollection, Polygon } from "geojson";
import {
  CheckCircle2,
  Database,
  Link2,
  Loader2,
  RefreshCw,
  Satellite,
  Unlink,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  type FarmField,
  isPolygonGeometry,
  updateFarmField,
} from "@/lib/farm-fields";
import { hectaresFromFeature } from "@/lib/geo-area";
import type { WialonGeofenceProperties } from "@/lib/wialon";
import { cn } from "@/lib/utils";

type GeofenceCollection = FeatureCollection<Polygon, WialonGeofenceProperties>;

function formatCacheSyncDate(iso: string | null): string {
  if (!iso) return "ще не синхронізовано";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("uk-UA", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function geofenceLabel(
  feature: Feature<Polygon, WialonGeofenceProperties>
): string {
  return (
    feature.properties?.name?.trim() ||
    String(feature.properties?.id ?? feature.id ?? "Геозона")
  );
}

function geofenceZoneId(
  feature: Feature<Polygon, WialonGeofenceProperties>
): string {
  return String(feature.properties?.id ?? feature.id ?? "");
}

type FieldIntegrationsPanelProps = {
  farmFieldId: string | null;
  wialonZoneId: string | null;
  wialonGeofences: GeofenceCollection;
  wialonLoading?: boolean;
  /** zoneId → назва поля, якщо геозона вже зайнята іншим паспортом */
  occupiedWialonZones?: Record<string, string>;
  onFieldUpdated?: (field: FarmField) => void;
  onPassportAreaChange?: (areaHa: number) => void;
  className?: string;
};

export function FieldIntegrationsPanel({
  farmFieldId,
  wialonZoneId,
  wialonGeofences,
  wialonLoading = false,
  occupiedWialonZones = {},
  onFieldUpdated,
  onPassportAreaChange,
  className,
}: FieldIntegrationsPanelProps) {
  const [syncingContour, setSyncingContour] = useState(false);
  const [linking, setLinking] = useState(false);
  const [wialonError, setWialonError] = useState<string | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [geofenceQuery, setGeofenceQuery] = useState("");
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);

  const [cacheLastUpdated, setCacheLastUpdated] = useState<string | null>(null);
  const [cacheItemCount, setCacheItemCount] = useState<number | null>(null);
  const [cacheLoading, setCacheLoading] = useState(true);
  const [cacheError, setCacheError] = useState<string | null>(null);

  const linkedZone = wialonZoneId?.trim() || null;
  const hasPassport = Boolean(farmFieldId);

  const loadCacheMeta = useCallback(() => {
    setCacheLoading(true);
    setCacheError(null);
    fetch("/api/inventory/cache-sync", { cache: "no-store" })
      .then(async (res) => {
        const body = (await res.json()) as {
          ok?: boolean;
          lastUpdatedAt?: string | null;
          itemCount?: number;
          error?: string;
        };
        if (!res.ok || !body.ok) {
          throw new Error(body.error ?? "Не вдалося завантажити кеш ТМЦ");
        }
        setCacheLastUpdated(body.lastUpdatedAt ?? null);
        setCacheItemCount(body.itemCount ?? 0);
        setCacheLoading(false);
      })
      .catch((err: unknown) => {
        setCacheLoading(false);
        setCacheError(
          err instanceof Error ? err.message : "Помилка завантаження кешу"
        );
      });
  }, []);

  useEffect(() => {
    loadCacheMeta();
  }, [loadCacheMeta]);

  const filteredGeofences = useMemo(() => {
    const q = geofenceQuery.trim().toLowerCase();
    return wialonGeofences.features.filter((feature) => {
      const zoneId = geofenceZoneId(feature);
      if (!zoneId) return false;
      if (linkedZone && zoneId === linkedZone) return false;
      if (!q) return true;
      return geofenceLabel(feature).toLowerCase().includes(q);
    });
  }, [wialonGeofences.features, geofenceQuery, linkedZone]);

  async function fetchWialonGeofence(
    zoneId: string
  ): Promise<Feature<Polygon, WialonGeofenceProperties>> {
    const res = await fetch("/api/wialon", { cache: "no-store" });
    const body = (await res.json()) as {
      ok?: boolean;
      error?: string;
      geofences?: GeofenceCollection;
    };
    if (!res.ok || !body.ok) {
      throw new Error(body.error ?? "Помилка зв'язку з Wialon");
    }
    const feature = body.geofences?.features.find(
      (item) => geofenceZoneId(item) === zoneId
    );
    if (!feature || !isPolygonGeometry(feature.geometry)) {
      throw new Error("Геозону не знайдено в Wialon");
    }
    return feature;
  }

  async function handleSyncContour() {
    if (!farmFieldId || !linkedZone || syncingContour) return;

    setSyncingContour(true);
    setWialonError(null);
    try {
      const feature = await fetchWialonGeofence(linkedZone);
      const areaHa = hectaresFromFeature(feature);

      const updated = await updateFarmField(farmFieldId, {
        wialonZoneId: linkedZone,
        geometry: feature.geometry,
        areaHa,
      });

      onFieldUpdated?.(updated);
      onPassportAreaChange?.(areaHa);
      toast.success(`Контур оновлено з Wialon · ${areaHa} га`);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Не вдалося синхронізувати контур";
      setWialonError(msg);
      toast.error(msg);
    } finally {
      setSyncingContour(false);
    }
  }

  async function handleLinkGeofence() {
    if (!farmFieldId || !selectedZoneId || linking) return;

    const occupiedBy = occupiedWialonZones[selectedZoneId];
    if (occupiedBy) {
      setWialonError(`Геозона вже привʼязана до «${occupiedBy}»`);
      return;
    }

    setLinking(true);
    setWialonError(null);
    try {
      const feature = await fetchWialonGeofence(selectedZoneId);
      const areaHa = hectaresFromFeature(feature);

      const updated = await updateFarmField(farmFieldId, {
        wialonZoneId: selectedZoneId,
        geometry: feature.geometry,
        areaHa,
      });

      onFieldUpdated?.(updated);
      onPassportAreaChange?.(areaHa);
      setLinkOpen(false);
      setSelectedZoneId(null);
      setGeofenceQuery("");
      toast.success(`Привʼязано до «${geofenceLabel(feature)}»`);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Не вдалося привʼязати геозону";
      setWialonError(msg);
      toast.error(msg);
    } finally {
      setLinking(false);
    }
  }

  async function handleUnlink() {
    if (!farmFieldId || !linkedZone) return;
    setWialonError(null);
    try {
      const updated = await updateFarmField(farmFieldId, {
        wialonZoneId: null,
      });
      onFieldUpdated?.(updated);
      toast.message("Привʼязку до Wialon знято");
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Не вдалося зняти привʼязку";
      setWialonError(msg);
      toast.error(msg);
    }
  }

  return (
    <section
      data-vaul-no-drag=""
      className={cn(
        "rounded-2xl border border-[#E5DFD3] bg-white/80 p-4 shadow-sm",
        className
      )}
    >
      <div className="mb-4 flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-sky-700">
          <Satellite className="h-5 w-5" strokeWidth={1.8} />
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-bold tracking-tight text-zinc-900">
            Інтеграції (Джерела даних)
          </h3>
          <p className="mt-0.5 text-xs text-zinc-500">
            Звʼязок з трекером і номенклатурою BAS AGRO.
          </p>
        </div>
      </div>

      <div className="space-y-4">
        <div className="rounded-xl border border-[#E5DFD3] bg-[#FAFAF8] p-3.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-semibold tracking-[0.12em] text-zinc-500 uppercase">
              Wialon
            </p>
            {linkedZone ? (
              <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Привʼязано
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-lg bg-zinc-100 px-2 py-0.5 text-[11px] font-semibold text-zinc-600">
                <Unlink className="h-3.5 w-3.5" />
                Без геозони
              </span>
            )}
          </div>

          {linkedZone ? (
            <div className="mt-3 space-y-3">
              <p className="text-xs text-zinc-600">
                ID геозони:{" "}
                <span className="font-mono text-[11px] text-zinc-800">
                  {linkedZone}
                </span>
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!hasPassport || syncingContour || wialonLoading}
                  onClick={() => void handleSyncContour()}
                  className="h-11 rounded-lg border-sky-200 bg-sky-50 text-sky-900 hover:bg-sky-100"
                >
                  {syncingContour ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                  Синхронізувати контур з Wialon
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={!hasPassport}
                  onClick={() => void handleUnlink()}
                  className="h-11 rounded-lg text-zinc-600"
                >
                  Зняти привʼязку
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-3 space-y-2">
              <p className="text-xs text-zinc-600">
                Поле не повʼязане з геозоною Wialon — GPS-розрахунки площі та
                автостатус техніки недоступні.
              </p>
              <Button
                type="button"
                size="sm"
                disabled={!hasPassport || wialonLoading}
                onClick={() => {
                  setWialonError(null);
                  setLinkOpen(true);
                }}
                className="h-11 rounded-lg bg-[#276749] text-white hover:bg-[#22543d]"
              >
                <Link2 className="h-4 w-4" />
                Привʼязати до геозони
              </Button>
            </div>
          )}

          {!hasPassport ? (
            <p className="mt-2 text-[11px] text-amber-700">
              Спочатку збережіть паспорт поля — тоді можна привʼязати геозону.
            </p>
          ) : null}

          {wialonLoading ? (
            <p className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-zinc-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Завантаження геозон Wialon…
            </p>
          ) : null}

          {wialonError ? (
            <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-900">
              {wialonError}
            </p>
          ) : null}
        </div>

        <div className="rounded-xl border border-[#E5DFD3] bg-[#FAFAF8] p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Database className="h-4 w-4 text-violet-700" />
              <p className="text-[11px] font-semibold tracking-[0.12em] text-zinc-500 uppercase">
                BAS AGRO / База номенклатури
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={cacheLoading}
              onClick={loadCacheMeta}
              className="h-11 rounded-lg"
            >
              {cacheLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Оновити статус
            </Button>
          </div>
          <p className="mt-2 text-xs text-zinc-700">
            Синхронізація ТМЦ:{" "}
            {cacheLoading ? (
              <span className="inline-flex items-center gap-1 text-zinc-500">
                <Loader2 className="h-3 w-3 animate-spin" />
                завантаження…
              </span>
            ) : cacheError ? (
              <span className="text-amber-800">{cacheError}</span>
            ) : (
              <span className="font-medium text-zinc-900">
                {formatCacheSyncDate(cacheLastUpdated)}
                {cacheItemCount != null && cacheItemCount > 0
                  ? ` · ${cacheItemCount} поз.`
                  : ""}
              </span>
            )}
          </p>
        </div>
      </div>

      <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
        <DialogContent className="max-h-[85vh] overflow-hidden border-[#E5DFD3] bg-[#F4F1EA] sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-zinc-900">
              Привʼязати до геозони Wialon
            </DialogTitle>
          </DialogHeader>

          <Input
            value={geofenceQuery}
            onChange={(event) => setGeofenceQuery(event.target.value)}
            placeholder="Пошук за назвою…"
            className="h-11 rounded-xl border-[#E5DFD3] bg-white text-base md:text-sm"
          />

          <ul className="desktop-scrollbar max-h-64 space-y-1 overflow-y-auto pr-1" data-desktop-scroll="true">
            {filteredGeofences.length === 0 ? (
              <li className="rounded-xl border border-dashed border-zinc-200 px-3 py-4 text-center text-xs text-zinc-500">
                {wialonGeofences.features.length === 0
                  ? "Геозони Wialon ще не завантажені"
                  : "Нічого не знайдено"}
              </li>
            ) : (
              filteredGeofences.map((feature) => {
                const zoneId = geofenceZoneId(feature);
                const occupiedBy = occupiedWialonZones[zoneId];
                const selected = selectedZoneId === zoneId;
                return (
                  <li key={zoneId}>
                    <button
                      type="button"
                      disabled={Boolean(occupiedBy)}
                      onClick={() => setSelectedZoneId(zoneId)}
                      className={cn(
                        "flex min-h-11 w-full items-start justify-between gap-2 rounded-xl border px-3 py-2.5 text-left transition-colors",
                        selected
                          ? "border-[#276749] bg-emerald-50/80"
                          : "border-[#E5DFD3] bg-white hover:bg-zinc-50",
                        occupiedBy && "cursor-not-allowed opacity-50"
                      )}
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-zinc-900">
                          {geofenceLabel(feature)}
                        </p>
                        <p className="mt-0.5 font-mono text-[10px] text-zinc-500">
                          {zoneId}
                        </p>
                        {occupiedBy ? (
                          <p className="mt-1 text-[10px] text-amber-700">
                            Зайнято: {occupiedBy}
                          </p>
                        ) : null}
                      </div>
                      {selected ? (
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#276749]" />
                      ) : occupiedBy ? (
                        <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400" />
                      ) : null}
                    </button>
                  </li>
                );
              })
            )}
          </ul>

          <div className="flex gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              className="h-11 flex-1 rounded-xl"
              onClick={() => setLinkOpen(false)}
            >
              Скасувати
            </Button>
            <Button
              type="button"
              disabled={!selectedZoneId || linking}
              className="h-11 flex-1 rounded-xl bg-[#276749] text-white hover:bg-[#22543d]"
              onClick={() => void handleLinkGeofence()}
            >
              {linking ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Привʼязати"
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}

const STORAGE_KEY = "agroplan.placements.v1";
const HIDDEN_KEY = "agroplan.hidden.v1";

export type PlacementRecord = {
  startMs: number;
  durationHours?: number;
  updatedAt: string;
};

export type PlacementsStore = Record<string, PlacementRecord>;

export type PlacementPatch = {
  startMs: number;
  durationHours?: number;
  hidden?: boolean;
};

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota */
  }
}

export function loadPlacements(): PlacementsStore {
  return readJson<PlacementsStore>(STORAGE_KEY, {});
}

export function savePlacementPatch(
  blockId: string,
  patch: PlacementPatch
): PlacementsStore {
  const store = loadPlacements();
  const prev = store[blockId];
  store[blockId] = {
    startMs: patch.startMs,
    durationHours: patch.durationHours ?? prev?.durationHours,
    updatedAt: new Date().toISOString(),
  };
  writeJson(STORAGE_KEY, store);
  return store;
}

export function loadHiddenBlockIds(): Set<string> {
  const ids = readJson<string[]>(HIDDEN_KEY, []);
  return new Set(ids);
}

export function hideBlock(blockId: string): Set<string> {
  const set = loadHiddenBlockIds();
  set.add(blockId);
  writeJson(HIDDEN_KEY, Array.from(set));
  return set;
}

export function placementsToOverrides(store: PlacementsStore): {
  startMs: Record<string, number>;
  durationHours: Record<string, number>;
} {
  const startMs: Record<string, number> = {};
  const durationHours: Record<string, number> = {};
  for (const [id, rec] of Object.entries(store)) {
    if (Number.isFinite(rec.startMs)) startMs[id] = rec.startMs;
    if (rec.durationHours != null && Number.isFinite(rec.durationHours)) {
      durationHours[id] = rec.durationHours;
    }
  }
  return { startMs, durationHours };
}

/** Злиття локального сховища з сервером (новіше updatedAt перемагає) */
export function mergePlacementStores(
  local: PlacementsStore,
  remote: Record<
    string,
    { startMs: number; durationHours?: number; hidden?: boolean; updatedAt: string }
  >
): PlacementsStore {
  const out: PlacementsStore = { ...local };
  for (const [blockId, remoteRec] of Object.entries(remote)) {
    const localRec = local[blockId];
    if (
      !localRec ||
      new Date(remoteRec.updatedAt).getTime() >
        new Date(localRec.updatedAt).getTime()
    ) {
      out[blockId] = {
        startMs: remoteRec.startMs,
        durationHours: remoteRec.durationHours,
        updatedAt: remoteRec.updatedAt,
      };
    }
  }
  writeJson(STORAGE_KEY, out);
  return out;
}

export function hiddenFromRemote(
  remote: Record<string, { hidden?: boolean }>
): Set<string> {
  const set = loadHiddenBlockIds();
  for (const [blockId, rec] of Object.entries(remote)) {
    if (rec.hidden) set.add(blockId);
  }
  writeJson(HIDDEN_KEY, Array.from(set));
  return set;
}

let syncTimer: ReturnType<typeof setTimeout> | null = null;
const pendingSync = new Map<string, PlacementPatch & { hidden?: boolean }>();

export function queuePlacementSync(
  season: string,
  blockId: string,
  patch: PlacementPatch & { hidden?: boolean }
): void {
  pendingSync.set(blockId, patch);
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    void flushPlacementSync(season);
  }, 450);
}

export async function flushPlacementSync(season: string): Promise<void> {
  if (pendingSync.size === 0) return;
  const batch = Array.from(pendingSync.entries()).map(([blockId, patch]) => ({
    blockId,
    season,
    startMs: patch.startMs,
    durationHours: patch.durationHours,
    hidden: patch.hidden,
  }));
  pendingSync.clear();
  try {
    await fetch("/api/agroplan/placements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ season, placements: batch }),
    });
  } catch {
    for (const row of batch) {
      pendingSync.set(row.blockId, {
        startMs: row.startMs,
        durationHours: row.durationHours ?? undefined,
        hidden: row.hidden,
      });
    }
  }
}

/** @deprecated */
export function savePlacement(blockId: string, startMs: number): PlacementsStore {
  return savePlacementPatch(blockId, { startMs });
}

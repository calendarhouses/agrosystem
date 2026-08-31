import type { AgroplanBlock } from "@/lib/agroplan/blocks";

export type BlockOverrideState = {
  startMs: Record<string, number>;
  durationHours: Record<string, number>;
};

export function applyBlockOverrides(
  blocks: readonly AgroplanBlock[],
  overrides: BlockOverrideState
): AgroplanBlock[] {
  return blocks.map((block) => {
    const startMs = overrides.startMs[block.id];
    const durationHours = overrides.durationHours[block.id];
    if (startMs == null && durationHours == null) return block;
    return {
      ...block,
      ...(startMs != null ? { startMs } : {}),
      ...(durationHours != null ? { durationHours } : {}),
    };
  });
}

export function shiftBlocksMs(
  blocks: readonly AgroplanBlock[],
  blockIds: ReadonlySet<string>,
  deltaMs: number,
  clamp: (ms: number) => number
): BlockOverrideState["startMs"] {
  const out: Record<string, number> = {};
  for (const block of blocks) {
    if (!blockIds.has(block.id)) continue;
    out[block.id] = clamp(block.startMs + deltaMs);
  }
  return out;
}

export function blocksOnFields(
  blocks: readonly AgroplanBlock[],
  fieldIds: ReadonlySet<string>
): Set<string> {
  const ids = new Set<string>();
  for (const block of blocks) {
    if (fieldIds.has(block.fieldId)) ids.add(block.id);
  }
  return ids;
}

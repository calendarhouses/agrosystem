import type { AgroplanBlock } from "@/lib/agroplan/blocks";

export const AGROPLAN_LANE_HEIGHT = 50;
export const AGROPLAN_MIN_ROW_HEIGHT = 72;
export const AGROPLAN_ROW_PAD = 10;

/** Розкладка перекривних блоків по «смугах» в межах доріжки поля */
export function assignBlockLanes(
  blocks: readonly AgroplanBlock[]
): Map<string, number> {
  const sorted = [...blocks].sort((a, b) => a.startMs - b.startMs);
  const lanes = new Map<string, number>();
  const laneEnds: number[] = [];

  for (const block of sorted) {
    const endMs = block.startMs + block.durationHours * 3_600_000;
    let lane = 0;
    for (; lane < laneEnds.length; lane++) {
      if (laneEnds[lane]! <= block.startMs) break;
    }
    if (lane === laneEnds.length) laneEnds.push(endMs);
    else laneEnds[lane] = endMs;
    lanes.set(block.id, lane);
  }

  return lanes;
}

export function maxLaneIndex(lanes: Map<string, number>): number {
  let max = 0;
  for (const lane of lanes.values()) max = Math.max(max, lane);
  return max;
}

export function rowHeightForLaneCount(laneCount: number): number {
  const lanes = Math.max(1, laneCount + 1);
  return Math.max(
    AGROPLAN_MIN_ROW_HEIGHT,
    AGROPLAN_ROW_PAD * 2 + lanes * AGROPLAN_LANE_HEIGHT
  );
}

export function blockLaneTop(lane: number): number {
  return AGROPLAN_ROW_PAD + lane * AGROPLAN_LANE_HEIGHT;
}

export function blockLaneHeight(): number {
  return AGROPLAN_LANE_HEIGHT - 6;
}

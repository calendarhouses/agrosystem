export type PlacementPatch = {
  blockId: string;
  startMs: number;
  durationHours: number;
  operationClientKey?: string;
};

export type PlacementHistoryEntry = {
  label: string;
  before: PlacementPatch[];
  after: PlacementPatch[];
};

const MAX_HISTORY = 24;

export function createPlacementHistory() {
  const stack: PlacementHistoryEntry[] = [];

  return {
    push(entry: PlacementHistoryEntry) {
      stack.push(entry);
      if (stack.length > MAX_HISTORY) stack.shift();
    },
    pop(): PlacementHistoryEntry | undefined {
      return stack.pop();
    },
    peek(): PlacementHistoryEntry | undefined {
      return stack.at(-1);
    },
    canUndo(): boolean {
      return stack.length > 0;
    },
    clear() {
      stack.length = 0;
    },
  };
}

export type PlacementHistory = ReturnType<typeof createPlacementHistory>;

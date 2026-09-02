import type { WialonRefuelingEvent } from "@/lib/wialon-api";

/** За замовчуванням дивимось 7 днів (168 год) */
export const UNRECORDED_LOOKBACK_HOURS = 168;

export type UnrecordedRefueling = WialonRefuelingEvent & {
  timeIso: string;
};

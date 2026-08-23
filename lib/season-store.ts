"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

import {
  AVAILABLE_SEASONS,
  DEFAULT_SEASON,
  normalizeSeason,
  type SeasonId,
} from "@/lib/season";

type SeasonState = {
  activeSeason: SeasonId;
  availableSeasons: readonly string[];
  setActiveSeason: (season: string) => void;
};

export const useSeasonStore = create<SeasonState>()(
  persist(
    (set) => ({
      activeSeason: DEFAULT_SEASON,
      availableSeasons: AVAILABLE_SEASONS,
      setActiveSeason: (season) =>
        set({ activeSeason: normalizeSeason(season) }),
    }),
    {
      name: "agrosystem-active-season",
      partialize: (state) => ({ activeSeason: state.activeSeason }),
    }
  )
);

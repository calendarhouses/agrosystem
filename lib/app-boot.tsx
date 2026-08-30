"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { Preloader } from "@/components/layout/preloader";

/** Час показу прелоадера — мапа встигає підтягнути тайли */
const APP_BOOT_MS = 2300;

type AppBootValue = {
  /** Прелоадер ще на екрані (до старту exit) */
  isAppLoading: boolean;
  /** Chrome (nav / панелі) може з’являтися — з моменту старту dissolve */
  revealChrome: boolean;
};

const AppBootContext = createContext<AppBootValue>({
  isAppLoading: true,
  revealChrome: false,
});

export function useAppBoot(): AppBootValue {
  return useContext(AppBootContext);
}

/**
 * Холодний старт PWA: прелоадер + сигнал для появи нижнього меню / віджетів.
 * Soft-navigation всередині SPA не показує знову (AppShell не ремаунтиться).
 */
export function AppBootProvider({ children }: { children: ReactNode }) {
  const [isAppLoading, setIsAppLoading] = useState(true);
  const [revealChrome, setRevealChrome] = useState(false);

  useEffect(() => {
    const id = window.setTimeout(() => {
      setIsAppLoading(false);
      setRevealChrome(true);
    }, APP_BOOT_MS);
    return () => window.clearTimeout(id);
  }, []);

  const value = useMemo(
    () => ({ isAppLoading, revealChrome }),
    [isAppLoading, revealChrome]
  );

  return (
    <AppBootContext.Provider value={value}>
      {children}
      <Preloader isLoading={isAppLoading} />
    </AppBootContext.Provider>
  );
}

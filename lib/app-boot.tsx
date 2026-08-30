"use client";

import { usePathname } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { Preloader } from "@/components/layout/preloader";

/** Мін. кінематограф LEVADA */
const MIN_BOOT_MS = 2000;
/** Захист: не тримати вічно, якщо мапа зависла */
const MAX_BOOT_MS = 14_000;

type AppBootValue = {
  /** Прелоадер ще на екрані (до старту exit) */
  isAppLoading: boolean;
  /** Chrome (nav / панелі) може з’являтися — з моменту старту dissolve */
  revealChrome: boolean;
  /** Мапа полів готова (idle + камера + wialon boot) — або не потрібна на цьому маршруті */
  fieldsMapReady: boolean;
  /** Викликає FieldsMap, коли внутрішній boot-overlay можна гасити */
  reportFieldsMapReady: () => void;
};

const noop = () => {};

const AppBootContext = createContext<AppBootValue>({
  isAppLoading: true,
  revealChrome: false,
  fieldsMapReady: false,
  reportFieldsMapReady: noop,
});

export function useAppBoot(): AppBootValue {
  return useContext(AppBootContext);
}

function routeNeedsFieldsMap(pathname: string | null): boolean {
  return pathname === "/" || pathname === "/fields";
}

/**
 * Холодний старт PWA: LEVADA тримається мінімум ~2с і до готовності мапи полів.
 * Фоновий warmer стартує одразу (див. AppDataWarmer).
 */
export function AppBootProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const needsMap = routeNeedsFieldsMap(pathname);

  const [minElapsed, setMinElapsed] = useState(false);
  const [fieldsMapReady, setFieldsMapReady] = useState(!needsMap);
  const [revealChrome, setRevealChrome] = useState(false);
  const reportedRef = useRef(false);

  useEffect(() => {
    // Зміна маршруту після boot: мапа більше не блокує
    if (!needsMap) {
      setFieldsMapReady(true);
    }
  }, [needsMap]);

  useEffect(() => {
    const minTimer = window.setTimeout(() => setMinElapsed(true), MIN_BOOT_MS);
    const maxTimer = window.setTimeout(() => {
      setMinElapsed(true);
      setFieldsMapReady(true);
    }, MAX_BOOT_MS);
    return () => {
      window.clearTimeout(minTimer);
      window.clearTimeout(maxTimer);
    };
  }, []);

  const reportFieldsMapReady = useCallback(() => {
    if (reportedRef.current) return;
    reportedRef.current = true;
    setFieldsMapReady(true);
  }, []);

  const isAppLoading = !(minElapsed && fieldsMapReady);

  useEffect(() => {
    if (!isAppLoading) {
      setRevealChrome(true);
    }
  }, [isAppLoading]);

  const value = useMemo(
    () => ({
      isAppLoading,
      revealChrome,
      fieldsMapReady,
      reportFieldsMapReady,
    }),
    [isAppLoading, revealChrome, fieldsMapReady, reportFieldsMapReady]
  );

  return (
    <AppBootContext.Provider value={value}>
      {children}
      <Preloader isLoading={isAppLoading} />
    </AppBootContext.Provider>
  );
}

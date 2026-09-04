"use client";

import { usePathname } from "next/navigation";
import {
  useCallback,
  useLayoutEffect,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import { LevadaCopilotHost } from "@/components/ai/LevadaCopilotDrawer";
import { BottomNav } from "@/components/layout/bottom-nav";
import { AppDataWarmer } from "@/components/layout/app-data-warmer";
import { PreventEdgeSwipeBack } from "@/components/layout/prevent-edge-swipe-back";
import { RouteReveal } from "@/components/layout/route-reveal";
import { Sidebar } from "@/components/layout/sidebar";
import { TopBar } from "@/components/layout/top-bar";
import { AppBootProvider, useAppBoot } from "@/lib/app-boot";
import { isCommandCenterPath } from "@/lib/equipment-command-center-layout";
import { cn } from "@/lib/utils";

const SIDEBAR_COLLAPSED_KEY = "agrosystem-sidebar-collapsed";

function AppShellChrome({
  children,
  collapsed,
  onToggleCollapsed,
  isCommandCenter,
}: {
  children: ReactNode;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  isCommandCenter: boolean;
}) {
  const { isAppLoading } = useAppBoot();

  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col overflow-hidden overscroll-none text-zinc-900",
        // Під час LEVADA — zinc-950 (без сірого спалаху); далі — як було
        isAppLoading
          ? "bg-zinc-950"
          : isCommandCenter
            ? "bg-transparent md:bg-zinc-100"
            : "bg-[#F4F1EA] md:bg-zinc-100",
        // Не клікати меню під час boot — інакше soft-nav рве RSC-потік
        isAppLoading && "pointer-events-none"
      )}
    >
      <Sidebar collapsed={collapsed} onToggleCollapsed={onToggleCollapsed} />

      <div
        className={cn(
          "relative flex min-h-0 flex-1 flex-col overflow-hidden overscroll-none transition-[padding] duration-200 ease-out",
          collapsed ? "md:pl-16" : "md:pl-[250px]"
        )}
      >
        <TopBar />
        <div
          className={cn(
            "relative min-h-0 flex-1 overflow-hidden overscroll-none",
            isCommandCenter && "min-h-0 bg-zinc-950"
          )}
        >
          <RouteReveal>{children}</RouteReveal>
        </div>
      </div>

      <BottomNav />
      <LevadaCopilotHost />
      <AppDataWarmer />
      <PreventEdgeSwipeBack />
    </div>
  );
}

/** App Shell: фіксований viewport + згортання сайдбару */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isAuthScreen =
    pathname === "/login" ||
    pathname === "/install" ||
    pathname === "/copilot" ||
    pathname.startsWith("/copilot/");
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1") {
        setCollapsed(true);
      }
    } catch {
      /* ignore */
    }
  }, []);

  /** PWA: target=_blank на mapbox.com часто замінює весь застосунок сайтом Mapbox */
  useEffect(() => {
    function blockMapboxNavigation(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      const href = anchor.href;
      if (!href) return;
      try {
        const host = new URL(href).hostname;
        if (host === "mapbox.com" || host.endsWith(".mapbox.com")) {
          event.preventDefault();
          event.stopPropagation();
        }
      } catch {
        /* ignore invalid href */
      }
    }
    document.addEventListener("click", blockMapboxNavigation, true);
    return () =>
      document.removeEventListener("click", blockMapboxNavigation, true);
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      window.setTimeout(() => {
        window.dispatchEvent(new Event("resize"));
      }, 220);
      return next;
    });
  }, []);

  const isCommandCenter = isCommandCenterPath(pathname);

  useLayoutEffect(() => {
    document.documentElement.dataset.appNav = isAuthScreen ? "0" : "1";
    if (
      pathname === "/login" ||
      pathname === "/install"
    ) {
      document.documentElement.dataset.authLight = "1";
    } else {
      delete document.documentElement.dataset.authLight;
    }
    if (isAuthScreen) {
      // Логін/install/copilot: жодного LEVADA-boot — splash ховається CSS (data-booting)
      delete document.documentElement.dataset.booting;
      delete document.documentElement.dataset.bootUi;
      delete document.documentElement.dataset.appReady;
    }
    // Без cleanup appNav=0: Strict Mode / remount на мить вмикає «логін» CSS
    // і html[data-app-nav=1]:not([data-app-ready]) лишає чорний екран.
  }, [isAuthScreen, pathname]);

  if (isAuthScreen) {
    return <>{children}</>;
  }

  return (
    <AppBootProvider>
      <AppShellChrome
        collapsed={collapsed}
        onToggleCollapsed={toggleCollapsed}
        isCommandCenter={isCommandCenter}
      >
        {children}
      </AppShellChrome>
    </AppBootProvider>
  );
}

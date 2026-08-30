"use client";

import { usePathname } from "next/navigation";
import { useCallback, useLayoutEffect, useEffect, useState, type ReactNode } from "react";

import { BottomNav } from "@/components/layout/bottom-nav";
import { AppDataWarmer } from "@/components/layout/app-data-warmer";
import { Sidebar } from "@/components/layout/sidebar";
import { TopBar } from "@/components/layout/top-bar";
import { AppBootProvider } from "@/lib/app-boot";
import { isCommandCenterPath } from "@/lib/equipment-command-center-layout";
import { cn } from "@/lib/utils";

const SIDEBAR_COLLAPSED_KEY = "agrosystem-sidebar-collapsed";

/** App Shell: фіксований viewport + згортання сайдбару */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isAuthScreen =
    pathname === "/login" || pathname === "/install";
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
    return () => {
      document.documentElement.dataset.appNav = "0";
    };
  }, [isAuthScreen]);

  if (isAuthScreen) {
    return <>{children}</>;
  }

  return (
    <AppBootProvider>
      <div
        className={cn(
          "flex h-full min-h-0 flex-col overflow-hidden overscroll-none text-zinc-900",
          // Моб: світлий контент (не #18181b під прозорим main). Карти — окремо.
          isCommandCenter
            ? "bg-transparent md:bg-zinc-100"
            : "bg-[#F4F1EA] md:bg-zinc-100"
        )}
      >
        <Sidebar collapsed={collapsed} onToggleCollapsed={toggleCollapsed} />

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
            {children}
          </div>
        </div>

        <BottomNav />
        <AppDataWarmer />
      </div>
    </AppBootProvider>
  );
}

"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import { BottomNav } from "@/components/layout/bottom-nav";
import { Sidebar } from "@/components/layout/sidebar";
import { TopBar } from "@/components/layout/top-bar";
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

  useEffect(() => {
    document.documentElement.dataset.appNav = isAuthScreen ? "0" : "1";
    return () => {
      document.documentElement.dataset.appNav = "0";
    };
  }, [isAuthScreen]);

  if (isAuthScreen) {
    return <>{children}</>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden overscroll-none bg-zinc-100 text-zinc-900">
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
    </div>
  );
}

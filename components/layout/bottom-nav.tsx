"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { getMyProfileAction } from "@/app/team/actions";
import { MobileBottomDrawer } from "@/components/layout/mobile-bottom-drawer";
import { MobileProfilePanel } from "@/components/layout/mobile-profile-panel";
import {
  BOTTOM_NAV_ITEMS,
  DOCK_BUSINESS_ITEMS,
  isNavItemActive,
  PROFILE_DOCK_ITEM,
} from "@/lib/navigation";
import { useAppBoot } from "@/lib/app-boot";
import type { AppActor } from "@/lib/app-actor-shared";
import { cn } from "@/lib/utils";

const DOCK_SPRING = { type: "spring" as const, stiffness: 300, damping: 30 };

const NAV_TEXT_CLASS =
  "max-w-full truncate text-[11px] font-bold leading-none tracking-[0.15px]";

const NAV_ITEM_CLASS =
  "flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-1 self-stretch px-0.5 pt-1.5 pb-[max(0.25rem,env(safe-area-inset-bottom,0px))] transition-colors duration-200 touch-manipulation";

const DOCK_TOGGLE_CLASS = cn(
  NAV_ITEM_CLASS,
  "text-zinc-400 active:text-zinc-200"
);

const slideVariants = {
  center: { x: "0%" },
  offLeft: { x: "-100%" },
  offRight: { x: "100%" },
};

function NavLinkItem({
  href,
  label,
  icon: Icon,
  active,
  onNavigate,
}: {
  href: string;
  label: string;
  icon: LucideIcon;
  active: boolean;
  onNavigate?: () => void;
}) {
  return (
    <Link
      href={href}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      onClick={onNavigate}
      className={cn(
        NAV_ITEM_CLASS,
        active ? "text-[#E8A87C]" : "text-zinc-500 active:text-zinc-300"
      )}
    >
      <Icon className="h-6 w-6" strokeWidth={active ? 2.1 : 1.85} />
      <span className={NAV_TEXT_CLASS}>{label}</span>
    </Link>
  );
}

function DockToggleIcon({
  children,
  active,
}: {
  children: React.ReactNode;
  active?: boolean;
}) {
  return (
    <span
      className={cn(
        "flex h-8 w-8 items-center justify-center rounded-full bg-white/[0.05] ring-1 ring-white/[0.07]",
        active && "bg-[#C05621]/15 ring-[#C05621]/25"
      )}
    >
      {children}
    </span>
  );
}

export function BottomNav() {
  const pathname = usePathname();
  const { revealChrome } = useAppBoot();
  const [activePage, setActivePage] = useState<0 | 1>(0);
  const [profileOpen, setProfileOpen] = useState(false);
  const [me, setMe] = useState<AppActor | null>(null);

  useEffect(() => {
    void getMyProfileAction().then(setMe);
  }, []);

  useEffect(() => {
    if (
      DOCK_BUSINESS_ITEMS.some((item) => isNavItemActive(pathname, item.href))
    ) {
      setActivePage(1);
    }
  }, [pathname]);

  const businessActive = DOCK_BUSINESS_ITEMS.some((item) =>
    isNavItemActive(pathname, item.href)
  );
  const profileActive = profileOpen;

  function goToPage(page: 0 | 1) {
    if (page === activePage) return;
    setActivePage(page);
  }

  function handleOperationalNavigate() {
    if (activePage === 1) goToPage(0);
  }

  return (
    <>
      <motion.nav
        data-bottom-nav
        aria-label="Головна навігація"
        className={cn(
          "fixed inset-x-0 bottom-0 z-[250] overflow-hidden bg-[var(--nav-bg)] md:hidden",
          "relative h-[var(--bottom-nav-height)]"
        )}
        initial={{ y: 20, opacity: 0 }}
        animate={
          revealChrome ? { y: 0, opacity: 1 } : { y: 20, opacity: 0 }
        }
        transition={{
          duration: 0.7,
          delay: revealChrome ? 0.5 : 0,
          ease: "easeOut",
        }}
        style={{ pointerEvents: revealChrome ? "auto" : "none" }}
      >
        <AnimatePresence initial={false} custom={activePage}>
          <motion.div
            key="dock-page-0"
            variants={slideVariants}
            initial={false}
            animate={activePage === 0 ? "center" : "offLeft"}
            transition={DOCK_SPRING}
            className={cn(
              "absolute inset-0 flex items-stretch justify-around px-1",
              activePage !== 0 && "pointer-events-none"
            )}
            aria-hidden={activePage !== 0}
          >
            {BOTTOM_NAV_ITEMS.map((item) => (
              <NavLinkItem
                key={item.href}
                href={item.href}
                label={item.label}
                icon={item.icon}
                active={isNavItemActive(pathname, item.href)}
                onNavigate={handleOperationalNavigate}
              />
            ))}

            <button
              type="button"
              aria-label="Ще"
              onClick={() => goToPage(1)}
              className={cn(
                DOCK_TOGGLE_CLASS,
                (activePage === 1 || businessActive) && "text-[#E8A87C]"
              )}
            >
              <DockToggleIcon active={activePage === 1 || businessActive}>
                <ChevronRight
                  className="h-5 w-5"
                  strokeWidth={2}
                />
              </DockToggleIcon>
              <span className={NAV_TEXT_CLASS}>Ще</span>
            </button>
          </motion.div>

          <motion.div
            key="dock-page-1"
            variants={slideVariants}
            initial={false}
            animate={activePage === 1 ? "center" : "offRight"}
            transition={DOCK_SPRING}
            className={cn(
              "absolute inset-0 flex items-stretch justify-around px-1",
              activePage !== 1 && "pointer-events-none"
            )}
            aria-hidden={activePage !== 1}
          >
            <button
              type="button"
              aria-label="Назад"
              onClick={() => goToPage(0)}
              className={DOCK_TOGGLE_CLASS}
            >
              <DockToggleIcon>
                <ChevronLeft className="h-5 w-5" strokeWidth={2} />
              </DockToggleIcon>
              <span className={NAV_TEXT_CLASS}>Назад</span>
            </button>

            {DOCK_BUSINESS_ITEMS.map((item) => (
              <NavLinkItem
                key={item.href}
                href={item.href}
                label={item.label}
                icon={item.icon}
                active={isNavItemActive(pathname, item.href)}
              />
            ))}

            <button
              type="button"
              aria-label={PROFILE_DOCK_ITEM.label}
              onClick={() => setProfileOpen(true)}
              className={cn(
                NAV_ITEM_CLASS,
                profileActive
                  ? "text-[#E8A87C]"
                  : "text-zinc-500 active:text-zinc-300"
              )}
            >
              <PROFILE_DOCK_ITEM.icon
                className="h-6 w-6"
                strokeWidth={profileActive ? 2.1 : 1.85}
              />
              <span className={NAV_TEXT_CLASS}>{PROFILE_DOCK_ITEM.label}</span>
            </button>
          </motion.div>
        </AnimatePresence>
      </motion.nav>

      {me ? (
        <MobileBottomDrawer
          open={profileOpen}
          onOpenChange={setProfileOpen}
          preserveNav
        >
          <MobileProfilePanel
            me={me}
            onBack={() => setProfileOpen(false)}
            onUpdated={setMe}
            backLabel="Закрити"
          />
        </MobileBottomDrawer>
      ) : null}
    </>
  );
}

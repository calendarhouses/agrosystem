"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { motion, type PanInfo } from "framer-motion";
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
/** Поріг зміщення / швидкості для зміни сторінки dock */
const SWIPE_OFFSET_PX = 56;
const SWIPE_VELOCITY = 450;

const NAV_TEXT_CLASS =
  "max-w-full truncate text-[11px] font-bold leading-none tracking-[0.15px]";

const NAV_ITEM_CLASS =
  "flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-1 self-stretch px-0.5 pt-1.5 pb-[max(0.25rem,env(safe-area-inset-bottom,0px))] transition-colors duration-200 touch-manipulation";

const slideVariants = {
  center: { x: "0%" },
  offLeft: { x: "-100%" },
  offRight: { x: "100%" },
};

function shouldGoNext(info: PanInfo): boolean {
  return info.offset.x < -SWIPE_OFFSET_PX || info.velocity.x < -SWIPE_VELOCITY;
}

function shouldGoPrev(info: PanInfo): boolean {
  return info.offset.x > SWIPE_OFFSET_PX || info.velocity.x > SWIPE_VELOCITY;
}

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

function DockPage({
  page,
  activePage,
  onSwipeNext,
  onSwipePrev,
  children,
}: {
  page: 0 | 1;
  activePage: 0 | 1;
  onSwipeNext?: () => void;
  onSwipePrev?: () => void;
  children: React.ReactNode;
}) {
  const isActive = activePage === page;

  function handleDragEnd(_event: unknown, info: PanInfo) {
    if (!isActive) return;
    if (shouldGoNext(info)) onSwipeNext?.();
    else if (shouldGoPrev(info)) onSwipePrev?.();
  }

  return (
    <motion.div
      variants={slideVariants}
      initial={false}
      animate={isActive ? "center" : page === 0 ? "offLeft" : "offRight"}
      transition={DOCK_SPRING}
      drag={isActive ? "x" : false}
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.18}
      dragMomentum={false}
      dragDirectionLock
      onDragEnd={handleDragEnd}
      className={cn(
        "absolute inset-0 flex items-stretch justify-around px-1",
        !isActive && "pointer-events-none"
      )}
      aria-hidden={!isActive}
    >
      {children}
    </motion.div>
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
        className="fixed inset-x-0 bottom-0 z-[250] h-[var(--bottom-nav-height)] overflow-hidden bg-[var(--nav-bg)] md:hidden"
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
        <DockPage
          page={0}
          activePage={activePage}
          onSwipeNext={() => goToPage(1)}
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
            aria-label="Далі"
            onClick={() => goToPage(1)}
            className={cn(
              NAV_ITEM_CLASS,
              activePage === 1 || businessActive
                ? "text-[#E8A87C]"
                : "text-zinc-500 active:text-zinc-300"
            )}
          >
            <ChevronRight
              className="h-6 w-6"
              strokeWidth={activePage === 1 || businessActive ? 2.1 : 1.85}
            />
            <span className={NAV_TEXT_CLASS}>Далі</span>
          </button>
        </DockPage>

        <DockPage
          page={1}
          activePage={activePage}
          onSwipePrev={() => goToPage(0)}
        >
          <button
            type="button"
            aria-label="Назад"
            onClick={() => goToPage(0)}
            className={cn(
              NAV_ITEM_CLASS,
              "text-zinc-500 active:text-zinc-300"
            )}
          >
            <ChevronLeft className="h-6 w-6" strokeWidth={1.85} />
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
        </DockPage>
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

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
  BOTTOM_NAV_OPS_PRIMARY,
  BOTTOM_NAV_OPS_SECONDARY,
  DOCK_BUSINESS_ITEMS,
  bottomNavPageForPath,
  isNavItemActive,
  PROFILE_DOCK_ITEM,
} from "@/lib/navigation";
import { useAppBoot } from "@/lib/app-boot";
import type { AppActor } from "@/lib/app-actor-shared";
import { cn } from "@/lib/utils";

const DOCK_SPRING = { type: "spring" as const, stiffness: 300, damping: 30 };
const SWIPE_OFFSET_PX = 56;
const SWIPE_VELOCITY = 450;

const NAV_TEXT_CLASS =
  "max-w-full truncate text-[11px] font-bold leading-none tracking-[0.15px]";

const NAV_ITEM_CLASS =
  "flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-1 self-stretch px-0.5 pt-1.5 pb-[max(0.25rem,env(safe-area-inset-bottom,0px))] transition-colors duration-200 touch-manipulation";

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

function DockPagerButton({
  label,
  ariaLabel,
  icon: Icon,
  active,
  onClick,
}: {
  label: string;
  ariaLabel: string;
  icon: typeof ChevronRight;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      className={cn(
        NAV_ITEM_CLASS,
        active ? "text-[#E8A87C]" : "text-zinc-500 active:text-zinc-300"
      )}
    >
      <Icon className="h-6 w-6" strokeWidth={active ? 2.1 : 1.85} />
      <span className={NAV_TEXT_CLASS}>{label}</span>
    </button>
  );
}

function DockPageIndicators({
  activePage,
  onSelect,
}: {
  activePage: 0 | 1 | 2;
  onSelect: (page: 0 | 1 | 2) => void;
}) {
  return (
    <div
      className="pointer-events-auto absolute inset-x-0 top-1.5 z-10 flex items-center justify-center gap-1.5"
      aria-hidden
    >
      {([0, 1, 2] as const).map((page) => (
        <button
          key={page}
          type="button"
          aria-label={`Сторінка меню ${page + 1}`}
          onClick={() => onSelect(page)}
          className={cn(
            "h-1 rounded-full transition-all duration-200",
            activePage === page
              ? "w-4 bg-[#E8A87C]"
              : "w-1 bg-zinc-600 hover:bg-zinc-500"
          )}
        />
      ))}
    </div>
  );
}

export function BottomNav() {
  const pathname = usePathname();
  const { revealChrome } = useAppBoot();
  const [activePage, setActivePage] = useState<0 | 1 | 2>(0);
  const [profileOpen, setProfileOpen] = useState(false);
  const [me, setMe] = useState<AppActor | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileError, setProfileError] = useState<string | null>(null);

  const loadProfile = () => {
    setProfileLoading(true);
    setProfileError(null);
    void getMyProfileAction()
      .then((data) => {
        setMe(data);
        if (!data) {
          setProfileError("Не вдалося завантажити профіль");
        }
      })
      .catch(() => {
        setProfileError("Не вдалося завантажити профіль");
      })
      .finally(() => {
        setProfileLoading(false);
      });
  };

  useEffect(() => {
    loadProfile();
  }, []);

  useEffect(() => {
    setActivePage(bottomNavPageForPath(pathname));
  }, [pathname]);

  const businessActive = DOCK_BUSINESS_ITEMS.some((item) =>
    isNavItemActive(pathname, item.href)
  );
  const profileActive = profileOpen;

  function goToPage(page: 0 | 1 | 2) {
    if (page === activePage) return;
    setActivePage(page);
  }

  function handleDragEnd(_event: unknown, info: PanInfo) {
    if (shouldGoNext(info) && activePage < 2) {
      goToPage((activePage + 1) as 1 | 2);
      return;
    }
    if (shouldGoPrev(info) && activePage > 0) {
      goToPage((activePage - 1) as 0 | 1);
    }
  }

  return (
    <>
      <motion.nav
        data-bottom-nav
        aria-label="Головна навігація"
        className="fixed inset-x-0 bottom-0 z-[100] h-[var(--bottom-nav-height)] overflow-hidden bg-[var(--nav-bg)] md:hidden"
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
        <DockPageIndicators activePage={activePage} onSelect={goToPage} />

        <motion.div
          className="flex h-full w-[300%] touch-pan-y"
          drag="x"
          dragConstraints={{ left: 0, right: 0 }}
          dragElastic={0.12}
          dragMomentum={false}
          onDragEnd={handleDragEnd}
          animate={{ x: `-${activePage * (100 / 3)}%` }}
          transition={DOCK_SPRING}
        >
          <div className="flex w-1/3 shrink-0 items-stretch justify-around px-1 pt-3">
            {BOTTOM_NAV_OPS_PRIMARY.map((item) => (
              <NavLinkItem
                key={item.href}
                href={item.href}
                label={item.label}
                icon={item.icon}
                active={isNavItemActive(pathname, item.href)}
              />
            ))}
            <DockPagerButton
              label="Далі"
              ariaLabel="Ще розділи"
              icon={ChevronRight}
              active={activePage > 0 || businessActive}
              onClick={() => goToPage(1)}
            />
          </div>

          <div className="flex w-1/3 shrink-0 items-stretch justify-around px-1 pt-3">
            <DockPagerButton
              label="Назад"
              ariaLabel="Попередні розділи"
              icon={ChevronLeft}
              onClick={() => goToPage(0)}
            />
            {BOTTOM_NAV_OPS_SECONDARY.map((item) => (
              <NavLinkItem
                key={item.href}
                href={item.href}
                label={item.label}
                icon={item.icon}
                active={isNavItemActive(pathname, item.href)}
              />
            ))}
            <DockPagerButton
              label="Далі"
              ariaLabel="Фінанси та бухгалтерія"
              icon={ChevronRight}
              active={activePage === 2 || businessActive}
              onClick={() => goToPage(2)}
            />
          </div>

          <div className="flex w-1/3 shrink-0 items-stretch justify-around px-1 pt-3">
            <DockPagerButton
              label="Назад"
              ariaLabel="Операційні розділи"
              icon={ChevronLeft}
              onClick={() => goToPage(1)}
            />
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
          </div>
        </motion.div>
      </motion.nav>

      <MobileBottomDrawer
        open={profileOpen}
        onOpenChange={setProfileOpen}
        preserveNav
      >
        <MobileProfilePanel
          me={me}
          onUpdated={setMe}
          loading={profileLoading && profileOpen}
          error={profileError}
          onRetry={loadProfile}
        />
      </MobileBottomDrawer>
    </>
  );
}

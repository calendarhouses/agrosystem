"use client"

import * as React from "react"
import { Select as SelectPrimitive } from "@base-ui/react/select"

import { SwipeableSheet } from "@/components/ui/swipe-sheet"
import { useInsideDrawer } from "@/components/ui/drawer"
import { useIsMobile } from "@/lib/use-mobile"
import { cn } from "@/lib/utils"
import { ChevronDownIcon, CheckIcon, ChevronUpIcon, XIcon } from "lucide-react"

const Select = SelectPrimitive.Root

function SelectGroup({ className, ...props }: SelectPrimitive.Group.Props) {
  return (
    <SelectPrimitive.Group
      data-slot="select-group"
      className={cn("scroll-my-1 p-1", className)}
      {...props}
    />
  )
}

function SelectValue({ className, ...props }: SelectPrimitive.Value.Props) {
  return (
    <SelectPrimitive.Value
      data-slot="select-value"
      className={cn(
        "min-w-0 flex-1 truncate text-left",
        className
      )}
      {...props}
    />
  )
}

function SelectTrigger({
  className,
  size = "default",
  children,
  ...props
}: SelectPrimitive.Trigger.Props & {
  size?: "sm" | "default"
}) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-size={size}
      className={cn(
        "flex w-fit min-w-0 items-center justify-between gap-1.5 rounded-lg border border-input bg-transparent py-2 pr-2 pl-2.5 text-base transition-colors outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 data-placeholder:text-muted-foreground data-[size=default]:h-11 data-[size=sm]:h-10 md:text-sm md:data-[size=default]:h-8 md:data-[size=sm]:h-7 data-[size=sm]:rounded-[min(var(--radius-md),10px)] *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:min-w-0 *:data-[slot=select-value]:flex-1 *:data-[slot=select-value]:truncate dark:bg-input/30 dark:hover:bg-input/50 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon
        render={
          <ChevronDownIcon className="pointer-events-none size-4 text-muted-foreground" />
        }
      />
    </SelectPrimitive.Trigger>
  )
}

const MOBILE_OVERLAY_Z = "z-[200]"

function SelectContent({
  className,
  children,
  side = "bottom",
  sideOffset = 4,
  align = "center",
  alignOffset = 0,
  alignItemWithTrigger = true,
  /** false — позиційований список (всередині drawer, без другої шторки) */
  sheetOnMobile = true,
  ...props
}: SelectPrimitive.Popup.Props &
  Pick<
    SelectPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset" | "alignItemWithTrigger"
  > & {
    sheetOnMobile?: boolean
  }) {
  const isMobile = useIsMobile()
  /** Portal поза деревом Drawer → context часто false; дивимось і DOM. */
  const insideDrawerCtx = useInsideDrawer()
  const [drawerOpenInDom, setDrawerOpenInDom] = React.useState(false)
  React.useLayoutEffect(() => {
    setDrawerOpenInDom(
      !!document.querySelector(
        '[data-slot="drawer-content"][data-state="open"], [data-slot="sheet-content"][data-state="open"]'
      )
    )
  }, [])
  const insideDrawer = insideDrawerCtx || drawerOpenInDom
  const backdropRef = React.useRef<HTMLDivElement>(null)
  const useSheet = isMobile && sheetOnMobile && !insideDrawer
  const alignWithTrigger = !useSheet && !insideDrawer && alignItemWithTrigger

  const popup = (
    <SelectPrimitive.Popup
      data-slot="select-content"
      data-align-trigger={alignWithTrigger || undefined}
      data-vaul-no-drag=""
      className={cn(
        "relative isolate w-(--anchor-width) min-w-36 origin-(--transform-origin) overflow-x-hidden rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 data-[align-trigger=true]:animate-none data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
        "pointer-events-auto",
        useSheet
          ? "max-h-(--available-height) overflow-y-auto"
          : "max-h-[min(var(--available-height,60dvh),24rem)] overflow-hidden",
        className,
        useSheet &&
          "fixed inset-x-0 bottom-[var(--app-bottom-inset)] top-auto max-h-[var(--app-sheet-max)] w-full min-w-0 origin-bottom overflow-hidden rounded-t-3xl rounded-b-none pb-[max(0.5rem,var(--safe-bottom))] shadow-2xl ring-0 data-open:zoom-in-100",
        useSheet ? MOBILE_OVERLAY_Z : "z-[220]"
      )}
      {...props}
    >
      {useSheet ? (
        <>
          <SwipeableSheet
            className="max-h-[var(--app-sheet-max)]"
            onSwipeDown={() => backdropRef.current?.click()}
          >
            <SelectPrimitive.List className="max-h-[min(60dvh,calc(var(--app-sheet-max)-3rem))] overflow-y-auto overscroll-none p-1.5 pt-2 pr-12">
              {children}
            </SelectPrimitive.List>
          </SwipeableSheet>
          <button
            type="button"
            aria-label="Закрити"
            onClick={() => backdropRef.current?.click()}
            className={cn(
              "absolute top-2.5 right-3 z-20 inline-flex h-9 w-9 items-center justify-center rounded-full",
              "bg-white/80 text-zinc-500 shadow-sm ring-1 ring-zinc-200/80",
              "transition-colors hover:bg-white hover:text-zinc-800",
              "touch-manipulation"
            )}
          >
            <XIcon className="h-4 w-4" />
          </button>
        </>
      ) : (
        <>
          <SelectScrollUpButton />
          <SelectPrimitive.List
            className="max-h-[min(var(--available-height,55dvh),22rem)] overflow-y-auto overscroll-contain touch-pan-y p-1"
            data-vaul-no-drag=""
            data-allow-pan="true"
          >
            {children}
          </SelectPrimitive.List>
          <SelectScrollDownButton />
        </>
      )}
    </SelectPrimitive.Popup>
  )

  if (useSheet) {
    return (
      <SelectPrimitive.Portal>
        <SelectPrimitive.Backdrop
          ref={backdropRef}
          className={cn(
            "fixed top-0 right-0 bottom-[var(--app-bottom-inset)] left-0 bg-black/70 supports-backdrop-filter:backdrop-blur-[3px]",
            MOBILE_OVERLAY_Z
          )}
        />
        {popup}
      </SelectPrimitive.Portal>
    )
  }

  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner
        side={side}
        sideOffset={sideOffset}
        align={align}
        alignOffset={alignOffset}
        alignItemWithTrigger={alignWithTrigger}
        collisionPadding={12}
        className="pointer-events-auto isolate z-[220]"
      >
        {popup}
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  )
}

function SelectLabel({
  className,
  ...props
}: SelectPrimitive.GroupLabel.Props) {
  return (
    <SelectPrimitive.GroupLabel
      data-slot="select-label"
      className={cn("px-1.5 py-1 text-xs text-muted-foreground", className)}
      {...props}
    />
  )
}

function SelectItem({
  className,
  children,
  ...props
}: SelectPrimitive.Item.Props) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "relative flex w-full min-h-11 cursor-default items-center gap-1.5 rounded-xl py-2.5 pr-8 pl-3 text-base outline-hidden select-none focus:bg-accent focus:text-accent-foreground not-data-[variant=destructive]:focus:**:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50 md:min-h-0 md:rounded-md md:py-1 md:pr-8 md:pl-1.5 md:text-sm [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 *:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2",
        className
      )}
      {...props}
    >
      <SelectPrimitive.ItemText className="min-w-0 flex-1 truncate">
        {children}
      </SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator
        render={
          <span className="pointer-events-none absolute right-2 flex size-4 items-center justify-center" />
        }
      >
        <CheckIcon className="pointer-events-none" />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  )
}

function SelectSeparator({
  className,
  ...props
}: SelectPrimitive.Separator.Props) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn("pointer-events-none -mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  )
}

function SelectScrollUpButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpArrow>) {
  return (
    <SelectPrimitive.ScrollUpArrow
      data-slot="select-scroll-up-button"
      className={cn(
        "top-0 z-10 flex w-full cursor-default items-center justify-center bg-popover py-1 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      <ChevronUpIcon
      />
    </SelectPrimitive.ScrollUpArrow>
  )
}

function SelectScrollDownButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownArrow>) {
  return (
    <SelectPrimitive.ScrollDownArrow
      data-slot="select-scroll-down-button"
      className={cn(
        "bottom-0 z-10 flex w-full cursor-default items-center justify-center bg-popover py-1 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      <ChevronDownIcon
      />
    </SelectPrimitive.ScrollDownArrow>
  )
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
}

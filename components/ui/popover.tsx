"use client"

import * as React from "react"
import { XIcon } from "lucide-react"
import { Popover as PopoverPrimitive } from "@base-ui/react/popover"

import { SwipeableSheet } from "@/components/ui/swipe-sheet"
import { useInsideDrawer, useDrawerOpenInDom } from "@/components/ui/drawer"
import { useIsMobile } from "@/lib/use-mobile"
import { cn } from "@/lib/utils"

const MOBILE_OVERLAY_Z = "z-[260]"

function Popover({
  modal,
  ...props
}: PopoverPrimitive.Root.Props) {
  const insideDrawer = useInsideDrawer()
  // Усередині vaul — modal, інакше кліки «проходять» крізь календар на кнопки під ним
  const resolvedModal = modal ?? (insideDrawer ? true : false)
  return (
    <PopoverPrimitive.Root
      data-slot="popover"
      modal={resolvedModal}
      {...props}
    />
  )
}

function PopoverTrigger({ ...props }: PopoverPrimitive.Trigger.Props) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />
}

function PopoverContent({
  className,
  align = "center",
  alignOffset = 0,
  side = "bottom",
  sideOffset = 4,
  children,
  /** false — завжди позиційований попап (всередині vaul-шторки, без другого bottom-sheet) */
  sheetOnMobile = true,
  ...props
}: PopoverPrimitive.Popup.Props &
  Pick<
    PopoverPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset"
  > & {
    sheetOnMobile?: boolean
  }) {
  const isMobile = useIsMobile()
  /** Portal поза деревом Drawer/Sheet → context часто false; дивимось і DOM. */
  const insideDrawerCtx = useInsideDrawer()
  const drawerOpenInDom = useDrawerOpenInDom()
  const insideDrawer = insideDrawerCtx || drawerOpenInDom
  const closeRef = React.useRef<HTMLButtonElement>(null)
  const useSheet = isMobile && sheetOnMobile && !insideDrawer

  const popup = (
    <PopoverPrimitive.Popup
      data-slot="popover-content"
      data-vaul-no-drag=""
      className={cn(
        "pointer-events-auto flex w-72 origin-(--transform-origin) flex-col gap-2.5 rounded-lg bg-popover p-2.5 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-hidden duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
        className,
        useSheet &&
          "fixed inset-x-0 top-auto max-h-[var(--app-sheet-max)] w-full max-w-none origin-bottom gap-0 overflow-hidden rounded-t-3xl rounded-b-none p-0 pb-[max(0.75rem,var(--safe-bottom))] shadow-2xl ring-0 data-[side=bottom]:slide-in-from-bottom-4 data-open:zoom-in-100 bottom-[var(--app-bottom-inset)]",
        useSheet ? MOBILE_OVERLAY_Z : "z-[260]"
      )}
      {...props}
    >
      {useSheet ? (
        <>
          <SwipeableSheet
            className="max-h-[var(--app-sheet-max)]"
            onSwipeDown={() => closeRef.current?.click()}
          >
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-none p-4 pr-12 pt-2">
              {children}
            </div>
          </SwipeableSheet>
          <PopoverPrimitive.Close
            ref={closeRef}
            className={cn(
              "absolute top-2.5 right-3 z-20 inline-flex h-9 w-9 items-center justify-center rounded-full",
              "bg-white/80 text-zinc-500 shadow-sm ring-1 ring-zinc-200/80",
              "transition-colors hover:bg-white hover:text-zinc-800",
              "touch-manipulation"
            )}
            aria-label="Закрити"
          >
            <XIcon className="h-4 w-4" />
          </PopoverPrimitive.Close>
        </>
      ) : (
        <>
          {insideDrawer ? (
            <PopoverPrimitive.Close className="sr-only" aria-label="Закрити">
              Закрити
            </PopoverPrimitive.Close>
          ) : null}
          {children}
        </>
      )}
    </PopoverPrimitive.Popup>
  )

  if (useSheet) {
    return (
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Backdrop
          className={cn(
            "fixed top-0 right-0 bottom-[var(--app-bottom-inset)] left-0 bg-black/70 supports-backdrop-filter:backdrop-blur-[3px]",
            MOBILE_OVERLAY_Z
          )}
        />
        {popup}
      </PopoverPrimitive.Portal>
    )
  }

  return (
    <PopoverPrimitive.Portal>
      {insideDrawer ? (
        <PopoverPrimitive.Backdrop
          className={cn(
            "fixed inset-x-0 top-0 bottom-[var(--app-bottom-inset)] z-[259]",
            "bg-black/55 supports-backdrop-filter:backdrop-blur-[2px]"
          )}
        />
      ) : null}
      <PopoverPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        className="pointer-events-auto isolate z-[260]"
      >
        {popup}
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  )
}

function PopoverHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="popover-header"
      className={cn("flex flex-col gap-0.5 text-sm", className)}
      {...props}
    />
  )
}

function PopoverTitle({ className, ...props }: PopoverPrimitive.Title.Props) {
  return (
    <PopoverPrimitive.Title
      data-slot="popover-title"
      className={cn("font-medium", className)}
      {...props}
    />
  )
}

function PopoverDescription({
  className,
  ...props
}: PopoverPrimitive.Description.Props) {
  return (
    <PopoverPrimitive.Description
      data-slot="popover-description"
      className={cn("text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
}

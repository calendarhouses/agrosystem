"use client"

import * as React from "react"
import { Popover as PopoverPrimitive } from "@base-ui/react/popover"

import { SwipeableSheet } from "@/components/ui/swipe-sheet"
import { useIsMobile } from "@/lib/use-mobile"
import { cn } from "@/lib/utils"

const MOBILE_OVERLAY_Z = "z-[200]"

function Popover({ ...props }: PopoverPrimitive.Root.Props) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />
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
  ...props
}: PopoverPrimitive.Popup.Props &
  Pick<
    PopoverPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset"
  >) {
  const isMobile = useIsMobile()
  const closeRef = React.useRef<HTMLButtonElement>(null)

  const popup = (
    <PopoverPrimitive.Popup
      data-slot="popover-content"
      data-vaul-no-drag=""
      className={cn(
        "flex w-72 origin-(--transform-origin) flex-col gap-2.5 rounded-lg bg-popover p-2.5 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-hidden duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
        className,
        isMobile &&
          "fixed inset-x-0 top-auto max-h-[var(--app-sheet-max)] w-full max-w-none origin-bottom gap-0 overflow-hidden rounded-t-3xl rounded-b-none p-0 pb-[max(0.75rem,var(--safe-bottom))] shadow-2xl ring-0 data-[side=bottom]:slide-in-from-bottom-4 data-open:zoom-in-100 bottom-[var(--app-bottom-inset)]",
        MOBILE_OVERLAY_Z
      )}
      {...props}
    >
      {isMobile ? (
        <>
          <SwipeableSheet
            className="max-h-[var(--app-sheet-max)]"
            onSwipeDown={() => closeRef.current?.click()}
          >
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-none p-4">
              {children}
            </div>
          </SwipeableSheet>
          <PopoverPrimitive.Close
            ref={closeRef}
            className="sr-only"
            tabIndex={-1}
          >
            Закрити
          </PopoverPrimitive.Close>
        </>
      ) : (
        children
      )}
    </PopoverPrimitive.Popup>
  )

  if (isMobile) {
    return (
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Backdrop
          className={cn(
            "fixed inset-0 bg-black/40 supports-backdrop-filter:backdrop-blur-[2px]",
            MOBILE_OVERLAY_Z
          )}
        />
        {popup}
      </PopoverPrimitive.Portal>
    )
  }

  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        className="isolate z-50"
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

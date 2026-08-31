"use client"

import * as React from "react"
import { Dialog as SheetPrimitive } from "@base-ui/react/dialog"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { XIcon } from "lucide-react"
import { SwipeableSheet } from "@/components/ui/swipe-sheet"
import { useIsMobile } from "@/lib/use-mobile"

const OVERLAY_Z = "z-[260]"

function Sheet({ ...props }: SheetPrimitive.Root.Props) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />
}

function SheetTrigger({ ...props }: SheetPrimitive.Trigger.Props) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />
}

function SheetClose({ ...props }: SheetPrimitive.Close.Props) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />
}

function SheetPortal({ ...props }: SheetPrimitive.Portal.Props) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />
}

function SheetOverlay({ className, ...props }: SheetPrimitive.Backdrop.Props) {
  return (
    <SheetPrimitive.Backdrop
      data-slot="sheet-overlay"
      className={cn(
        "fixed top-0 right-0 bottom-[var(--app-bottom-inset)] left-0 bg-black/70 transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0 supports-backdrop-filter:backdrop-blur-[3px]",
        className,
        OVERLAY_Z
      )}
      {...props}
    />
  )
}

function SheetContent({
  className,
  children,
  side = "right",
  showCloseButton = true,
  /** За замовчуванням затемнення. Для диспетчерських панелей — false. */
  showOverlay = true,
  overlayClassName,
  ...props
}: SheetPrimitive.Popup.Props & {
  side?: "top" | "right" | "bottom" | "left"
  showCloseButton?: boolean
  showOverlay?: boolean
  overlayClassName?: string
}) {
  const isMobile = useIsMobile()
  const closeRef = React.useRef<HTMLButtonElement>(null)
  const resolvedSide =
    isMobile && (side === "right" || side === "left") ? "bottom" : side

  return (
    <SheetPortal>
      {showOverlay ? (
        <SheetOverlay className={overlayClassName} />
      ) : (
        <SheetOverlay
          className={cn(
            "pointer-events-none bg-transparent supports-backdrop-filter:backdrop-blur-none",
            overlayClassName
          )}
        />
      )}
      <SheetPrimitive.Popup
        data-slot="sheet-content"
        data-vaul-no-drag=""
        data-side={resolvedSide}
        className={cn(
          "fixed flex flex-col gap-4 bg-popover bg-clip-padding text-sm text-popover-foreground shadow-lg transition duration-200 ease-in-out data-ending-style:opacity-0 data-starting-style:opacity-0 data-[side=bottom]:inset-x-0 data-[side=bottom]:bottom-0 data-[side=bottom]:h-auto data-[side=bottom]:border-t data-[side=bottom]:data-ending-style:translate-y-[2.5rem] data-[side=bottom]:data-starting-style:translate-y-[2.5rem] data-[side=left]:inset-y-0 data-[side=left]:left-0 data-[side=left]:h-full data-[side=left]:w-3/4 data-[side=left]:border-r data-[side=left]:data-ending-style:translate-x-[-2.5rem] data-[side=left]:data-starting-style:translate-x-[-2.5rem] data-[side=right]:inset-y-0 data-[side=right]:right-0 data-[side=right]:h-full data-[side=right]:w-3/4 data-[side=right]:border-l data-[side=right]:data-ending-style:translate-x-[2.5rem] data-[side=right]:data-starting-style:translate-x-[2.5rem] data-[side=top]:inset-x-0 data-[side=top]:top-0 data-[side=top]:h-auto data-[side=top]:border-b data-[side=top]:data-ending-style:translate-y-[-2.5rem] data-[side=top]:data-starting-style:translate-y-[-2.5rem] data-[side=left]:sm:max-w-2xl data-[side=right]:sm:max-w-2xl",
          resolvedSide === "bottom" &&
            isMobile &&
            "h-[var(--app-sheet-max)] max-h-[var(--app-sheet-max)] gap-0 overflow-hidden rounded-t-3xl border-x-0 pb-[max(0.5rem,env(safe-area-inset-bottom,0px))] data-[side=bottom]:bottom-[var(--app-bottom-inset)]",
          className,
          OVERLAY_Z
        )}
        {...props}
      >
        {isMobile && resolvedSide === "bottom" ? (
          <>
            <SwipeableSheet
              className="min-h-0 flex-1"
              onSwipeDown={() => closeRef.current?.click()}
            >
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                {children}
              </div>
            </SwipeableSheet>
            <SheetPrimitive.Close ref={closeRef} className="sr-only">
              Закрити
            </SheetPrimitive.Close>
          </>
        ) : (
          children
        )}
        {showCloseButton && (
          <SheetPrimitive.Close
            data-slot="sheet-close"
            render={
              <Button
                variant="ghost"
                className="absolute top-3 right-3"
                size="icon-sm"
              />
            }
          >
            <XIcon />
            <span className="sr-only">Закрити</span>
          </SheetPrimitive.Close>
        )}
      </SheetPrimitive.Popup>
    </SheetPortal>
  )
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex flex-col gap-0.5 p-4", className)}
      {...props}
    />
  )
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn("mt-auto flex flex-col gap-2 p-4", className)}
      {...props}
    />
  )
}

function SheetTitle({ className, ...props }: SheetPrimitive.Title.Props) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn(
        "font-heading text-base font-medium text-foreground",
        className
      )}
      {...props}
    />
  )
}

function SheetDescription({
  className,
  ...props
}: SheetPrimitive.Description.Props) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
}

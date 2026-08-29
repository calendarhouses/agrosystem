"use client"

import * as React from "react"
import { XIcon } from "lucide-react"
import { Drawer as DrawerPrimitive } from "vaul"
/** Локальна копія: `vaul` не експортує `style.css` у package.json exports → Next build падає. */
import "./vaul-drawer.css"

import { cn } from "@/lib/utils"

/** Глибина вкладеності vaul-drawer — Select/Popover всередині не відкривають другу шторку. */
const DrawerDepthContext = React.createContext(0)

export function useInsideDrawer() {
  return React.useContext(DrawerDepthContext) > 0
}

function Drawer({
  shouldScaleBackground = false,
  handleOnly = false,
  noBodyStyles = true,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Root>) {
  return (
    <DrawerPrimitive.Root
      data-slot="drawer"
      shouldScaleBackground={shouldScaleBackground}
      handleOnly={handleOnly}
      noBodyStyles={noBodyStyles}
      {...props}
    />
  )
}

function DrawerTrigger({
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Trigger>) {
  return <DrawerPrimitive.Trigger data-slot="drawer-trigger" {...props} />
}

function DrawerPortal({
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Portal>) {
  return <DrawerPrimitive.Portal data-slot="drawer-portal" {...props} />
}

function DrawerClose({
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Close>) {
  return <DrawerPrimitive.Close data-slot="drawer-close" {...props} />
}

function DrawerOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Overlay>) {
  return (
    <DrawerPrimitive.Overlay
      data-slot="drawer-overlay"
      className={cn(
        // bottom inset — сіре меню завжди видно під шторкою
        "fixed top-0 right-0 bottom-[var(--app-bottom-inset)] left-0 z-[150] bg-black/45",
        "data-[state=closed]:pointer-events-none",
        // Peek/snap: оверлей часто opacity:0, але без цього краде всі тапи (пошук, мапа, шторка)
        "pointer-events-none data-[vaul-snap-points=true]:pointer-events-none",
        "data-[vaul-snap-points-overlay=true]:pointer-events-auto",
        "data-[vaul-snap-points=false][data-state=open]:pointer-events-auto",
        className
      )}
      {...props}
    />
  )
}

function DrawerContent({
  className,
  children,
  overlayClassName,
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Content> & {
  overlayClassName?: string
  showCloseButton?: boolean
}) {
  const depth = React.useContext(DrawerDepthContext)

  return (
    <DrawerPortal>
      <DrawerOverlay className={overlayClassName} />
      <DrawerDepthContext.Provider value={depth + 1}>
        <DrawerPrimitive.Content
          data-slot="drawer-content"
          className={cn(
            "fixed inset-x-0 bottom-[var(--app-bottom-inset)] z-[150] flex max-h-[calc(96dvh-var(--app-bottom-inset))] flex-col rounded-t-3xl border border-[#E5DFD3]/80 bg-[#F4F1EA] outline-none",
            "pb-3",
            "data-[state=closed]:pointer-events-none data-[state=open]:pointer-events-auto",
            className
          )}
          {...props}
        >
          {children}
          {showCloseButton ? (
            <DrawerPrimitive.Close
              data-slot="drawer-close"
              className={cn(
                "absolute top-2.5 right-3 z-20 inline-flex h-9 w-9 items-center justify-center rounded-full",
                "bg-white/80 text-zinc-500 shadow-sm ring-1 ring-zinc-200/80",
                "transition-colors hover:bg-white hover:text-zinc-800",
                "touch-manipulation"
              )}
              aria-label="Закрити"
            >
              <XIcon className="h-4 w-4" />
            </DrawerPrimitive.Close>
          ) : null}
        </DrawerPrimitive.Content>
      </DrawerDepthContext.Provider>
    </DrawerPortal>
  )
}

function DrawerHandle({
  className,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Handle>) {
  return (
    <DrawerPrimitive.Handle
      data-slot="drawer-handle"
      className={cn(
        "relative mx-auto mt-1.5 mb-0.5 flex h-11 w-full shrink-0 touch-none items-center justify-center bg-transparent",
        "before:block before:h-1.5 before:w-12 before:rounded-full before:bg-zinc-400/90 before:content-['']",
        className
      )}
      {...props}
    />
  )
}

function DrawerHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="drawer-header"
      className={cn("flex flex-col gap-0.5 px-4 pr-14 text-left", className)}
      {...props}
    />
  )
}

function DrawerTitle({
  className,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Title>) {
  return (
    <DrawerPrimitive.Title
      data-slot="drawer-title"
      className={cn("text-base font-semibold text-foreground", className)}
      {...props}
    />
  )
}

function DrawerDescription({
  className,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Description>) {
  return (
    <DrawerPrimitive.Description
      data-slot="drawer-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Drawer,
  DrawerTrigger,
  DrawerPortal,
  DrawerOverlay,
  DrawerClose,
  DrawerContent,
  DrawerHandle,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
}

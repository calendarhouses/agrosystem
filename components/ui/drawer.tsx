"use client"

import * as React from "react"
import { XIcon } from "lucide-react"
import { Drawer as DrawerPrimitive } from "vaul"
/** Локальна копія: `vaul` не експортує `style.css` у package.json exports → Next build падає. */
import "./vaul-drawer.css"

import { cn } from "@/lib/utils"

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
        "fixed top-0 right-0 bottom-0 left-0 z-[150] bg-black/45",
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
  return (
    <DrawerPortal>
      <DrawerOverlay className={overlayClassName} />
      <DrawerPrimitive.Content
        data-slot="drawer-content"
        className={cn(
          "fixed inset-x-0 bottom-0 z-[150] flex max-h-[96dvh] flex-col rounded-t-3xl border border-[#E5DFD3]/80 bg-[#F4F1EA] outline-none",
          "pb-[calc(12px+env(safe-area-inset-bottom,0px))]",
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
        "mx-auto my-3 h-1.5 w-12 shrink-0 rounded-full bg-muted touch-none",
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

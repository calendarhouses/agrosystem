import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "LEVADIUS",
  description: "Автономний диспетчер агрогосподарства LEVADA",
  applicationName: "LEVADIUS",
  manifest: "/levadius.webmanifest",
  icons: {
    icon: [
      { url: "/icons/icon-192.png?v=7", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png?v=7", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      { url: "/apple-touch-icon.png?v=7", sizes: "180x180", type: "image/png" },
    ],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "LEVADIUS",
  },
  other: {
    "mobile-web-app-capable": "yes",
    "apple-mobile-web-app-capable": "yes",
    "apple-mobile-web-app-status-bar-style": "black-translucent",
    "apple-mobile-web-app-title": "LEVADIUS",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#09090b",
  interactiveWidget: "overlays-content",
};

export default function CopilotPwaLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="h-[100dvh] min-h-0 overflow-hidden bg-zinc-950 text-zinc-50">
      {children}
    </div>
  );
}

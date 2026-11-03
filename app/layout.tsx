import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import type { ReactNode } from "react";
import { Toaster } from "sonner";

import { AppShell } from "@/components/layout/app-shell";
import { PwaBootstrap } from "@/components/pwa/pwa-bootstrap";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "LEVADA SYSTEM",
    template: "%s · LEVADA",
  },
  description: "Операційна система господарства",
  manifest: "/manifest.webmanifest",
  applicationName: "LEVADA SYSTEM",
  icons: {
    icon: [
      { url: "/icons/icon-192.png?v=8", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png?v=8", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      { url: "/apple-touch-icon.png?v=8", sizes: "180x180", type: "image/png" },
    ],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "LEVADA",
    startupImage: [],
  },
  formatDetection: {
    telephone: false,
  },
  other: {
    "mobile-web-app-capable": "yes",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  interactiveWidget: "overlays-content",
  themeColor: [
    { media: "(max-width: 767px)", color: "#18181b" },
    { color: "#276749" },
  ],
};

/** Inline: шлях → auth vs app. Має бути ДО CSS, інакше логін на мить/назавжди чорний. */
const BOOT_PATH_SCRIPT = `(function(){var p=location.pathname;var shellOff=p==='/login'||p==='/install'||p==='/copilot'||p.indexOf('/copilot/')===0;var light=p==='/login'||p==='/install';var levadius=p==='/copilot'||p.indexOf('/copilot/')===0;document.documentElement.dataset.appNav=shellOff?'0':'1';if(light){document.documentElement.dataset.authLight='1';}else{delete document.documentElement.dataset.authLight;}if(levadius){document.documentElement.dataset.levadiusBooting='1';}else{delete document.documentElement.dataset.levadiusBooting;delete document.documentElement.dataset.levadiusBootUi;}if(shellOff){delete document.documentElement.dataset.booting;delete document.documentElement.dataset.appReady;}else{document.documentElement.dataset.booting='1';}})();`;

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <html
      lang="uk"
      className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/* Inline script лишаємо: data-* до першого paint. CSS — у globals.css
            (inline <style> у head давав hydration mismatch у Next 16 / Turbopack). */}
        <script dangerouslySetInnerHTML={{ __html: BOOT_PATH_SCRIPT }} />
      </head>
      <body className="overflow-hidden font-sans text-zinc-900">
        {/* Видимий лише при data-booting=1 — ніколи не накриває /login.
            Бренд тут, щоб до гідрації не було «тупо чорного» екрана. */}
        <div id="boot-splash" aria-hidden="true">
          <p className="boot-title">L E V A D A</p>
          <p className="boot-sub">AGRO OPERATING SYSTEM</p>
        </div>
        {/* /copilot: тримає #09090b до React LevadiusBootOverlay (без сірого спалаху). */}
        <div id="levadius-boot-splash" aria-hidden="true" />
        <PwaBootstrap />
        <div id="app-root" className="h-dvh min-h-0 overflow-hidden">
          <AppShell>{children}</AppShell>
        </div>
        <Toaster
          position="top-center"
          theme="dark"
          closeButton
          offset={16}
          mobileOffset={{
            top: "calc(var(--safe-top) + 12px)",
            right: "12px",
            left: "12px",
          }}
          toastOptions={{
            classNames: {
              toast:
                "border border-zinc-700/80 bg-zinc-950 text-zinc-50 shadow-2xl",
              title: "text-zinc-50 font-semibold",
              description: "text-zinc-400",
              success: "border-zinc-700/80 bg-zinc-950 text-zinc-50",
              error: "border-red-900/60 bg-zinc-950 text-zinc-50",
              info: "border-zinc-700/80 bg-zinc-950 text-zinc-50",
              warning: "border-zinc-700/80 bg-zinc-950 text-zinc-50",
              closeButton:
                "border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800 hover:text-white",
            },
          }}
        />
      </body>
    </html>
  );
}

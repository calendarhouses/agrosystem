import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
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
      { url: "/icons/icon-192.png?v=6", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png?v=6", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      { url: "/apple-touch-icon.png?v=6", sizes: "180x180", type: "image/png" },
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
const BOOT_PATH_SCRIPT = `(function(){var p=location.pathname;var auth=p==='/login'||p==='/install';document.documentElement.dataset.appNav=auth?'0':'1';if(auth){delete document.documentElement.dataset.booting;delete document.documentElement.dataset.appReady;}else{document.documentElement.dataset.booting='1';}})();`;

/**
 * Чорний boot-шар лише при data-booting=1 (після логіну в систему).
 * Логін/install (data-app-nav=0) — світлий фон, без splash.
 */
const BOOT_CRITICAL_CSS = [
  "html[data-app-nav='0'],html[data-app-nav='0'] body,html[data-app-nav='0'] #app-root{background-color:#f4f4f5!important}",
  "html[data-booting='1'],html[data-booting='1'] body,html[data-booting='1'] #app-root{background-color:#09090b!important}",
  "html[data-app-nav='1'][data-app-ready='1'],html[data-app-nav='1'][data-app-ready='1'] body,html[data-app-nav='1'][data-app-ready='1'] #app-root{background-color:#18181b!important;transition:background-color .7s ease-out .5s}",
  "html[data-booting='1'] [data-bottom-nav],html[data-booting='1'] [data-fields-mobile-chrome]{opacity:0;pointer-events:none;transform:translateY(12px)}",
  /* Під React Preloader (z-9999). Не .remove() — інакше NotFoundError. */
  "#boot-splash{display:none;position:fixed;inset:0;z-index:9990;background:#09090b;pointer-events:none;align-items:center;justify-content:center;flex-direction:column}",
  "html[data-booting='1'] #boot-splash{display:flex}",
  "html[data-boot-ui='1'] #boot-splash{visibility:hidden}",
  "#boot-splash .boot-title{margin:0;color:#fff;font-size:1.65rem;font-weight:200;letter-spacing:.3em;font-family:ui-sans-serif,system-ui,-apple-system,sans-serif}",
  "#boot-splash .boot-sub{margin:.75rem 0 0;color:#71717a;font-size:.75rem;letter-spacing:.2em;font-family:ui-sans-serif,system-ui,-apple-system,sans-serif}",
].join("");

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="uk"
      className={`${geistSans.variable} ${geistMono.variable} antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: BOOT_PATH_SCRIPT }} />
        <style dangerouslySetInnerHTML={{ __html: BOOT_CRITICAL_CSS }} />
      </head>
      <body className="overflow-hidden font-sans text-zinc-900">
        {/* Видимий лише при data-booting=1 — ніколи не накриває /login.
            Бренд тут, щоб до гідрації не було «тупо чорного» екрана. */}
        <div id="boot-splash" aria-hidden="true">
          <p className="boot-title">L E V A D A</p>
          <p className="boot-sub">AGRO OPERATING SYSTEM</p>
        </div>
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

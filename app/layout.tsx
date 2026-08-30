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
      { url: "/icons/icon-192.png?v=4", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png?v=4", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      { url: "/apple-touch-icon.png?v=4", sizes: "180x180", type: "image/png" },
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
    { media: "(max-width: 767px)", color: "#09090b" },
    { color: "#276749" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="uk"
      className={`${geistSans.variable} ${geistMono.variable} antialiased`}
    >
      <head>
        {/* Критично: до JS — zinc-950 одразу, без чорного→сірого спалаху */}
        <style
          dangerouslySetInnerHTML={{
            __html: `html,body{background-color:#09090b!important}@media(max-width:767px){html[data-app-nav="0"],html[data-app-nav="0"] body{background-color:#f4f4f5!important}}html[data-booting="1"] [data-bottom-nav],html[data-booting="1"] [data-fields-mobile-chrome]{visibility:hidden!important;opacity:0!important;pointer-events:none!important}#boot-splash{position:fixed;inset:0;z-index:10000;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#09090b;pointer-events:none}#boot-splash .boot-title{color:#fff;font-weight:200;font-size:1.65rem;letter-spacing:0.3em;font-family:system-ui,-apple-system,sans-serif}#boot-splash .boot-sub{margin-top:0.75rem;color:#71717a;font-size:0.75rem;letter-spacing:0.2em;font-family:system-ui,-apple-system,sans-serif}`,
          }}
        />
      </head>
      <body className="overflow-hidden font-sans text-zinc-900">
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var p=location.pathname;var auth=p==='/login'||p==='/install';document.documentElement.dataset.appNav=auth?'0':'1';if(!auth)document.documentElement.dataset.booting='1';})();`,
          }}
        />
        {/* Миттєвий splash до гідрації React — той самий zinc-950 що LEVADA */}
        <div id="boot-splash" aria-hidden="true">
          <div className="boot-title">L E V A D A</div>
          <div className="boot-sub">AGRO OPERATING SYSTEM</div>
        </div>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){if(document.documentElement.dataset.appNav==='0'){var s=document.getElementById('boot-splash');if(s)s.remove();}})();`,
          }}
        />
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

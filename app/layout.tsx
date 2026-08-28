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
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
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
  viewportFit: "cover",
  themeColor: "#18181b",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="uk"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="h-full overflow-hidden bg-zinc-100 font-sans text-zinc-900">
        <PwaBootstrap />
        <AppShell>{children}</AppShell>
        <Toaster
          position="bottom-right"
          theme="dark"
          closeButton
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

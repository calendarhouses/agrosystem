import type { NextConfig } from "next";

/**
 * Секрети (не NEXT_PUBLIC_* — лише сервер):
 * - CRON_SECRET — Bearer / ?secret= для /api/cron/*
 *   Vercel Hobby: лише daily crons у vercel.json (fuel / equipment-day / inventory).
 *   morning-brief + telemetry-alerts — зовнішньо (cron-job.org), не в vercel.json.
 * - WIALON_API_TOKEN — Wialon Hosting token
 * - SUPABASE_SERVICE_ROLE_KEY — upsert логів палива / денної статистики
 * - TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID — проактивні сповіщення LEVADIUS
 *
 * Задаються в .env.local / Vercel Project → Settings → Environment Variables.
 * Не додавай CRON_SECRET у env клієнта.
 */
const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/manifest.webmanifest",
        headers: [
          {
            key: "Content-Type",
            value: "application/manifest+json; charset=utf-8",
          },
        ],
      },
      {
        source: "/levadius.webmanifest",
        headers: [
          {
            key: "Content-Type",
            value: "application/manifest+json; charset=utf-8",
          },
        ],
      },
      {
        source: "/sw.js",
        headers: [
          {
            key: "Content-Type",
            value: "application/javascript; charset=utf-8",
          },
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
          {
            key: "Service-Worker-Allowed",
            value: "/",
          },
        ],
      },
      {
        source: "/apple-touch-icon.png",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=86400",
          },
        ],
      },
    ];
  },
};

export default nextConfig;

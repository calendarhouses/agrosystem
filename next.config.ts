import type { NextConfig } from "next";

/**
 * Секрети (не NEXT_PUBLIC_* — лише сервер):
 * - CRON_SECRET — Bearer для /api/cron/* (Vercel Cron: fuel + equipment-day)
 * - WIALON_API_TOKEN — Wialon Hosting token
 * - SUPABASE_SERVICE_ROLE_KEY — upsert логів палива / денної статистики
 *
 * Задаються в .env.local / Vercel Project → Settings → Environment Variables.
 * Не додавай CRON_SECRET у env клієнта.
 */
const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;

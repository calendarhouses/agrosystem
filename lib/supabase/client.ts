import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

let browserClient: SupabaseClient | null = null;

/**
 * Браузерний клієнт з cookie-сесією (Auth + Realtime під authenticated).
 * Singleton — один WebSocket на вкладку, без дубльованих Realtime-каналів.
 * Для service-role серверних операцій лишається createServiceSupabase().
 */
export function createBrowserSupabase(): SupabaseClient {
  if (browserClient) return browserClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error("Немає NEXT_PUBLIC_SUPABASE_URL / ANON_KEY");
  }

  browserClient = createBrowserClient(url, anonKey);
  return browserClient;
}

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { createSupabaseResilientFetch } from "@/lib/supabase/resilient-fetch";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  console.warn("[supabase] Відсутні NEXT_PUBLIC_SUPABASE_URL / ANON_KEY");
}

let browserClient: SupabaseClient | null = null;

/** Браузерний клієнт Supabase (singleton — без дублікатів GoTrue) */
export function createBrowserSupabase() {
  if (browserClient) return browserClient;

  const key = anonKey ?? "";
  browserClient = createClient(url ?? "", key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    global: {
      fetch: createSupabaseResilientFetch(key),
    },
  });

  return browserClient;
}

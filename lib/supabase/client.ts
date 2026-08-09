import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  console.warn("[supabase] Відсутні NEXT_PUBLIC_SUPABASE_URL / ANON_KEY");
}

let browserClient: SupabaseClient | null = null;

/** Браузерний клієнт Supabase (singleton — без дублікатів GoTrue) */
export function createBrowserSupabase() {
  if (browserClient) return browserClient;

  browserClient = createClient(url ?? "", anonKey ?? "", {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return browserClient;
}

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  console.warn("[supabase] Відсутні NEXT_PUBLIC_SUPABASE_URL / ANON_KEY");
}

/** Браузерний клієнт Supabase */
export function createBrowserSupabase() {
  return createClient(
    url ?? "",
    anonKey ?? "",
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    }
  );
}

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { createSupabaseResilientFetch } from "@/lib/supabase/resilient-fetch";

/** Серверний клієнт з service role / secret key (API routes, RSC) */
export function createServiceSupabase(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error("Немає credentials Supabase");
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    global: {
      fetch: createSupabaseResilientFetch(key),
    },
  });
}

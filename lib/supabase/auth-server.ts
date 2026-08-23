import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Серверний клієнт із cookie-сесією користувача.
 * Тільки для Server Actions / Route Handlers / RSC — НЕ імпортувати в client components.
 */
export async function createAuthServerSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error("Немає NEXT_PUBLIC_SUPABASE_URL / ANON_KEY");
  }

  const cookieStore = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          /* Server Component — set ігноруємо; proxy оновить cookies */
        }
      },
    },
  });
}

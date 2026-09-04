import { type NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/middleware";

/**
 * Next.js 16: `middleware.ts` перейменовано на `proxy.ts`.
 * Логіка та сама — захист усіх роутів, крім /login і auth callback.
 */
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Усі шляхи крім static assets і image optimizer.
     */
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|levadius.webmanifest|sw.js|icon|apple-icon|apple-touch-icon|.*\\.(?:svg|png|jpg|jpeg|gif|webp|js|webmanifest)$).*)",
  ],
};

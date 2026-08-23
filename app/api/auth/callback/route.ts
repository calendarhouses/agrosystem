import { NextResponse } from "next/server";

import { createAuthServerSupabase } from "@/lib/supabase/auth-server";

/**
 * OAuth / magic-link callback (PKCE).
 * Email+password логін зазвичай не потребує цього роуту,
 * але proxy дозволяє /api/auth/callback як публічний.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  if (code) {
    const supabase = await createAuthServerSupabase();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback`);
}

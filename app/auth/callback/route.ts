import { NextResponse, type NextRequest } from "next/server";
import { afterGoogleSignIn } from "@/lib/auth/after-google";
import { safeNext } from "@/lib/auth/safe-next";
import { originFor } from "@/lib/auth/site-url";
import { createClient } from "@/lib/supabase/server";

// Supabase sends users here from Google (when Google sign-in is not set up to return to /auth/google).
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const origin = originFor(request.headers); // the tunnel's or live address, never the dev server's own
  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("next"));

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error && data.user) return afterGoogleSignIn(supabase, data.user, origin, next, searchParams.get("vs"));
  }
  return NextResponse.redirect(`${origin}/login?error=callback`);
}

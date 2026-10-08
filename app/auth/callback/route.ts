import { NextResponse, type NextRequest } from "next/server";
import { allowGoogleSignIn, ensureAccount } from "@/lib/account";
import { safeNext } from "@/lib/auth/safe-next";
import { hasReturn, RETURN_COOKIE, returnCookieOptions } from "@/lib/auth/return-path";
import { siteUrl } from "@/lib/auth/site-url";
import { createClient } from "@/lib/supabase/server";

// Supabase sends users here from Google.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("next"));

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error && data.user) {
      if (!(await allowGoogleSignIn(data.user))) {
        await supabase.auth.signOut();
        const email = encodeURIComponent(data.user.email ?? "");
        return NextResponse.redirect(`${origin}/login?error=use_password&email=${email}`);
      }
      await ensureAccount(data.user);
      const response = NextResponse.redirect(`${origin}${next}`);
      if (hasReturn(next)) response.cookies.set(RETURN_COOKIE, next, returnCookieOptions(siteUrl().startsWith("https://")));
      return response;
    }
  }
  return NextResponse.redirect(`${origin}/login?error=callback`);
}

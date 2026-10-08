import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { ensureAccount } from "@/lib/account";
import { safeNext } from "@/lib/auth/safe-next";
import { hasReturn, RETURN_COOKIE, returnCookieOptions } from "@/lib/auth/return-path";
import { siteUrl } from "@/lib/auth/site-url";
import { createClient } from "@/lib/supabase/server";

const TYPES: EmailOtpType[] = ["signup", "email", "recovery", "email_change"];

// Supabase email links (sign-up confirmation, password reset, email change) land here.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = safeNext(searchParams.get("next"));

  if (tokenHash && type && TYPES.includes(type)) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) {
      if (type === "recovery") return NextResponse.redirect(`${origin}/reset-password`);
      if ((type === "signup" || type === "email") && data.user) await ensureAccount(data.user);
      const response = NextResponse.redirect(`${origin}${next}`);
      if (hasReturn(next)) response.cookies.set(RETURN_COOKIE, next, returnCookieOptions(siteUrl().startsWith("https://")));
      return response;
    }
  }
  return NextResponse.redirect(`${origin}/login?error=confirm`);
}

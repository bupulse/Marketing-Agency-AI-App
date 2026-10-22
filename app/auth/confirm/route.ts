import type { EmailOtpType, User } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { ensureAccount } from "@/lib/account";
import { confirmedNext } from "@/lib/auth/confirm-next";
import { cleanReturn, hasReturn, RETURN_COOKIE, returnCookieOptions } from "@/lib/auth/return-path";
import { originFor } from "@/lib/auth/site-url";
import { createClient } from "@/lib/supabase/server";

const TYPES: EmailOtpType[] = ["signup", "email", "recovery", "email_change"];

/**
 * Supabase email links (sign-up confirmation, password reset, email change) land here, in one of two shapes:
 * - `token_hash` + `type`: our branded templates (supabase/templates). Works in any browser.
 * - `code`: Supabase's own templates link to its /verify, which confirms the address and comes back with a PKCE code.
 *   The code only works in the browser that started the sign-up; in another one the address is confirmed all the
 *   same, so the person is asked to sign in (or, for a password reset, to ask for a new code).
 * Supabase's own failures come back as `error` / `error_code` (otp_expired, access_denied): the "expired" screen.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const origin = originFor(request.headers);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const code = searchParams.get("code");
  const next = searchParams.get("next");
  const expired = () => NextResponse.redirect(`${origin}${type === "recovery" ? "/forgot-password?error=expired" : "/login?error=confirm"}`);

  async function signedIn(user: User | null, kind: EmailOtpType) {
    if (kind === "recovery") return NextResponse.redirect(`${origin}/reset-password`);
    if ((kind === "signup" || kind === "email") && user) await ensureAccount(user);
    const target = confirmedNext(user, next);
    const response = NextResponse.redirect(`${origin}${target}`);
    if (hasReturn(target)) response.cookies.set(RETURN_COOKIE, target, returnCookieOptions(origin.startsWith("https://")));
    return response;
  }

  if (searchParams.get("error") || searchParams.get("error_code")) return expired();

  if (tokenHash) {
    if (!type || !TYPES.includes(type)) return NextResponse.redirect(`${origin}/login?error=confirm`);
    const supabase = await createClient();
    const { data, error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    return error ? expired() : signedIn(data.user, type);
  }

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    // auth-js also says which flow made the code (a reset's verifier is stored as "…/recovery"), outside its types.
    const recovery = type === "recovery" || (data as { redirectType?: string | null } | null)?.redirectType === "recovery";
    if (!error && data.user) return signedIn(data.user, recovery ? "recovery" : type === "email_change" ? "email_change" : "signup");
    // Supabase hands out a code only after it confirmed the address. Opened in another browser (no PKCE verifier in
    // this one) or opened twice, the email is confirmed but this browser has no session: sign in, or ask for a new
    // reset code. Nothing from the link is shown or trusted.
    if (recovery) return NextResponse.redirect(`${origin}/forgot-password?error=other-browser`);
    const back = cleanReturn(next);
    return NextResponse.redirect(`${origin}/login?notice=confirmed${hasReturn(back) ? `&next=${encodeURIComponent(back)}` : ""}`);
  }

  return NextResponse.redirect(`${origin}/login?error=confirm`);
}

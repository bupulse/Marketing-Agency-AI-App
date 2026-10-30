import "server-only";
import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { allowGoogleSignIn, ensureAccount } from "@/lib/account";
import { hasReturn, RETURN_COOKIE, returnCookieOptions } from "./return-path";

type SignOut = { auth: { signOut: () => Promise<unknown> } };

/**
 * The steps after Google signed a person in, for both returns (/auth/callback from Supabase, /auth/google from Google):
 * an account created with a password is refused, otherwise the account is made or updated and the person goes on.
 */
export async function afterGoogleSignIn(supabase: SignOut, user: User, origin: string, next: string, visitSession: string | null) {
  if (!(await allowGoogleSignIn(user))) {
    await supabase.auth.signOut();
    const email = encodeURIComponent(user.email ?? "");
    return NextResponse.redirect(`${origin}/login?error=use_password&email=${email}`);
  }
  await ensureAccount(user, { visitSession });
  const response = NextResponse.redirect(`${origin}${next}`);
  if (hasReturn(next)) response.cookies.set(RETURN_COOKIE, next, returnCookieOptions(origin.startsWith("https://")));
  return response;
}

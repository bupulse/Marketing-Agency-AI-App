import "server-only";
import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { allowGoogleSignIn, ensureAccount } from "@/lib/account";
import { prisma } from "@/lib/db";
import { signupsClosed } from "@/lib/waitlist-server";
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
  // Before launch (the waiting list is on, lib/waitlist.ts) Google cannot create a new account: the person is signed out
  // and sees the waiting list. People who already have an account sign in as usual.
  if (await signupsClosed()) {
    const known = await prisma.user.findUnique({ where: { id: user.id }, select: { id: true } });
    if (!known) {
      await supabase.auth.signOut();
      return NextResponse.redirect(`${origin}/signup?waitlist=google`);
    }
  }
  await ensureAccount(user, { visitSession });
  const response = NextResponse.redirect(`${origin}${next}`);
  if (hasReturn(next)) response.cookies.set(RETURN_COOKIE, next, returnCookieOptions(origin.startsWith("https://")));
  return response;
}

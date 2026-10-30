import { NextResponse, type NextRequest } from "next/server";
import { afterGoogleSignIn } from "@/lib/auth/after-google";
import { GOOGLE_COOKIE, googleIdToken, readGoogleStart } from "@/lib/auth/google-signin";
import { originFor } from "@/lib/auth/site-url";
import { createClient } from "@/lib/supabase/server";

// Google sends people here after they choose an account (lib/auth/google-signin.ts). The state must match the cookie
// set when they pressed "Continue with Google", so a sign-in started elsewhere cannot be finished in this browser.
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const origin = originFor(request.headers);
  const start = readGoogleStart(request.cookies.get(GOOGLE_COOKIE)?.value);
  const done = (response: NextResponse) => {
    response.cookies.delete({ name: GOOGLE_COOKIE, path: "/auth/google" });
    return response;
  };
  const toLogin = (query = "?error=callback") => done(NextResponse.redirect(`${origin}/login${query}`));

  // "Cancel" on Google's page: back to sign-in without an error.
  if (searchParams.get("error") === "access_denied") return toLogin("");
  const code = searchParams.get("code");
  if (!start || !code || searchParams.get("state") !== start.state) return toLogin();

  const supabase = await createClient(); // also loads the keys saved in Admin -> Services
  const idToken = await googleIdToken(code, origin);
  if (!idToken) return toLogin();
  const { data, error } = await supabase.auth.signInWithIdToken({ provider: "google", token: idToken, nonce: start.nonce });
  if (error || !data.user) return toLogin();
  return done(await afterGoogleSignIn(supabase, data.user, origin, start.next, start.vs ?? null));
}

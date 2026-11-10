import "server-only";
import { createClient as createSupabaseClient, type User } from "@supabase/supabase-js";
import { logError } from "@/lib/errors";
import { RateLimitError } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// Signing in with an email address and the 6-digit authenticator code only, no emailed code (the owner, 10 November
// 2026: email is down). Used by the admin console and the support app while ADMIN_LOGIN_EMAIL_CODE is not "on".
//
// The server opens a session for the address itself (a sign-in link it makes and uses at once; nothing is emailed) in a
// throwaway client that keeps nothing, checks the authenticator code there, and only when it is right stores that
// session, already at AAL2, in the browser's cookies. A wrong code stores nothing and closes the session it opened, so
// the address alone never signs anyone in. An account with no authenticator set up cannot sign in this way.

export type AuthenticatorSignIn = { ok: true; user: User } | { ok: false; error?: string };

export async function signInWithAuthenticatorCode(opts: {
  email: string;
  code: string;
  /** Counts one attempt for this user; throws RateLimitError when there were too many. */
  limit: (userId: string) => Promise<void>;
  /** After the code is right and before the session is stored: true lets them in, a string refuses with that message. */
  allow?: (user: User) => Promise<true | string>;
  source: string;
}): Promise<AuthenticatorSignIn> {
  try {
    const { data: link, error: linkError } = await createAdminClient().auth.admin.generateLink({ type: "magiclink", email: opts.email });
    const tokenHash = link?.properties?.hashed_token;
    if (linkError || !tokenHash) return { ok: false };
    const temp = createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: opened, error: openError } = await temp.auth.verifyOtp({ token_hash: tokenHash, type: "email" });
    if (openError || !opened.user) return { ok: false };
    const user = opened.user;
    const refuse = async (error?: string): Promise<AuthenticatorSignIn> => {
      await temp.auth.signOut({ scope: "local" }).catch(() => undefined);
      return { ok: false, error };
    };
    try {
      await opts.limit(user.id);
    } catch (e) {
      if (e instanceof RateLimitError) return refuse("Too many attempts. Wait a few minutes and try again.");
      await refuse();
      throw e;
    }
    const { data: factors } = await temp.auth.mfa.listFactors();
    const factor = factors?.totp?.find((f) => f.status === "verified");
    if (!factor) return refuse();
    const verified = await temp.auth.mfa.challengeAndVerify({ factorId: factor.id, code: opts.code });
    const { data: session } = await temp.auth.getSession();
    if (verified.error || !session.session) return refuse();
    if (opts.allow) {
      const allowed = await opts.allow(user);
      if (allowed !== true) return refuse(allowed);
    }
    const supabase = await createClient();
    const { error: storeError } = await supabase.auth.setSession({ access_token: session.session.access_token, refresh_token: session.session.refresh_token });
    if (storeError) {
      await logError(storeError, { source: opts.source });
      return { ok: false };
    }
    return { ok: true, user };
  } catch (error) {
    await logError(error, { source: opts.source });
    return { ok: false };
  }
}

"use server";

import { redirect } from "next/navigation";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { loadServiceKeys } from "@/lib/admin/service-keys";
import { adminEmailCodeOn, canReceiveAdminCode, createOwnerSignIn, limitVerifyAttempts } from "@/lib/admin/auth";
import { emailSchema } from "@/lib/auth/schemas";
import { logError } from "@/lib/errors";
import { RateLimitError } from "@/lib/rate-limit";
import { padTo, publicLimited } from "@/lib/request-limits";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type AdminLoginState = { error?: string; sentTo?: string };

/**
 * Admin sign-in, step 1: the email. An emailed code is sent only to the owner (ADMIN_EMAILS) or an enabled staff member
 * (Admin -> Organisation), but every address gets the same answer, so the page does not reveal who has access. No
 * password, no Google. A failed send is logged (Admin -> Errors) and still gets that same answer; the owner's address
 * with no sign-in yet gets one first (createOwnerSignIn), so the owner can always get in.
 */
/** Every answer of the code steps takes at least this long, so the timing does not tell who has access. */
const ANSWER_MS = 1200;

export async function sendAdminCode(_prev: AdminLoginState, formData: FormData): Promise<AdminLoginState> {
  const started = Date.now();
  const result = await sendAdminCodeNow(formData);
  await padTo(started, ANSWER_MS);
  return result;
}

async function sendAdminCodeNow(formData: FormData): Promise<AdminLoginState> {
  const parsed = emailSchema.safeParse(String(formData.get("email") ?? ""));
  if (!parsed.success) return { error: "Enter your admin email." };
  const email = parsed.data.toLowerCase();
  const limited = await publicLimited("adminCode", email);
  if (limited) return { error: limited };
  if (await canReceiveAdminCode(email)) {
    const supabase = await createClient();
    const send = () => supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
    const tooSoon = (e: { status?: number; code?: string } | null) => e?.status === 429 || e?.code === "over_email_send_rate_limit";
    let { error } = await send();
    if (error && !tooSoon(error) && (await createOwnerSignIn(email))) ({ error } = await send());
    if (tooSoon(error)) return { error: "A code was sent very recently. Wait a minute, then try again." };
    if (error) await logError(error, { source: "admin.login.code", code: error.code, status: error.status });
  }
  return { sentTo: email };
}

/**
 * Sign-in while the emailed code is off (adminEmailCodeOn): the admin email and the authenticator code on one form. The
 * server opens a session for the address itself (a sign-in link it makes and uses at once, nothing is emailed) in a
 * throwaway client, checks the authenticator code there, and only then stores the session, already at AAL2, in the
 * browser's cookies. A wrong code stores nothing and closes that session, so the address alone never signs anyone in.
 * Every failure gets the same answer after the same time, so the form does not tell who has access.
 */
export async function signInWithAuthenticator(_prev: AdminLoginState, formData: FormData): Promise<AdminLoginState> {
  const started = Date.now();
  const ok = await signInWithAuthenticatorNow(formData);
  if (typeof ok === "string") {
    await padTo(started, ANSWER_MS);
    return { error: ok };
  }
  redirect("/admin");
}

const WRONG = "That did not work. Check the email and the latest code from your authenticator app.";

async function signInWithAuthenticatorNow(formData: FormData): Promise<true | string> {
  await loadServiceKeys();
  if (adminEmailCodeOn()) return "Sign in with the emailed code. Reload the page.";
  const parsed = emailSchema.safeParse(String(formData.get("email") ?? ""));
  if (!parsed.success) return "Enter your admin email.";
  const email = parsed.data.toLowerCase();
  const code = String(formData.get("code") ?? "").trim();
  if (!/^\d{6}$/.test(code)) return "Enter the 6-digit code from your authenticator app.";
  const limited = await publicLimited("adminVerify", email);
  if (limited) return limited;
  if (!(await canReceiveAdminCode(email))) return WRONG;
  try {
    const { data: link, error: linkError } = await createAdminClient().auth.admin.generateLink({ type: "magiclink", email });
    const tokenHash = link?.properties?.hashed_token;
    if (linkError || !tokenHash) return WRONG;
    const temp = createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: opened, error: openError } = await temp.auth.verifyOtp({ token_hash: tokenHash, type: "email" });
    if (openError || !opened.user) return WRONG;
    const close = () => temp.auth.signOut({ scope: "local" }).catch(() => undefined);
    try {
      await limitVerifyAttempts(opened.user.id);
    } catch (e) {
      await close();
      if (e instanceof RateLimitError) return "Too many attempts. Wait a few minutes and try again.";
      throw e;
    }
    const { data: factors } = await temp.auth.mfa.listFactors();
    const factor = factors?.totp?.find((f) => f.status === "verified");
    const verified = factor ? await temp.auth.mfa.challengeAndVerify({ factorId: factor.id, code }) : null;
    const { data: session } = await temp.auth.getSession();
    if (!factor || !verified || verified.error || !session.session) {
      await close();
      return WRONG;
    }
    const supabase = await createClient();
    const { error: storeError } = await supabase.auth.setSession({ access_token: session.session.access_token, refresh_token: session.session.refresh_token });
    if (storeError) {
      await logError(storeError, { source: "admin.login.authenticator" });
      return WRONG;
    }
    return true;
  } catch (error) {
    await logError(error, { source: "admin.login.authenticator" });
    return WRONG;
  }
}

/** Step 2: the emailed code. Step 3 (/admin/verify) is the authenticator code, which requireAdmin sends the admin to. */
export async function verifyAdminCode(_prev: AdminLoginState, formData: FormData): Promise<AdminLoginState> {
  const started = Date.now();
  const email = String(formData.get("email") ?? "").toLowerCase();
  const token = String(formData.get("code") ?? "").trim();
  if (!/^\d{6,10}$/.test(token)) return { sentTo: email, error: "Enter the code from the email." };
  const limited = await publicLimited("adminVerify", email);
  if (limited) return { sentTo: email, error: limited };
  const wrong = { sentTo: email, error: "That code did not work. Check the latest email, or send a new one." };
  let ok = false;
  if (await canReceiveAdminCode(email)) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.verifyOtp({ email, token, type: "email" });
    ok = !error && !!data.user;
  }
  if (!ok) {
    // A stranger's "wrong" and an admin's wrong code take the same time.
    await padTo(started, ANSWER_MS);
    return wrong;
  }
  redirect("/admin");
}

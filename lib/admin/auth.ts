import "server-only";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { rateLimit, type RateLimitRule } from "@/lib/rate-limit";

/** Six-digit code attempts: 8 per 10 minutes per admin. */
export const ADMIN_VERIFY_RULE: RateLimitRule = { limit: 8, windowSeconds: 10 * 60 };

/** Addresses allowed into the console: ADMIN_EMAILS, comma-separated, case-insensitive. */
export function adminEmails(env: string | undefined = process.env.ADMIN_EMAILS): string[] {
  return (env ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminEmail(email: string | null | undefined): boolean {
  return !!email && adminEmails().includes(email.trim().toLowerCase());
}

export type AdminIdentity = { id: string; email: string };

/**
 * The signed-in admin before the second step. Anyone else gets a 404 so the console's existence is
 * not revealed. Used only by /admin/verify and /admin/setup-2fa; everything else uses requireAdmin.
 */
export async function requireAdminIdentity(): Promise<AdminIdentity & { supabase: Awaited<ReturnType<typeof createClient>> }> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  const user = data?.user;
  if (error || !user || !user.email_confirmed_at || !isAdminEmail(user.email)) notFound();
  return { id: user.id, email: user.email!.toLowerCase(), supabase };
}

/**
 * Gate for every admin page and every admin server action (call it again inside each action, not just
 * the layout). Needs an allow-listed, verified email and an AAL2 session (authenticator code entered).
 * Non-admins get a 404; an admin below AAL2 is sent to enter a code, or to enrol an app first.
 */
export const requireAdmin = cache(async (): Promise<AdminIdentity> => {
  const { id, email, supabase } = await requireAdminIdentity();
  const { data: aal, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error || !aal) redirect("/admin/verify");
  if (aal.currentLevel !== "aal2") {
    redirect(aal.nextLevel === "aal2" ? "/admin/verify" : "/admin/setup-2fa");
  }
  // AAL2 can only come from a verified factor; check it is a TOTP one rather than assuming.
  const { data: factors } = await supabase.auth.mfa.listFactors();
  if (!factors?.totp?.some((f) => f.status === "verified")) redirect("/admin/setup-2fa");
  return { id, email };
});

/** Counts one code attempt; throws RateLimitError when the admin tries too often. */
export async function limitVerifyAttempts(adminId: string) {
  await rateLimit(`admin-verify:${adminId}`, ADMIN_VERIFY_RULE);
}

/** Emailed-code attempts while enrolling: 3 sends and 8 tries per 10 minutes. */
export const ADMIN_ENROLL_SEND_RULE: RateLimitRule = { limit: 3, windowSeconds: 10 * 60 };
export const ADMIN_ENROLL_TRY_RULE: RateLimitRule = { limit: 8, windowSeconds: 10 * 60 };
export async function limitEnrollSends(adminId: string) {
  await rateLimit(`admin-enroll-send:${adminId}`, ADMIN_ENROLL_SEND_RULE);
}
export async function limitEnrollTries(adminId: string) {
  await rateLimit(`admin-enroll-try:${adminId}`, ADMIN_ENROLL_TRY_RULE);
}

export const ENROLL_PROOF_MS = 10 * 60 * 1000;
/** A setup that another session started less than this long ago is not replaced. */
export const ENROLL_GRACE_MS = 15 * 60 * 1000;

/**
 * True when this session signed in with an emailed one-time code in the last 10 minutes
 * (Supabase records it in the session's authentication methods). Enrolling an authenticator needs it,
 * so a password alone cannot add one.
 */
export function hasRecentEmailProof(methods: unknown, now = Date.now()): boolean {
  if (!Array.isArray(methods)) return false;
  return methods.some((m) => {
    if (typeof m !== "object" || m === null) return false;
    const { method, timestamp } = m as { method?: string; timestamp?: number };
    return (method === "otp" || method === "email" || method === "magiclink") && typeof timestamp === "number" && now - timestamp * 1000 < ENROLL_PROOF_MS;
  });
}

/** The id inside the access token, to tell this browser session from another one. Not used for trust. */
export async function currentSessionId(supabase: Awaited<ReturnType<typeof createClient>>): Promise<string> {
  const { data } = await supabase.auth.getSession();
  try {
    const payload = JSON.parse(Buffer.from(data.session?.access_token.split(".")[1] ?? "", "base64url").toString());
    return String(payload.session_id ?? "");
  } catch {
    return "";
  }
}

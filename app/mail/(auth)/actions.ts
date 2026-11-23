"use server";

import { redirect } from "next/navigation";
import { hasRecentMailboxProof } from "@/lib/support/app-access";
import { hasSetupGrant } from "@/lib/support/setup-grant";
import { rateLimit, RateLimitError } from "@/lib/rate-limit";
import { requireMailIdentity } from "@/lib/mail/session";

// The B Mail authenticator steps. Server actions are public POST endpoints: each one checks the person again.

export type CodeState = { error?: string };
export type EnrollState = { factorId?: string; qr?: string; secret?: string; error?: string; needEmail?: boolean };

const CODE_RULE = { limit: 8, windowSeconds: 10 * 60 };
const tooMany = "Too many tries. Wait a few minutes and try again.";
const sixDigits = (v: FormDataEntryValue | null) => String(v ?? "").replace(/\s+/g, "");

export async function verifyMailCode(_prev: CodeState, formData: FormData): Promise<CodeState> {
  const { supabase, user } = await requireMailIdentity();
  const code = sixDigits(formData.get("code"));
  if (!/^\d{6}$/.test(code)) return { error: "Enter the 6 digits from your authenticator app." };
  try {
    await rateLimit(`mail-verify:${user.id}`, CODE_RULE);
  } catch (e) {
    if (e instanceof RateLimitError) return { error: tooMany };
    throw e;
  }
  const { data: factors } = await supabase.auth.mfa.listFactors();
  const factor = factors?.totp?.find((f) => f.status === "verified");
  if (!factor) redirect("/mail/setup");
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
  if (error) return { error: "That code did not match. Try the next code from your app." };
  redirect("/mail");
}

/**
 * Adding the first authenticator needs a fresh proof of the mailbox (a sign-in link or emailed code in the last 10
 * minutes) or the one-time permission the admin gives when creating the account, so a stolen password alone cannot add one.
 */
export async function startMailEnrollment(): Promise<EnrollState> {
  const { supabase, user, methods, hasTotp } = await requireMailIdentity();
  if (hasTotp) redirect("/mail/verify");
  if (!hasRecentMailboxProof(methods) && !hasSetupGrant(user.app_metadata)) return { needEmail: true };
  const { data: factors } = await supabase.auth.mfa.listFactors();
  for (const f of factors?.all ?? []) if (f.status === "unverified") await supabase.auth.mfa.unenroll({ factorId: f.id });
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", issuer: "BuPulse", friendlyName: `B Mail ${Date.now().toString(36)}` });
  if (error || !data) return { error: "Could not start. Please try again." };
  return { factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret };
}

export async function confirmMailEnrollment(_prev: CodeState, formData: FormData): Promise<CodeState> {
  const { supabase, user } = await requireMailIdentity();
  const code = sixDigits(formData.get("code"));
  const factorId = String(formData.get("factorId") ?? "");
  if (!/^\d{6}$/.test(code)) return { error: "Enter the 6 digits from your authenticator app." };
  try {
    await rateLimit(`mail-verify:${user.id}`, CODE_RULE);
  } catch (e) {
    if (e instanceof RateLimitError) return { error: tooMany };
    throw e;
  }
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
  if (error) return { error: "That code did not match. Check your phone's clock and try the next code." };
  redirect("/mail");
}

/** Sends a sign-in code to the person's address (the mailbox proof), then they come back to set up. */
export async function sendMailProof(): Promise<CodeState> {
  const { supabase, email, user } = await requireMailIdentity();
  try {
    await rateLimit(`mail-proof:${user.id}`, { limit: 3, windowSeconds: 10 * 60 });
  } catch (e) {
    if (e instanceof RateLimitError) return { error: tooMany };
    throw e;
  }
  const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
  return error ? { error: "Could not send the code. Try again in a minute." } : {};
}

export async function confirmMailProof(_prev: CodeState, formData: FormData): Promise<CodeState> {
  const { supabase, email, user } = await requireMailIdentity();
  const token = String(formData.get("code") ?? "").trim();
  if (!/^\d{6,10}$/.test(token)) return { error: "Enter the code from the email." };
  try {
    await rateLimit(`mail-verify:${user.id}`, CODE_RULE);
  } catch (e) {
    if (e instanceof RateLimitError) return { error: tooMany };
    throw e;
  }
  const { data, error } = await supabase.auth.verifyOtp({ email, token, type: "email" });
  if (error || data.user?.id !== user.id) return { error: "That code did not work. Check the latest email or send a new one." };
  redirect("/mail/setup");
}

/**
 * Signing in to B Mail with the address and the authenticator code only (as the admin console and the support app do,
 * lib/auth/authenticator-sign-in.ts): no password, no emailed code. Only for people allowed into Mail who already have
 * an authenticator; the session lands at AAL2 straight away.
 */
export async function signInMailWithCode(_prev: CodeState, formData: FormData): Promise<CodeState> {
  const { signInWithAuthenticatorCode } = await import("@/lib/auth/authenticator-sign-in");
  const { isAdminEmail } = await import("@/lib/admin/auth");
  const { prisma } = await import("@/lib/db");
  const { canUseMail } = await import("@/lib/mail/access-rules");
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const code = sixDigits(formData.get("code"));
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^\d{6}$/.test(code)) return { error: "Enter your email address and the 6 digits from your authenticator app." };
  const allowed = async () => {
    const member = await prisma.mailMember.findUnique({ where: { email }, select: { id: true, role: true, departmentId: true, status: true, mail: true } });
    return canUseMail({ isOwner: isAdminEmail(email), member, grants: [] });
  };
  if (!(await allowed())) return { error: "That address or code did not work." };
  try {
    const r = await signInWithAuthenticatorCode({
      email, code, source: "mail.sign-in",
      limit: (userId) => rateLimit(`mail-verify:${userId}`, CODE_RULE),
      allow: async () => ((await allowed()) ? true : "That address or code did not work."),
    });
    if (!r.ok) return { error: r.error ?? "That address or code did not work." };
  } catch (e) {
    if (e instanceof RateLimitError) return { error: tooMany };
    throw e;
  }
  redirect("/mail");
}

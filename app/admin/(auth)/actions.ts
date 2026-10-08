"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import {
  currentSessionId,
  ENROLL_GRACE_MS,
  hasRecentEmailProof,
  limitEnrollSends,
  limitEnrollTries,
  limitVerifyAttempts,
  requireAdminIdentity,
} from "@/lib/admin/auth";
import { RateLimitError } from "@/lib/rate-limit";

export type EnrollState = { error?: string; needEmail?: boolean; factorId?: string; qr?: string; secret?: string };
export type CodeState = { error?: string };

const codeSchema = z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code from your authenticator app.");

async function checkCode(adminId: string, raw: FormDataEntryValue | null): Promise<string | { error: string }> {
  const parsed = codeSchema.safeParse(String(raw ?? ""));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  try {
    await limitVerifyAttempts(adminId);
  } catch (e) {
    if (e instanceof RateLimitError) return { error: "Too many attempts. Wait a few minutes and try again." };
    throw e;
  }
  return parsed.data;
}

const tooMany = "Too many attempts. Wait a few minutes and try again.";

/** Step 1 of setup: email a one-time code, so a password alone cannot add an authenticator. */
export async function sendEnrollCode(): Promise<CodeState> {
  const { id, email, supabase } = await requireAdminIdentity();
  const { data: factors } = await supabase.auth.mfa.listFactors();
  if (factors?.totp?.some((f) => f.status === "verified")) redirect("/admin/verify");
  try {
    await limitEnrollSends(id);
  } catch (e) {
    if (e instanceof RateLimitError) return { error: tooMany };
    throw e;
  }
  const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
  if (error) return { error: "Could not send the code. Please try again in a minute." };
  return {};
}

/** Step 2: the emailed code. Success gives this session a fresh email sign-in, which startEnrollment checks. */
export async function confirmEnrollCode(_prev: CodeState, formData: FormData): Promise<CodeState> {
  const { id, email, supabase } = await requireAdminIdentity();
  const token = String(formData.get("code") ?? "").trim();
  if (!/^\d{6,10}$/.test(token)) return { error: "Enter the code from the email." };
  try {
    await limitEnrollTries(id);
  } catch (e) {
    if (e instanceof RateLimitError) return { error: tooMany };
    throw e;
  }
  const { data, error } = await supabase.auth.verifyOtp({ email, token, type: "email" });
  // The code must belong to this admin; anything else is refused and signed out of.
  if (error || data.user?.id !== id) return { error: "That code did not work. Check the latest email, or send a new one." };
  redirect("/admin/setup-2fa");
}

/** Starts enrolling an authenticator app. Needs a recent emailed-code sign-in and no verified factor yet. */
export async function startEnrollment(): Promise<EnrollState> {
  const { supabase } = await requireAdminIdentity();
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (!hasRecentEmailProof(aal?.currentAuthenticationMethods)) {
    return { needEmail: true, error: "Confirm your email first." };
  }
  const { data: factors } = await supabase.auth.mfa.listFactors();
  if (factors?.totp?.some((f) => f.status === "verified")) redirect("/admin/verify");
  const session = (await currentSessionId(supabase)).slice(0, 8);
  const mark = session || "nosession";
  for (const f of factors?.all ?? []) {
    if (f.status !== "unverified") continue;
    const mine = f.friendly_name?.endsWith(mark);
    const ageMs = Date.now() - new Date(f.created_at).getTime();
    // Another session's setup is not deleted while it is fresh: the owner may be scanning it right now.
    if (!mine && ageMs < ENROLL_GRACE_MS) {
      const mins = Math.max(1, Math.ceil((ENROLL_GRACE_MS - ageMs) / 60000));
      return { error: `Setup is already in progress in another window. Finish it there, or wait about ${mins} minute${mins === 1 ? "" : "s"}.` };
    }
    await supabase.auth.mfa.unenroll({ factorId: f.id });
  }
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", issuer: "BuPulse admin", friendlyName: `BuPulse admin ${mark}` });
  if (error || !data) {
    return {
      error:
        error?.code === "mfa_totp_enroll_not_enabled" || /not enabled|disabled/i.test(error?.message ?? "")
          ? "Authenticator-app sign-in is switched off for this project. Turn on TOTP in Supabase (Authentication, Multi-Factor)."
          : "Could not start setup. Please try again.",
    };
  }
  return { factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret };
}

export async function confirmEnrollment(_prev: CodeState, formData: FormData): Promise<CodeState> {
  const { id, supabase } = await requireAdminIdentity();
  const code = await checkCode(id, formData.get("code"));
  if (typeof code !== "string") return code;
  const factorId = String(formData.get("factorId") ?? "");
  const { data: factors } = await supabase.auth.mfa.listFactors();
  // Only a factor this admin owns and has not yet verified can be confirmed here.
  if (!factors?.all?.some((f) => f.id === factorId && f.status === "unverified")) {
    return { error: "This setup expired. Reload the page and start again." };
  }
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
  if (error) return { error: "That code did not match. Check your phone's clock and try the next code." };
  redirect("/admin");
}

export async function verifyCode(_prev: CodeState, formData: FormData): Promise<CodeState> {
  const { id, supabase } = await requireAdminIdentity();
  const code = await checkCode(id, formData.get("code"));
  if (typeof code !== "string") return code;
  const { data: factors } = await supabase.auth.mfa.listFactors();
  const factor = factors?.totp?.find((f) => f.status === "verified");
  if (!factor) redirect("/admin/setup-2fa");
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
  if (error) return { error: "That code did not match. Try the next code from your app." };
  redirect("/admin");
}

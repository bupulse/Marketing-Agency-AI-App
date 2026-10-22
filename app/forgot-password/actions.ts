"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { emailSchema } from "@/lib/auth/schemas";
import { cleanEmailCode, isCodeRefused } from "@/lib/auth/confirm-next";
import { headers } from "next/headers";
import { originFor } from "@/lib/auth/site-url";
import { logError } from "@/lib/errors";
import { padTo, publicLimited } from "@/lib/request-limits";

export type ForgotState = { error?: string; sent?: boolean; email?: string };
export type ResetCodeState = { error?: string };

export async function requestPasswordReset(_prev: ForgotState, formData: FormData): Promise<ForgotState> {
  const parsed = emailSchema.safeParse(formData.get("email") ?? "");
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  // The limit message does not depend on whether the address has an account.
  const limited = await publicLimited("forgotPassword", parsed.data);
  if (limited) return { error: limited };

  const supabase = await createClient();
  // Result is ignored on purpose: the screen is the same whether or not the address has an account.
  await supabase.auth.resetPasswordForEmail(parsed.data, {
    redirectTo: `${originFor(await headers())}/auth/confirm?type=recovery&next=/reset-password`,
  });
  return { sent: true, email: parsed.data };
}

/** Every wrong-code answer takes at least this long, whether or not the address has an account. */
const CODE_MIN_MS = 800;

/**
 * The reset code from the email instead of its link (the email read on a phone, the site open on a computer): a
 * recovery session, then /reset-password. Limited per address across every IP; every refusal reads and times the same.
 */
export async function verifyResetCode(_prev: ResetCodeState, formData: FormData): Promise<ResetCodeState> {
  const started = Date.now();
  const email = emailSchema.safeParse(formData.get("email") ?? "");
  const token = cleanEmailCode(formData.get("code"));
  if (!email.success) return { error: "Enter a valid email address." };
  if (!token) return { error: "Type the code from the email (6 to 10 digits)." };
  const limited = await publicLimited("resetCode", email.data);
  if (limited) return { error: limited };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.verifyOtp({ email: email.data, token, type: "recovery" });
  if (error || !data.user) {
    if (error && !isCodeRefused(error)) await logError(error, { source: "forgot.code", code: error.code, status: error.status });
    await padTo(started, CODE_MIN_MS);
    if (error?.status === 429) return { error: "Too many attempts. Please wait a few minutes and try again." };
    return { error: "That code did not work. Use the code from the latest email, or open the link in it." };
  }
  redirect("/reset-password");
}

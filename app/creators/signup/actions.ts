"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { findAccountByEmail } from "@/lib/account";
import { originFor } from "@/lib/auth/site-url";
import type { ApplicationErrors } from "@/lib/creators/application";
import { CREATOR_START, readCreatorSignUp } from "@/lib/creators/profile-form";
import { logError } from "@/lib/errors";
import { publicLimited, requestIp } from "@/lib/request-limits";
import { createClient } from "@/lib/supabase/server";
import { turnstileEnabled, verifyTurnstile } from "@/lib/widget/turnstile";

export type CreatorSignUpState = { status: "idle" | "sent" | "error"; email?: string; error?: string; errors?: ApplicationErrors; values?: Record<string, string> };

function friendly(error: { code?: string; status?: number; message?: string }): string {
  if (error.code === "weak_password") return "That password is too easy to guess. Try a longer one with a mix of letters and numbers.";
  if (error.code === "email_address_invalid") return "That email address cannot be used. Try a different one.";
  if (error.code === "signup_disabled") return "Sign-ups are paused right now. Please try again later.";
  if (error.status === 429 || error.code === "over_email_send_rate_limit" || error.code === "over_request_rate_limit") return "Too many attempts. Please wait a few minutes and try again.";
  if (error.message?.toLowerCase().includes("sending")) return "We couldn't send your confirmation email right now. Please try again in a few minutes.";
  return "We could not create your account. Please try again.";
}

const signInUrl = (email: string) => `/login?notice=exists&email=${encodeURIComponent(email)}&next=${encodeURIComponent("/creator")}`;

/**
 * A creator's own sign-up (docs/CREATOR_MARKETPLACE.md, "Creator accounts"): Supabase sign-up with email confirmation
 * and `account_kind: "creator"` in the metadata, so ensureAccount (lib/account.ts) makes a creator profile and never a
 * Business. A known address is sent to sign in, like the company sign-up.
 */
export async function creatorSignUpAction(_prev: CreatorSignUpState, formData: FormData): Promise<CreatorSignUpState> {
  const values = { name: String(formData.get("name") ?? "").slice(0, 100), email: String(formData.get("email") ?? "").slice(0, 254), phone: String(formData.get("phone") ?? "").slice(0, 30) };
  // Bots fill in the hidden field; they get the same answer as a person, and nothing is made.
  if (String(formData.get("website") ?? "")) return { status: "sent", email: values.email };
  const read = readCreatorSignUp(formData);
  if (!read.ok) return { status: "error", errors: read.errors, values };
  const v = read.value;
  const ip = await requestIp();
  const limited = await publicLimited("signUp", v.email, ip);
  if (limited) return { status: "error", error: limited, values };
  if (turnstileEnabled() && !(await verifyTurnstile(String(formData.get("turnstileToken") ?? ""), ip))) {
    return { status: "error", error: "Please complete the security check and try again.", values };
  }
  if (await findAccountByEmail(v.email)) redirect(signInUrl(v.email));

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: v.email,
    password: v.password,
    options: {
      emailRedirectTo: `${originFor(await headers())}/auth/confirm?next=${encodeURIComponent(CREATOR_START)}`,
      // Read by ensureAccount once the email is confirmed.
      data: { account_kind: "creator", full_name: v.name, phone: v.phone },
    },
  });
  // An existing confirmed account comes back as a user with no identities (or user_already_exists).
  if (error?.code === "user_already_exists" || (!error && data.user && data.user.identities?.length === 0)) redirect(signInUrl(v.email));
  if (error) {
    await logError(error, { source: "creators.signup", code: error.code, status: error.status });
    return { status: "error", error: friendly(error), values };
  }
  return { status: "sent", email: v.email };
}

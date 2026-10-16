"use server";

import { redirect } from "next/navigation";
import { findAccountByEmail } from "@/lib/account";
import { refFromCookie } from "@/lib/sales/referral";
import { logError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import { emailSchema, fieldErrors, signUpSchema, type FieldErrors } from "@/lib/auth/schemas";
import { headers } from "next/headers";
import { originFor } from "@/lib/auth/site-url";
import { cleanReturn } from "@/lib/auth/return-path";
import { resolveIndustryChoice } from "@/lib/industries/server";
import { padTo, publicLimited, requestIp } from "@/lib/request-limits";
import { turnstileEnabled, verifyTurnstile } from "@/lib/widget/turnstile";

export type SignUpState =
  | { status: "idle" }
  | { status: "sent"; email: string }
  | { status: "error"; message?: string; fieldErrors?: FieldErrors };

type AuthErrorLike = { code?: string; status?: number; message?: string };

function friendlySignUpError(error: AuthErrorLike): string {
  switch (error.code) {
    case "weak_password":
      return "That password is too easy to guess. Try a longer one with a mix of letters and numbers.";
    case "over_email_send_rate_limit":
    case "over_request_rate_limit":
      return "Too many attempts. Please wait a few minutes and try again.";
    case "email_address_invalid":
      return "That email address cannot be used. Try a different one.";
    case "signup_disabled":
      return "Sign-ups are paused right now. Please try again later.";
    default:
      if (error.message?.toLowerCase().includes("sending")) {
        return "We couldn't send your confirmation email right now. Please try again in a few minutes.";
      }
      return error.status === 429
        ? "Too many attempts. Please wait a few minutes and try again."
        : "We could not create your account. Please try again.";
  }
}

function withNext(url: string, next: string) {
  return next === "/dashboard" ? url : `${url}&next=${encodeURIComponent(next)}`;
}

function signInUrl(email: string, google = false) {
  return `/login?notice=${google ? "exists-google" : "exists"}&email=${encodeURIComponent(email)}`;
}

/** Every checkEmail answer takes at least this long, so a known address is not told apart by timing. */
const CHECK_EMAIL_MIN_MS = 400;

// Step 1 of /signup: the owner asked that a known address goes straight to sign in.
// Accounts appear in our User table once their email is confirmed (or via Google).
// This tells a caller whether an address has an account, so it is limited hard (per IP and per address) and padded to
// a fixed time. Over the limit it answers "not registered": the form goes on, and signUp still sends a known address
// to sign in, so a person loses nothing and a script learns nothing.
export async function checkEmail(email: string): Promise<{ registered: boolean; signInUrl?: string }> {
  const started = Date.now();
  try {
    const parsed = emailSchema.safeParse(email);
    if (!parsed.success) return { registered: false };
    if (await publicLimited("checkEmail", parsed.data)) return { registered: false };
    const account = await findAccountByEmail(parsed.data);
    if (!account) return { registered: false };
    return { registered: true, signInUrl: signInUrl(parsed.data, account.method === "GOOGLE") };
  } finally {
    await padTo(started, CHECK_EMAIL_MIN_MS);
  }
}

const BOT_CHECK_FAILED = "Please complete the security check and try again.";

export async function signUp(_prev: SignUpState, formData: FormData): Promise<SignUpState> {
  const parsed = signUpSchema.safeParse({
    email: formData.get("email") ?? "",
    organisationName: formData.get("organisationName") ?? "",
    ceoName: formData.get("ceoName") ?? "",
    industry: formData.get("industry") ?? "",
    industryOther: formData.get("industryOther") ?? "",
    industryDescription: formData.get("industryDescription") ?? "",
    country: formData.get("country") ?? "",
    phone: formData.get("phone") ?? "",
    website: formData.get("website") ?? "",
    password: formData.get("password") ?? "",
    confirmPassword: formData.get("confirmPassword") ?? "",
    terms: formData.get("terms") === "true",
  });
  if (!parsed.success) return { status: "error", fieldErrors: fieldErrors(parsed.error) };
  const v = parsed.data;
  const ip = await requestIp();
  const limited = await publicLimited("signUp", v.email, ip);
  if (limited) return { status: "error", message: limited };
  // Cloudflare Turnstile when its keys are set (TURNSTILE_SITE_KEY / TURNSTILE_SECRET_KEY); without them the limits above apply alone.
  if (turnstileEnabled() && !(await verifyTurnstile(String(formData.get("turnstileToken") ?? ""), ip))) {
    return { status: "error", message: BOT_CHECK_FAILED };
  }
  // The sector must be one the admin offers today (the list is data, not a constant).
  const sector = await resolveIndustryChoice(v);
  if (!sector) return { status: "error", fieldErrors: { industry: "Choose your business sector from the list." } };
  const next = cleanReturn(String(formData.get("next") ?? ""));

  const existing = await findAccountByEmail(v.email);
  if (existing) redirect(withNext(signInUrl(v.email, existing.method === "GOOGLE"), next));

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: v.email,
    password: v.password,
    options: {
      emailRedirectTo: `${originFor(await headers())}/auth/confirm?next=${encodeURIComponent(next)}`,
      data: {
        organisation_name: v.organisationName,
        ceo_name: v.ceoName,
        // Read by lib/account.ts ensureAccount once the email is confirmed. `industry` keeps the legacy label.
        industry: sector.industry,
        industry_slug: sector.industryId ? v.industry : "",
        industry_other: sector.industryOther ?? "",
        industry_description: sector.industryDescription,
        country: v.country,
        phone: v.phone ?? "",
        website: v.website ?? "",
        visit_session: String(formData.get("visitSession") ?? "").slice(0, 40),
        // A sales agent's referral code from the cookie, so a confirmation opened on another device still counts.
        ref_code: (await refFromCookie()) ?? "",
      },
    },
  });

  // An existing confirmed account comes back as a user with no identities (or user_already_exists).
  if (error?.code === "user_already_exists" || (!error && data.user && data.user.identities?.length === 0)) {
    redirect(withNext(signInUrl(v.email), next));
  }
  if (error) {
    await logError(error, { source: "signup", code: error.code, status: error.status });
    return { status: "error", message: friendlySignUpError(error) };
  }
  return { status: "sent", email: v.email };
}

export type ResendResult = { error?: string; retrySeconds?: number };

export async function resendConfirmation(email: string, next?: string): Promise<ResendResult> {
  const parsed = emailSchema.safeParse(email);
  if (!parsed.success) return { error: "Enter a valid email address." };
  const limited = await publicLimited("resendConfirmation", parsed.data);
  if (limited) return { error: limited, retrySeconds: 60 };

  const supabase = await createClient();
  const { error } = await supabase.auth.resend({
    type: "signup",
    email: parsed.data,
    options: { emailRedirectTo: `${originFor(await headers())}/auth/confirm?next=${encodeURIComponent(cleanReturn(next))}` },
  });
  if (error) {
    await logError(error, { source: "signup.resend", code: error.code, status: error.status });
    if (error.code === "over_email_send_rate_limit" || error.status === 429) {
      return { error: "Please wait a minute before asking for another email.", retrySeconds: 60 };
    }
    return { error: "We could not send the email. Please try again." };
  }
  return {};
}

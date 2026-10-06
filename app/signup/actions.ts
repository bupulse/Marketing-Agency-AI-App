"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import { emailSchema, fieldErrors, signUpSchema, type FieldErrors } from "@/lib/auth/schemas";
import { siteUrl } from "@/lib/auth/site-url";

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

function signInUrl(email: string) {
  return `/login?notice=exists&email=${encodeURIComponent(email)}`;
}

// Accounts appear in our User table once their email is confirmed (or via Google).
async function isRegistered(email: string) {
  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: { id: true },
  });
  return user !== null;
}

// Step 1 of /signup: the owner asked that a known address goes straight to sign in.
export async function checkEmail(email: string): Promise<{ registered: boolean }> {
  const parsed = emailSchema.safeParse(email);
  if (!parsed.success) return { registered: false };
  return { registered: await isRegistered(parsed.data) };
}

export async function signUp(_prev: SignUpState, formData: FormData): Promise<SignUpState> {
  const parsed = signUpSchema.safeParse({
    email: formData.get("email") ?? "",
    organisationName: formData.get("organisationName") ?? "",
    ceoName: formData.get("ceoName") ?? "",
    industry: formData.get("industry") ?? "",
    country: formData.get("country") ?? "",
    phone: formData.get("phone") ?? "",
    website: formData.get("website") ?? "",
    password: formData.get("password") ?? "",
    confirmPassword: formData.get("confirmPassword") ?? "",
    terms: formData.get("terms") === "true",
  });
  if (!parsed.success) return { status: "error", fieldErrors: fieldErrors(parsed.error) };
  const v = parsed.data;

  if (await isRegistered(v.email)) redirect(signInUrl(v.email));

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: v.email,
    password: v.password,
    options: {
      emailRedirectTo: `${siteUrl()}/auth/confirm?next=/dashboard`,
      data: {
        organisation_name: v.organisationName,
        ceo_name: v.ceoName,
        industry: v.industry,
        country: v.country,
        phone: v.phone ?? "",
        website: v.website ?? "",
      },
    },
  });

  // An existing confirmed account comes back as a user with no identities (or user_already_exists).
  if (error?.code === "user_already_exists" || (!error && data.user && data.user.identities?.length === 0)) {
    redirect(signInUrl(v.email));
  }
  if (error) {
    await logError(error, { source: "signup", code: error.code, status: error.status });
    return { status: "error", message: friendlySignUpError(error) };
  }
  return { status: "sent", email: v.email };
}

export type ResendResult = { error?: string; retrySeconds?: number };

export async function resendConfirmation(email: string): Promise<ResendResult> {
  const parsed = emailSchema.safeParse(email);
  if (!parsed.success) return { error: "Enter a valid email address." };

  const supabase = await createClient();
  const { error } = await supabase.auth.resend({
    type: "signup",
    email: parsed.data,
    options: { emailRedirectTo: `${siteUrl()}/auth/confirm?next=/dashboard` },
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

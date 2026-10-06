"use server";

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
      return error.status === 429
        ? "Too many attempts. Please wait a few minutes and try again."
        : "We could not create your account. Please try again.";
  }
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

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
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

  // Never reveal whether an address is already registered: show the same screen.
  if (error && error.code !== "user_already_exists") {
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
    if (error.code === "over_email_send_rate_limit" || error.status === 429) {
      return { error: "Please wait a minute before asking for another email.", retrySeconds: 60 };
    }
    return { error: "We could not send the email. Please try again." };
  }
  return {};
}

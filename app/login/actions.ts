"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { findAccountByEmail } from "@/lib/account";
import { createClient } from "@/lib/supabase/server";
import { fieldErrors, signInSchema, type FieldErrors } from "@/lib/auth/schemas";
import { safeNext } from "@/lib/auth/safe-next";
import { originFor } from "@/lib/auth/site-url";
import { rememberReturn } from "@/lib/auth/return-server";
import { publicLimited } from "@/lib/request-limits";

export type LoginState = {
  error?: string;
  fieldErrors?: FieldErrors;
  /** Set when Supabase says the address has not been confirmed yet. */
  unconfirmedEmail?: string;
};

export async function signInWithPassword(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = signInSchema.safeParse({
    email: formData.get("email") ?? "",
    password: formData.get("password") ?? "",
  });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  // Per IP and per address, before Supabase: password guessing is slowed for one account from many IPs too.
  const limited = await publicLimited("login", parsed.data.email);
  if (limited) return { error: limited };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    if (error.code === "email_not_confirmed") return { unconfirmedEmail: parsed.data.email };
    if (error.status === 429 || error.code === "over_request_rate_limit") {
      return { error: "Too many attempts. Please wait a few minutes and try again." };
    }
    if (error.code === "invalid_credentials") {
      // Google accounts have no password until they set one with "Forgot password?".
      const account = await findAccountByEmail(parsed.data.email);
      if (account?.method === "GOOGLE" && !account.hasPassword) {
        return {
          error:
            "This account was created with Google. Use Continue with Google, or choose “Forgot password?” to add a password.",
        };
      }
      return { error: "Incorrect email or password." };
    }
    return { error: "We could not sign you in. Please try again." };
  }
  const next = safeNext(String(formData.get("next") ?? ""));
  await rememberReturn(next); // a brand-new account still has to pass /welcome and /onboarding first
  redirect(next);
}

export async function signInWithGoogle(formData: FormData) {
  const next = safeNext(String(formData.get("next") ?? ""));
  const visit = String(formData.get("visitSession") ?? "");
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${originFor(await headers())}/auth/callback?next=${encodeURIComponent(next)}${/^[A-Za-z0-9_-]{8,40}$/.test(visit) ? `&vs=${visit}` : ""}`,
    },
  });
  if (error || !data.url) redirect("/login?error=google");
  redirect(data.url);
}

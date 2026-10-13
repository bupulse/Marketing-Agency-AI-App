"use server";

import { redirect } from "next/navigation";
import { isAdminEmail } from "@/lib/admin/auth";
import { fieldErrors, signInSchema, type FieldErrors } from "@/lib/auth/schemas";
import { publicLimited } from "@/lib/request-limits";
import { createClient } from "@/lib/supabase/server";

export type AdminLoginState = { error?: string; fieldErrors?: FieldErrors };

const WRONG = "Incorrect email or password, or this address has no admin access.";

/** Step 1 of the admin sign-in: email and password only (no Google). Step 2 is the authenticator code (/admin/verify). */
export async function adminSignIn(_prev: AdminLoginState, formData: FormData): Promise<AdminLoginState> {
  const parsed = signInSchema.safeParse({ email: formData.get("email") ?? "", password: formData.get("password") ?? "" });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  const limited = await publicLimited("login", parsed.data.email);
  if (limited) return { error: limited };
  // Same answer for a non-admin address as for a wrong password, and no client session is created for it.
  if (!isAdminEmail(parsed.data.email)) return { error: WRONG };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    if (error.status === 429 || error.code === "over_request_rate_limit") {
      return { error: "Too many attempts. Please wait a few minutes and try again." };
    }
    return { error: WRONG };
  }
  redirect("/admin"); // requireAdmin sends the admin on to the authenticator code (or to set one up)
}

"use server";

import { redirect } from "next/navigation";
import { isAdminEmail } from "@/lib/admin/auth";
import { emailSchema } from "@/lib/auth/schemas";
import { publicLimited } from "@/lib/request-limits";
import { createClient } from "@/lib/supabase/server";

export type AdminLoginState = { error?: string; sentTo?: string };

/**
 * Admin sign-in, step 1: the admin email. An emailed code is sent only to an address on ADMIN_EMAILS, but every address
 * gets the same answer, so the page does not reveal which addresses are admins. No password, no Google.
 */
export async function sendAdminCode(_prev: AdminLoginState, formData: FormData): Promise<AdminLoginState> {
  const parsed = emailSchema.safeParse(String(formData.get("email") ?? ""));
  if (!parsed.success) return { error: "Enter your admin email." };
  const email = parsed.data.toLowerCase();
  const limited = await publicLimited("adminCode", email);
  if (limited) return { error: limited };
  if (isAdminEmail(email)) {
    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
    if (error?.status === 429 || error?.code === "over_email_send_rate_limit") {
      return { error: "A code was sent very recently. Wait a minute, then try again." };
    }
    if (error) return { error: "Could not send the code. Please try again in a minute." };
  }
  return { sentTo: email };
}

/** Step 2: the emailed code. Step 3 (/admin/verify) is the authenticator code, which requireAdmin sends the admin to. */
export async function verifyAdminCode(_prev: AdminLoginState, formData: FormData): Promise<AdminLoginState> {
  const email = String(formData.get("email") ?? "").toLowerCase();
  const token = String(formData.get("code") ?? "").trim();
  if (!/^\d{6,10}$/.test(token)) return { sentTo: email, error: "Enter the code from the email." };
  const limited = await publicLimited("login", email);
  if (limited) return { sentTo: email, error: limited };
  const wrong = { sentTo: email, error: "That code did not work. Check the latest email, or send a new one." };
  if (!isAdminEmail(email)) return wrong;
  const supabase = await createClient();
  const { data, error } = await supabase.auth.verifyOtp({ email, token, type: "email" });
  if (error || !data.user) return wrong;
  redirect("/admin");
}

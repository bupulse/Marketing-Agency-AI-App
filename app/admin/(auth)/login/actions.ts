"use server";

import { redirect } from "next/navigation";
import { canReceiveAdminCode } from "@/lib/admin/auth";
import { emailSchema } from "@/lib/auth/schemas";
import { padTo, publicLimited } from "@/lib/request-limits";
import { createClient } from "@/lib/supabase/server";

export type AdminLoginState = { error?: string; sentTo?: string };

/**
 * Admin sign-in, step 1: the email. An emailed code is sent only to the owner (ADMIN_EMAILS) or an enabled staff member
 * (Admin -> Organisation), but every address gets the same answer, so the page does not reveal who has access. No
 * password, no Google.
 */
/** Every answer of the code steps takes at least this long, so the timing does not tell who has access. */
const ANSWER_MS = 1200;

export async function sendAdminCode(_prev: AdminLoginState, formData: FormData): Promise<AdminLoginState> {
  const started = Date.now();
  const result = await sendAdminCodeNow(formData);
  await padTo(started, ANSWER_MS);
  return result;
}

async function sendAdminCodeNow(formData: FormData): Promise<AdminLoginState> {
  const parsed = emailSchema.safeParse(String(formData.get("email") ?? ""));
  if (!parsed.success) return { error: "Enter your admin email." };
  const email = parsed.data.toLowerCase();
  const limited = await publicLimited("adminCode", email);
  if (limited) return { error: limited };
  if (await canReceiveAdminCode(email)) {
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
  const started = Date.now();
  const email = String(formData.get("email") ?? "").toLowerCase();
  const token = String(formData.get("code") ?? "").trim();
  if (!/^\d{6,10}$/.test(token)) return { sentTo: email, error: "Enter the code from the email." };
  const limited = await publicLimited("adminVerify", email);
  if (limited) return { sentTo: email, error: limited };
  const wrong = { sentTo: email, error: "That code did not work. Check the latest email, or send a new one." };
  let ok = false;
  if (await canReceiveAdminCode(email)) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.verifyOtp({ email, token, type: "email" });
    ok = !error && !!data.user;
  }
  if (!ok) {
    // A stranger's "wrong" and an admin's wrong code take the same time.
    await padTo(started, ANSWER_MS);
    return wrong;
  }
  redirect("/admin");
}

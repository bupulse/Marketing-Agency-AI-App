"use server";

import { redirect } from "next/navigation";
import { passwordSchema, type FieldErrors } from "@/lib/auth/schemas";
import { joinAsNewCreator, JoinError, joinWithLogin } from "@/lib/creators/join";
import { logError } from "@/lib/errors";
import { RateLimitError, rateLimit, rateLimitMessage } from "@/lib/rate-limit";
import { createClient, getCurrentUser } from "@/lib/supabase/server";

export type JoinState = { error?: string; fieldErrors?: FieldErrors };

const LIMIT = { limit: 10, windowSeconds: 60 * 60 };

/** A selected creator with a new email: makes their creator login from the invite, then signs them in. */
export async function joinNewAction(_prev: JoinState, formData: FormData): Promise<JoinState> {
  const token = String(formData.get("token") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!name) return { fieldErrors: { name: "Enter your name." } };
  const parsed = passwordSchema.safeParse(password);
  if (!parsed.success) return { fieldErrors: { password: parsed.error.issues[0]?.message ?? "Choose a stronger password." } };
  if (password !== String(formData.get("confirmPassword") ?? "")) return { fieldErrors: { confirmPassword: "The passwords do not match." } };

  let email: string;
  try {
    await rateLimit(`creator-join:${token.slice(0, 16)}`, LIMIT);
    ({ email } = await joinAsNewCreator(token, { name, password }));
  } catch (error) {
    if (error instanceof RateLimitError) return { error: rateLimitMessage(error) };
    if (error instanceof JoinError) return { error: error.message };
    await logError(error, { source: "creators.join" });
    return { error: "We could not finish joining. Please try again." };
  }
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) redirect(`/login?email=${encodeURIComponent(email)}&next=/creator`);
  redirect("/creator");
}

/** A selected creator who is signed in with the application's email: adds the campaign to their profile. */
export async function joinSignedInAction(_prev: JoinState, formData: FormData): Promise<JoinState> {
  const token = String(formData.get("token") ?? "");
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/creator/join/${token}`)}`);
  try {
    await rateLimit(`creator-join:${token.slice(0, 16)}`, LIMIT);
    await joinWithLogin(token, user);
  } catch (error) {
    if (error instanceof RateLimitError) return { error: rateLimitMessage(error) };
    if (error instanceof JoinError) return { error: error.message };
    await logError(error, { source: "creators.join" });
    return { error: "We could not add the campaign. Please try again." };
  }
  redirect("/creator");
}

"use server";

import { redirect } from "next/navigation";
import { passwordSchema, type FieldErrors } from "@/lib/auth/schemas";
import { logError } from "@/lib/errors";
import { RateLimitError, rateLimit, rateLimitMessage } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { acceptInvite, TeamError } from "@/lib/team/service";

export type AcceptState = { error?: string; otherCompany?: boolean; fieldErrors?: FieldErrors };

/** A new person joins the company: creates their sign-in and membership from the invitation, then signs them in. */
export async function acceptInviteAction(_prev: AcceptState, formData: FormData): Promise<AcceptState> {
  const token = String(formData.get("token") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!name) return { fieldErrors: { name: "Enter your name." } };
  const parsedPassword = passwordSchema.safeParse(password);
  if (!parsedPassword.success) return { fieldErrors: { password: parsedPassword.error.issues[0]?.message ?? "Choose a stronger password." } };
  if (password !== String(formData.get("confirmPassword") ?? "")) return { fieldErrors: { confirmPassword: "The passwords do not match." } };

  let email: string;
  try {
    await rateLimit(`invite-accept:${token.slice(0, 16)}`, { limit: 10, windowSeconds: 60 * 60 });
    ({ email } = await acceptInvite(token, { name, password }));
  } catch (error) {
    if (error instanceof RateLimitError) return { error: rateLimitMessage(error) };
    if (error instanceof TeamError) return { error: error.message, otherCompany: error.code === "other_company" };
    await logError(error, { source: "team.accept" });
    return { error: "We could not finish joining. Please try again." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  // Joined, but the automatic sign-in failed: the sign-in page finishes the job.
  if (error) redirect(`/login?email=${encodeURIComponent(email)}`);
  redirect("/dashboard");
}

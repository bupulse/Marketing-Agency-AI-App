"use server";

import { createClient } from "@/lib/supabase/server";
import { emailSchema } from "@/lib/auth/schemas";
import { siteUrl } from "@/lib/auth/site-url";
import { publicLimited } from "@/lib/request-limits";

export type ForgotState = { error?: string; sent?: boolean };

export async function requestPasswordReset(_prev: ForgotState, formData: FormData): Promise<ForgotState> {
  const parsed = emailSchema.safeParse(formData.get("email") ?? "");
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  // The limit message does not depend on whether the address has an account.
  const limited = await publicLimited("forgotPassword", parsed.data);
  if (limited) return { error: limited };

  const supabase = await createClient();
  // Result is ignored on purpose: the screen is the same whether or not the address has an account.
  await supabase.auth.resetPasswordForEmail(parsed.data, {
    redirectTo: `${siteUrl()}/auth/confirm?type=recovery&next=/reset-password`,
  });
  return { sent: true };
}

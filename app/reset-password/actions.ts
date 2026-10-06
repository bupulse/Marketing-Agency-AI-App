"use server";

import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { fieldErrors, resetPasswordSchema, type FieldErrors } from "@/lib/auth/schemas";

export type ResetState = { done?: boolean; error?: string; fieldErrors?: FieldErrors };

export async function updatePassword(_prev: ResetState, formData: FormData): Promise<ResetState> {
  const parsed = resetPasswordSchema.safeParse({
    password: formData.get("password") ?? "",
    confirmPassword: formData.get("confirmPassword") ?? "",
  });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  if (!(await getCurrentUser())) {
    return { error: "This reset link has expired. Request a new one to continue." };
  }
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    if (error.code === "same_password") return { error: "Choose a password you have not used before." };
    if (error.code === "weak_password") return { error: "That password is too easy to guess. Try a longer one." };
    return { error: "We could not update your password. Please try again." };
  }
  return { done: true };
}

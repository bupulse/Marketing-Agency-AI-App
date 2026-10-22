import { CREATOR_START } from "@/lib/creators/profile-form";
import { cleanReturn } from "./return-path";

type ConfirmedUser = { user_metadata?: Record<string, unknown> | null };

/** Six to ten digits (Supabase's "Email OTP Length"), with the spaces or dashes a paste may bring removed. */
export function cleanEmailCode(value: unknown): string | null {
  const code = String(value ?? "").replace(/[\s-]/g, "");
  return /^\d{6,10}$/.test(code) ? code : null;
}

/** Supabase's answer to a wrong, used or expired code (as opposed to an outage or a rate limit). */
export function isCodeRefused(error: { code?: string; status?: number }): boolean {
  return error.code === "otp_expired" || error.status === 403;
}

/**
 * Where a confirmed sign-up goes, from the link or the typed code: the `next` it carries when there is one, else what
 * the sign-up remembered in its metadata (a creator's start page, or the business sign-up's return path), else the
 * dashboard. The branded email links carry no `next` (one template serves both sign-ups). Always a same-site path.
 */
export function confirmedNext(user: ConfirmedUser | null | undefined, next: string | null | undefined): string {
  if (next) return cleanReturn(next);
  const meta = user?.user_metadata ?? {};
  if (meta.account_kind === "creator") return CREATOR_START;
  return cleanReturn(typeof meta.return_to === "string" ? meta.return_to : null);
}

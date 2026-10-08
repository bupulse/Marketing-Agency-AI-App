import { safeNext } from "./safe-next";

// Where to send a person after sign-in or sign-up when they came from a link that needs an account (for example a
// Shopify install: /dashboard/stores/shopify?shop=…&hmac=…). The path travels as the `next` parameter through login,
// Google sign-in and the sign-up confirmation email; a short-lived cookie then carries it through the extra steps a new
// account goes through (/welcome and /onboarding), which would otherwise send everyone to /dashboard.

export const RETURN_COOKIE = "bp_return";
export const RETURN_MAX_AGE_S = 60 * 60;
const DEFAULT = "/dashboard";

/** A same-site relative path (see safeNext), or the dashboard. Used for every `next` we accept. */
export const cleanReturn = (value: string | null | undefined) => safeNext(value, DEFAULT);

/** True when there is something worth remembering (anything but the plain dashboard). */
export const hasReturn = (value: string | null | undefined) => cleanReturn(value) !== DEFAULT;

export function returnCookieOptions(secure: boolean) {
  return { httpOnly: true, secure, sameSite: "lax" as const, path: "/", maxAge: RETURN_MAX_AGE_S };
}

// The one-time password a mail admin hands to a new person (or after "New password" in the Mail console). The owner,
// 24 Nov 2026: "we set a password that they can reset, then when they log in they set up the authenticator". The flag
// lives in Supabase app_metadata, which only the server's secret key can write; B Mail asks the person to choose
// their own password before anything else, then to add an authenticator. Pure: the gate, the actions and tests share it.

export const TEMP_PASSWORD_KEY = "mail_temp_password";

export function hasTempPassword(appMetadata: unknown): boolean {
  return !!appMetadata && typeof appMetadata === "object" && (appMetadata as Record<string, unknown>)[TEMP_PASSWORD_KEY] === true;
}

export const MAIL_PASSWORD_MIN = 10;

/** The rules a B Mail password must pass; the first broken rule's message, or null when it is fine. */
export function mailPasswordProblem(password: string, confirm: string, oldTemp?: string): string | null {
  if (password.length < MAIL_PASSWORD_MIN) return `Use at least ${MAIL_PASSWORD_MIN} characters.`;
  if (password.length > 72) return "Use 72 characters or fewer.";
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return "Use at least one letter and one number.";
  if (oldTemp && password === oldTemp) return "Choose a new password, not the one you were given.";
  if (password !== confirm) return "The two passwords are not the same.";
  return null;
}

/** Where a signed-in person goes next. Order: the authenticator code (if they have one) before a password change,
 *  because Supabase asks for the code before changing the password of an account that has one. */
export function nextMailStep(s: { temp: boolean; hasTotp: boolean; aal2: boolean }): "password" | "setup" | "verify" | "ok" {
  if (!s.hasTotp) return s.temp ? "password" : "setup";
  if (!s.aal2) return "verify";
  return s.temp ? "password" : "ok";
}

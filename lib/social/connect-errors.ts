// Friendly messages for /dashboard/connections?error=<code>. Client-safe (no server imports).
export const CONNECT_ERRORS = {
  denied: "The connection was cancelled. You can try again any time.",
  state: "That connection link could not be verified. Please start again.",
  expired: "That connection took too long. Please start again.",
  failed: "We could not finish connecting. Please try again.",
  unavailable: "This network is not available yet.",
  rate_limit: "You're doing that a lot. Please try again in a few minutes.",
  no_accounts: "We could not find an account to connect. Check that you picked the right login and account type.",
} as const;
export type ConnectErrorCode = keyof typeof CONNECT_ERRORS;

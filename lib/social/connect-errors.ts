// Friendly messages for /dashboard/connections?error=<code>. Client-safe (no server imports).
export const CONNECT_ERRORS = {
  denied: "The connection was cancelled. You can try again any time.",
  state: "That connection link could not be verified. Please start again.",
  expired: "That connection took too long. Please start again.",
  failed: "We could not finish connecting. Please try again.",
  unavailable: "This network is not available yet.",
  rate_limit: "You're doing that a lot. Please try again in a few minutes.",
  no_accounts: "We could not find an account to connect. For Instagram it must be a Business or Creator account: switch a personal account in the Instagram app (Settings, Account type and tools, Switch to professional account). If you signed in with Facebook, it must also be linked to a Facebook Page that you tick when Facebook asks. Then try again.",
} as const;
export type ConnectErrorCode = keyof typeof CONNECT_ERRORS;

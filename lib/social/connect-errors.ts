// Friendly messages for /dashboard/connections?error=<code>. Client-safe (no server imports).
export const CONNECT_ERRORS = {
  denied: "The connection was cancelled. You can try again any time.",
  // The network refused the sign-in itself (TikTok through Zernio answers oauth_denied for this too): not the person's choice.
  refused: "TikTok did not allow the connection. Press Continue only once on TikTok's page and try again. If it keeps happening, check in the TikTok app that the account is yours, is 18 or older and has no restrictions.",
  state: "That connection link could not be verified. Please start again.",
  expired: "That connection took too long. Please start again.",
  failed: "We could not finish connecting. Please try again.",
  unavailable: "This network is not available yet.",
  rate_limit: "You're doing that a lot. Please try again in a few minutes.",
  full: "Connecting this network is paused for a moment on our side. BuPulse support has been told. Please try again later.",
  no_accounts: "We could not find an account to connect. For Instagram it must be a Business or Creator account: switch a personal account in the Instagram app (Settings, Account type and tools, Switch to professional account). If you signed in with Facebook, it must also be linked to a Facebook Page that you tick when Facebook asks. Then try again.",
} as const;
export type ConnectErrorCode = keyof typeof CONNECT_ERRORS;

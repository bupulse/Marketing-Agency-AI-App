// Messages for /creator/connections?error=<code> (docs/CREATOR_CAMPAIGNS.md, "Accounts"). Client-safe.
export const CREATOR_CONNECT_ERRORS = {
  denied: "The connection was cancelled. You can try again any time.",
  state: "That connection link could not be verified. Please start again.",
  expired: "That connection took too long. Please start again.",
  failed: "We could not finish connecting. Please try again.",
  unavailable: "Connecting accounts is not available right now. Please try again later.",
  rate_limit: "You're doing that a lot. Please try again in a few minutes.",
  personal:
    "This is a personal Instagram account. Personal accounts cannot share their views, so switch it to a Creator or Business account in the Instagram app (Settings, Account type and tools, Switch to professional account), then connect again.",
  no_pages: "We could not find a Facebook Page for this login. Campaign posts on Facebook must be on a Page you manage: tick it when Facebook asks, then connect again.",
  no_accounts: "We could not find an account to connect. Please try again.",
  taken: "This account is connected to another creator's BuPulse login.",
} as const;
export type CreatorConnectError = keyof typeof CREATOR_CONNECT_ERRORS;

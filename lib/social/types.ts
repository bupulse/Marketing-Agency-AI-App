// Social network providers. Feature code (composer, publisher, Autopilot, metrics) depends only on these
// types and on lib/social/registry.ts, never on a network's API, so networks and connection methods
// (direct OAuth, BuPulse-Socials through Composio, the user's own Composio later) can be added without touching the features.

export type Network = "instagram" | "facebook" | "linkedin" | "tiktok" | "youtube";

export const NETWORKS: readonly Network[] = ["instagram", "facebook", "linkedin", "tiktok", "youtube"];

/** What a network accepts, used by the composer for validation and by Autopilot to pick formats. */
export interface NetworkRules {
  network: Network;
  label: string;
  /** Maximum characters of text (caption, commentary or description). */
  maxText: number;
  maxHashtags?: number;
  /** Post needs at least one image or video (Instagram, TikTok, YouTube). */
  requiresMedia: boolean;
  maxImages: number;
  /** Formats this network can publish in Stage 1. SCRIPT is always allowed as a reminder-only post. */
  formats: ReadonlyArray<"POST" | "CAROUSEL" | "ARTICLE" | "SCRIPT">;
  /** Stage 1 cannot make video, so video-only networks get SCRIPT posts (reminders), not API posts. */
  videoOnly: boolean;
}

/** One account the user can pick after OAuth (e.g. one of several Facebook Pages or LinkedIn organizations). */
export interface AccountChoice {
  externalAccountId: string;
  displayName: string;
  avatarUrl?: string;
  /** "business" | "creator" | "personal" | "page" | "member" | "organization" | "channel" */
  accountType: string;
}

/** Tokens and accounts returned by a finished OAuth flow, before the user picks accounts. */
export interface OAuthResult {
  accessToken: string;
  refreshToken?: string;
  /** When the access token expires; undefined if it does not. */
  expiresAt?: Date;
  scopes: string[];
  accounts: AccountChoice[];
  /** Per-account tokens (Facebook Page tokens); falls back to accessToken when absent. */
  accountTokens?: Record<string, { accessToken: string; expiresAt?: Date }>;
}

export interface RefreshedTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
}

/** A post ready to send: text already validated, media as short-lived public URLs (signed storage URLs). */
export interface PublishRequest {
  format: "POST" | "CAROUSEL" | "ARTICLE";
  title?: string | null;
  text: string;
  media: { url: string; mimeType: string; width?: number | null; height?: number | null }[];
  link?: string | null;
}

export interface PublishResult {
  externalId: string;
  permalink?: string;
}

export interface MetricsSnapshot {
  views?: number;
  reach?: number;
  likes?: number;
  comments?: number;
  saves?: number;
  shares?: number;
}

/** The decrypted credentials of one connected account, as the publisher hands them to a provider. */
export interface ConnectionCredentials {
  connectionId: string;
  externalAccountId: string;
  accountType: string | null;
  /** For BuPulse-Socials connections (method COMPOSIO) this is the Composio connected-account id, not a token. */
  accessToken: string;
  /** How the account was connected (Connection.method); DIRECT when absent. */
  method?: "DIRECT" | "OWN_COMPOSIO" | "COMPOSIO";
  /** BuPulse-Socials only: the Composio user the account belongs to (the business id); Composio asks for it on every call. */
  composioUserId?: string;
}

export interface SocialProvider {
  readonly network: Network;
  readonly rules: NetworkRules;
  /** True when this network's developer app keys are set; the Connect button is hidden otherwise. */
  isConfigured(): boolean;
  /**
   * URL of the network's consent page. `state` is opaque and signed by the caller. `extraScopes`: permissions asked for
   * on top of the network's own (the social inbox's, only on the direct Meta route: lib/social/inbox/scopes.ts).
   */
  authorizeUrl(input: { state: string; codeChallenge?: string; redirectUri: string; variant?: string; extraScopes?: string[] }): string;
  /** Exchanges the OAuth code and lists the accounts the user may connect. */
  finishOAuth(input: { code: string; codeVerifier?: string; redirectUri: string; variant?: string }): Promise<OAuthResult>;
  /** Refreshes tokens before they expire; undefined for networks whose tokens do not need it. */
  refresh?(input: { refreshToken?: string; accessToken: string }): Promise<RefreshedTokens>;
  publish(credentials: ConnectionCredentials, post: PublishRequest): Promise<PublishResult>;
  /** Basic metrics for a published post, where the network allows. */
  metrics?(credentials: ConnectionCredentials, externalId: string): Promise<MetricsSnapshot>;
  /** Best-effort revoke on disconnect. */
  revoke?(credentials: ConnectionCredentials): Promise<void>;
}

/**
 * Thrown by providers. `kind` tells the publisher what to do:
 * - auth: token revoked or expired, mark the connection EXPIRED and ask the user to reconnect
 * - rate_limit / temporary: retry later with back-off
 * - invalid: the post itself is rejected (too long, wrong media); fail it without retrying
 */
export class SocialError extends Error {
  constructor(
    message: string,
    public kind: "auth" | "rate_limit" | "temporary" | "invalid",
    public network: Network,
    /** Seconds to wait before retrying, when the network says so. */
    public retryAfter?: number,
    /**
     * "final" when the error came from the call that creates the post (media_publish, /feed, /rest/posts...):
     * the network may have made the post anyway, so the publisher must not retry it by itself.
     * Default "before": nothing was created yet.
     */
    public stage: "before" | "final" = "before",
  ) {
    super(message);
  }
}

/**
 * Wraps the provider call that actually creates the post. A timeout, a 5xx or any unexpected error there
 * leaves it unknown whether the post exists, so it is marked stage "final". Clear rejections (auth, invalid,
 * rate limit) mean nothing was created and pass through unchanged.
 */
export async function finalStage<T>(network: Network, call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof SocialError) {
      if (error.kind === "temporary") error.stage = "final";
      throw error;
    }
    const wrapped = new SocialError(error instanceof Error ? error.message : "The network did not answer", "temporary", network, undefined, "final");
    throw wrapped;
  }
}

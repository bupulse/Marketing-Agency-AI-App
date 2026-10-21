import "server-only";
import { NextResponse } from "next/server";
import { requestSiteUrl } from "@/lib/auth/request-site";
import { cookieOptions, PENDING_PATH, pendingCookieNames, STATE_COOKIE } from "@/lib/social/oauth";
import { authConfigFor, composioApi } from "@/lib/social/composio/client";
import { SocialError } from "@/lib/social/types";
import type { CreatorConnectError } from "./connect-errors";
import type { CreatorNetwork } from "./describe";

// The two ends of a creator's BuPulse-Socials sign-in (app/api/creator/[network]/connect and /callback): the sealed
// state cookie lives under /api/creator only, and every outcome lands on /creator/connections.

export const CREATOR_CONNECT_PATH = "/api/creator";

export type CreatorOutcome = { error: CreatorConnectError } | { connected: string } | { pick: string };

export async function creatorConnectBack(outcome: CreatorOutcome, setCookies: Record<string, string> = {}) {
  const url = new URL("/creator/connections", await requestSiteUrl());
  for (const [key, value] of Object.entries(outcome)) url.searchParams.set(key, value);
  const response = NextResponse.redirect(url);
  response.cookies.delete({ name: STATE_COOKIE, path: CREATOR_CONNECT_PATH });
  for (const [name, value] of Object.entries(setCookies)) response.cookies.set(name, value, await cookieOptions(PENDING_PATH));
  if (!("pick" in outcome)) for (const name of pendingCookieNames()) response.cookies.delete({ name, path: PENDING_PATH });
  return response;
}

/**
 * TikTok has no Composio-managed sign-in (docs.composio.dev/toolkits/tiktok: "Composio-managed OAuth available? No"):
 * it needs an auth config made in Composio with BuPulse's own TikTok app (scopes user.info.basic, user.info.profile,
 * video.list), whose id goes in COMPOSIO_TIKTOK_AUTH_CONFIG_ID. Instagram and Facebook use the managed configs the
 * company side already made (authConfigFor).
 */
export const tiktokAuthConfig = () => process.env.COMPOSIO_TIKTOK_AUTH_CONFIG_ID?.trim() || null;

/** True when creators can connect this network now. */
export const creatorNetworkReady = (network: CreatorNetwork) => network !== "tiktok" || Boolean(tiktokAuthConfig());

/** A one-time BuPulse-Socials sign-in link for a creator's Composio user. */
export async function creatorConnectLink(network: CreatorNetwork, composioUserId: string, callbackUrl: string): Promise<{ url: string; connectedAccountId: string }> {
  const authConfigId = network === "tiktok" ? tiktokAuthConfig() : await authConfigFor(network);
  if (!authConfigId) throw new SocialError("TikTok is not set up in BuPulse-Socials yet", "invalid", network);
  const r = await composioApi<{ redirect_url?: string; connected_account_id?: string }>(network, "POST", "/connected_accounts/link", { auth_config_id: authConfigId, user_id: composioUserId, callback_url: callbackUrl });
  if (!r.redirect_url || !r.connected_account_id) throw new SocialError("BuPulse-Socials did not return a sign-in link", "temporary", network);
  return { url: r.redirect_url, connectedAccountId: r.connected_account_id };
}

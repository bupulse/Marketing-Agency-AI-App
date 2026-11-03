import type { Network } from "../types";

// Zernio (zernio.com, formerly getlate.dev / "Late") connects TikTok for BuPulse while BuPulse's own TikTok app is
// blocked: Zernio runs TikTok's approved TikTok for Business app, so videos go straight to the profile (direct post, not
// the TikTok inbox). Pure (no database, no server-only import) so the Channels page, TikTok's rules, the connections
// code and the tests share the same rules. The calls are in ./client.ts, the posting in ./tiktok.ts.
// https://docs.zernio.com/platforms/tiktok and /guides/connecting-accounts (read 3 November 2026).

/** Networks that go through Zernio once its key is set. Upload-Post keeps LinkedIn; Composio the others. */
export const ZERNIO_NETWORKS: readonly Network[] = ["tiktok"];

/**
 * True when new connections of this network go through Zernio: its key is set (Admin -> Services -> Zernio, loaded into
 * process.env by lib/admin/service-keys.ts). Zernio comes first for TikTok, ahead of Upload-Post, BuPulse-Socials and
 * BuPulse's own app. The first 2 connected accounts are free (docs.zernio.com/pricing), TikTok included.
 */
export const viaZernio = (network: Network): boolean => ZERNIO_NETWORKS.includes(network) && !!process.env.ZERNIO_API_KEY?.trim();

/** TikTok goes through Zernio (its rules then allow photo posts and real video posts). */
export const tiktokViaZernio = (): boolean => viaZernio("tiktok");

/** Marks a connection made through Zernio; its other scope entry names the business's Zernio profile id. */
export const ZERNIO_SCOPE = "zernio";
const PROFILE_PREFIX = "zernio_profile:";
export const zernioProfileScope = (profileId: string) => `${PROFILE_PREFIX}${profileId}`;
export const scopeZernioProfile = (scopes: readonly string[]) => scopes.find((s) => s.startsWith(PROFILE_PREFIX))?.slice(PROFILE_PREFIX.length) ?? null;
export const isZernioResult = (scopes: readonly string[] | null | undefined) => !!scopes?.includes(ZERNIO_SCOPE);

/**
 * The Zernio profile of a business: one per business. Its `externalId` is the business id, so it is found again
 * (GET /v1/profiles?externalId=) without storing anything; the name (unique per Zernio team) says whose it is.
 */
export const zernioProfileName = (businessId: string) => `bupulse_${businessId}`;

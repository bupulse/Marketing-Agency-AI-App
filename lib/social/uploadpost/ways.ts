import type { Network } from "../types";

// Upload-Post (upload-post.com) connects LinkedIn and TikTok for BuPulse: its LinkedIn app is approved for company
// Pages, which BuPulse-Socials (Composio) never returned, and it runs its own approved TikTok app, while BuPulse's
// own TikTok app waits for TikTok's audit (docs.upload-post.com/guides/post-to-tiktok-api). Pure (no database, no server-only import) so the Channels page, the networks'
// rules, the connections code and the tests share the same rules. The calls are in ./client.ts, the posting in
// ./linkedin.ts and ./tiktok.ts.

/** Networks that go through Upload-Post once its key is set (TikTok also needs UPLOAD_POST_TIKTOK: tiktokViaUploadPost). */
export const UPLOAD_POST_NETWORKS: readonly Network[] = ["linkedin", "tiktok"];

/**
 * TikTok is on Upload-Post's paid plans only (docs.upload-post.com/resources/pricing-and-limits: uploads on the Free
 * plan answer 403), so it waits for UPLOAD_POST_TIKTOK=true (Admin -> Services -> Upload-Post), set once BuPulse's
 * Upload-Post plan is paid. Until then TikTok keeps its other ways ("Coming soon" while none is set up).
 */
export const tiktokViaUploadPost = (): boolean => !!process.env.UPLOAD_POST_API_KEY?.trim() && process.env.UPLOAD_POST_TIKTOK?.trim() === "true";

/**
 * True when new connections of this network go through Upload-Post: its key is set (Admin -> Services -> Upload-Post,
 * loaded into process.env by lib/admin/service-keys.ts). Without the key LinkedIn keeps the BuPulse-Socials path.
 */
export const viaUploadPost = (network: Network): boolean =>
  UPLOAD_POST_NETWORKS.includes(network) && !!process.env.UPLOAD_POST_API_KEY?.trim() && (network !== "tiktok" || tiktokViaUploadPost());

/** The network's name in Upload-Post's messages to the client. */
export const uploadPostLabel = (network: Network) => (network === "tiktok" ? "TikTok" : network === "linkedin" ? "LinkedIn" : network);

/** Marks a connection made through Upload-Post; its other scope entry names the Upload-Post profile. */
export const UPLOAD_POST_SCOPE = "uploadpost";
const PROFILE_PREFIX = "uploadpost_profile:";
export const profileScope = (username: string) => `${PROFILE_PREFIX}${username}`;
export const scopeProfile = (scopes: readonly string[]) => scopes.find((s) => s.startsWith(PROFILE_PREFIX))?.slice(PROFILE_PREFIX.length) ?? null;
export const isUploadPostResult = (scopes: readonly string[] | null | undefined) => !!scopes?.includes(UPLOAD_POST_SCOPE);

/**
 * The Upload-Post profile of a business: one per business, named after its id so it is found again without storing
 * anything ("username" is the `user` of every call and cannot be changed; letters, digits, _, @ and - only).
 */
export const profileUsername = (businessId: string) => `bupulse_${businessId.replace(/[^A-Za-z0-9_@-]/g, "_")}`;

/** A LinkedIn Page as Upload-Post wants it in target_linkedin_page_id: the organization URN its Pages list gives. */
export const pageTarget = (pageId: string) => (/^\d+$/.test(pageId) ? `urn:li:organization:${pageId}` : pageId);

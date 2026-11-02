import type { Network } from "../types";

// Upload-Post (upload-post.com) connects LinkedIn for BuPulse: its LinkedIn app is approved for company Pages, which
// BuPulse-Socials (Composio) never returned. Pure (no database, no server-only import) so the Channels page, the
// connections code and the tests share the same rules. The calls are in ./client.ts, LinkedIn's posting in ./linkedin.ts.

/** Networks that go through Upload-Post once its key is set (LinkedIn only for now). */
export const UPLOAD_POST_NETWORKS: readonly Network[] = ["linkedin"];

/**
 * True when new connections of this network go through Upload-Post: its key is set (Admin -> Services -> Upload-Post,
 * loaded into process.env by lib/admin/service-keys.ts). Without the key LinkedIn keeps the BuPulse-Socials path.
 */
export const viaUploadPost = (network: Network): boolean => UPLOAD_POST_NETWORKS.includes(network) && !!process.env.UPLOAD_POST_API_KEY?.trim();

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

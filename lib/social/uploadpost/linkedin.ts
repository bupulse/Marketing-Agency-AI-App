import "server-only";
import { SocialError, type AccountChoice, type ConnectionCredentials, type PublishRequest, type PublishResult } from "../types";
import { getProfile, linkedinPages, type UploadPostPage } from "./client";
import { asObject, https, runUpload, statusEntry, str, syncEntry, type Entry, type Json } from "./upload";
import { pageTarget } from "./ways";

// LinkedIn through Upload-Post: the accounts a sign-in may post to (the member's profile and the company Pages they
// administer) and publishing text, photos or one video there, as the Page when a Page was picked
// (target_linkedin_page_id). For these connections `credentials.uploadPostProfile` names the Upload-Post profile.
// https://docs.upload-post.com/api/get-linkedin-pages, /api/upload-text, /api/upload-photo, /api/upload-video,
// /api/upload-status

const E = "linkedin" as const;
const ORG_URN = /^urn:li:organization:(\d+)$/;

/**
 * The accounts out of the profile's LinkedIn entry and its Pages list: Pages by their organization number (the same
 * id BuPulse's other LinkedIn routes use, so a reconnect updates the same connection), each with its name and logo.
 * Null when the profile has no LinkedIn connected (the person came back without signing in).
 */
export function accountsFrom(linkedin: unknown, pages: readonly UploadPostPage[]): AccountChoice[] | null {
  if (!linkedin) return null;
  const member = asObject(linkedin);
  const accounts: AccountChoice[] = [];
  const memberId = str(member.username)?.replace(/^urn:li:person:/, "") ?? "member";
  accounts.push({ externalAccountId: memberId, displayName: str(member.display_name) ?? str(member.handle) ?? "Your LinkedIn profile", avatarUrl: https(member.social_images), accountType: "member" });
  const seen = new Set<string>([memberId]);
  for (const page of pages) {
    const raw = str(page.id);
    if (!raw) continue;
    const id = raw.replace(ORG_URN, "$1");
    if (seen.has(id)) continue;
    seen.add(id);
    accounts.push({ externalAccountId: id, displayName: str(page.name) ?? `LinkedIn Page ${id}`, avatarUrl: https(page.picture), accountType: "organization" });
  }
  return accounts;
}

/** The profile's LinkedIn accounts (null when LinkedIn was not connected on Upload-Post's page). */
export async function linkedinAccounts(username: string): Promise<AccountChoice[] | null> {
  const profile = await getProfile(E, username);
  const linkedin = asObject(profile?.social_accounts).linkedin;
  if (!linkedin) return null;
  return accountsFrom(linkedin, await linkedinPages(username));
}

// ---- Publishing ----

export { timing } from "./upload";

/** LinkedIn caps a video's title at 400 UTF-16 units (line breaks count twice): a short first line, the text goes in the description. */
export function shortTitle(text: string, max = 200): string {
  const line = text.split(/\r?\n/).find((l) => l.trim())?.trim() ?? "";
  let out = "";
  for (const ch of line) {
    if (out.length + ch.length > max) break;
    out += ch;
  }
  return out;
}

type Outcome = { state: "done"; externalId?: string; permalink?: string } | { state: "failed"; message: string } | { state: "pending" };

const AUTH = [/expired/i, /reconnect/i, /re-?auth/i, /revoked/i, /no \w+ account configured/i, /platform_not_configured/i, /unauthori[sz]ed/i, /invalid.?token/i, /not connected/i];
const LIMIT = [/limit/i, /too many/i, /\b429\b/, /quota/i];

/** A LinkedIn failure Upload-Post reported: nothing was posted, so it is never "final". */
export function failure(message: string): SocialError {
  const text = (message || "LinkedIn did not take the post").slice(0, 300);
  if (AUTH.some((p) => p.test(text))) return new SocialError("LinkedIn no longer lets BuPulse post for this account. Reconnect LinkedIn in Channels.", "auth", E);
  if (LIMIT.some((p) => p.test(text))) return new SocialError(`LinkedIn: ${text}`, "rate_limit", E, 3600);
  return new SocialError(`LinkedIn: ${text}`, "invalid", E);
}

function done(entry: Json): Outcome {
  const externalId = str(entry.platform_post_id) ?? str(entry.post_id) ?? str(entry.urn) ?? str(entry.id);
  const permalink = https(entry.post_url) ?? https(entry.url) ?? (externalId?.startsWith("urn:li:") ? `https://www.linkedin.com/feed/update/${externalId}` : undefined);
  return { state: "done", externalId, permalink };
}

const outcomeOf = (e: Entry): Outcome => (e.state === "done" ? done(e.entry) : e.state === "failed" ? { state: "failed", message: e.message } : e);

/** The LinkedIn result of an upload that finished at once ({ results: { linkedin: {...} } }). */
export const syncOutcome = (answer: unknown): Outcome => outcomeOf(syncEntry(answer, E));

/** The LinkedIn result of an asynchronous upload from its status: done, failed, or still on its way. */
export const statusOutcome = (answer: unknown): Outcome => outcomeOf(statusEntry(answer, E));

/**
 * Posts on LinkedIn through Upload-Post: text (with a link preview), photos, or one video, on the member's profile or
 * the picked Page. Asynchronous, then a few status checks (./upload.ts runUpload): a post still on its way after them
 * counts as sent, as Upload-Post keeps going (and retries) on its own.
 */
export async function publishLinkedIn(c: ConnectionCredentials, post: PublishRequest): Promise<PublishResult> {
  const user = c.uploadPostProfile;
  if (!user) throw new SocialError("This LinkedIn connection is incomplete. Reconnect LinkedIn in Channels.", "auth", E);
  const images = post.media.filter((m) => m.mimeType.startsWith("image/"));
  const videos = post.media.filter((m) => m.mimeType.startsWith("video/"));
  if (images.length + videos.length !== post.media.length || (videos.length && images.length) || videos.length > 1) {
    throw new SocialError("A LinkedIn post takes photos or one video, not both", "invalid", E);
  }
  const body = post.format === "ARTICLE" && post.title ? `${post.title}\n\n${post.text}` : post.text;
  const media = images.length > 0 || videos.length > 0;
  // A text post shows the link as a preview card; on a photo or video post it goes at the end of the text.
  const text = media && post.link && !body.includes(post.link) ? `${body}\n\n${post.link}`.trim() : body;
  if (!text.trim() && !media) throw new SocialError("A LinkedIn post needs text or a photo", "invalid", E);

  // BuPulse's own request id, so the post can be followed even when the answer is lost.
  const ownRequestId = `bp-${crypto.randomUUID()}`;
  const form = new FormData();
  form.append("user", user);
  form.append("request_id", ownRequestId);
  form.append("platform[]", "linkedin");
  form.append("async_upload", "true");
  if (c.accountType === "organization") form.append("target_linkedin_page_id", pageTarget(c.externalAccountId));
  let path: "/upload_text" | "/upload_photos" | "/upload";
  if (videos.length) {
    path = "/upload";
    form.append("video", videos[0].url);
  } else if (images.length) {
    path = "/upload_photos";
    for (const image of images) form.append("photos[]", image.url);
  } else {
    path = "/upload_text";
    form.append("title", text);
    if (post.link) form.append("linkedin_link_url", post.link);
  }
  if (media) {
    const title = shortTitle(text);
    if (title) form.append("title", title);
    if (text.trim()) form.append("description", text);
  }

  const { outcome: entry, requestId } = await runUpload(E, path, form, ownRequestId);
  const outcome = outcomeOf(entry);
  if (outcome.state === "failed") throw failure(outcome.message);
  if (outcome.state === "done" && outcome.externalId) return { externalId: outcome.externalId, ...(outcome.permalink ? { permalink: outcome.permalink } : {}) };
  // Accepted, not finished yet (or finished without an id): Upload-Post's request id stands for the post.
  const permalink = outcome.state === "done" ? outcome.permalink : undefined;
  return { externalId: `uploadpost:${requestId}`, ...(permalink ? { permalink } : {}) };
}

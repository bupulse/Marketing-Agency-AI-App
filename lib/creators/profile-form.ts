// A creator's own account (docs/CREATOR_MARKETPLACE.md, "Creator accounts"): the sign-up form of /creators/signup and
// the profile form of /creator/profile, read and checked, and whether a profile is complete enough to apply in one tap.
// Pure, so the rules have tests; lib/creators/profile.ts saves.

import { emailSchema, passwordSchema } from "@/lib/auth/schemas";
import { cleanHandle, isLink, MAX_SAMPLES, readFollowers, readWhatsapp, type ApplicationErrors, type Handle } from "./application";
import { CREATOR_NETWORKS, isCreatorNetwork, networkLabel } from "./describe";
import { isSocialNetwork } from "./networks";

export const BIO_MAX = 500;
export const LOCATION_MAX = 80;
const PHONE_ERROR = "Enter a valid WhatsApp number, e.g. +250 791 954 277.";

/** After confirming their email, a new creator fills in their profile first. */
export const CREATOR_START = "/creator/profile";

export type CreatorSignUp = { name: string; email: string; password: string; phone: string };

/** The sign-up form: name, email, password and WhatsApp. A number without "+" is read as Rwandan. */
export function readCreatorSignUp(form: { get(name: string): unknown }): { ok: true; value: CreatorSignUp } | { ok: false; errors: ApplicationErrors } {
  const s = (name: string) => String(form.get(name) ?? "");
  const errors: ApplicationErrors = {};
  const name = s("name").trim().slice(0, 100);
  if (name.length < 2) errors.name = "Enter your name.";
  const email = emailSchema.safeParse(s("email"));
  if (!email.success) errors.email = email.error.issues[0]?.message ?? "Enter a valid email address.";
  const password = passwordSchema.safeParse(s("password"));
  if (!password.success) errors.password = password.error.issues[0]?.message ?? "Enter a password.";
  const phone = readWhatsapp(s("phone"), null);
  if (!phone) errors.phone = PHONE_ERROR;
  if (Object.keys(errors).length || !email.success || !password.success) return { ok: false, errors };
  return { ok: true, value: { name, email: email.data, password: password.data, phone: phone! } };
}

export type ProfileInput = { name: string; phone: string; location: string | null; bio: string | null; handles: Handle[]; samples: string[]; discoverable: boolean };

/** The profile form: `handle_<network>` and `followers_<network>` for every network, `sample_1..3`, `discoverable`. */
export function readProfileForm(form: { get(name: string): unknown }): { ok: true; value: ProfileInput } | { ok: false; errors: ApplicationErrors } {
  const s = (name: string) => String(form.get(name) ?? "").trim();
  const errors: ApplicationErrors = {};
  const name = s("name").slice(0, 100);
  if (name.length < 2) errors.name = "Enter your name.";
  const phone = readWhatsapp(s("phone"), null);
  if (!phone) errors.phone = PHONE_ERROR;
  const location = s("location").slice(0, LOCATION_MAX) || null;
  const bio = s("bio");
  if (bio.length > BIO_MAX) errors.bio = `Keep it to ${BIO_MAX} characters.`;

  const handles: Handle[] = [];
  for (const network of CREATOR_NETWORKS) {
    const handle = cleanHandle(s(`handle_${network}`));
    const followersRaw = s(`followers_${network}`);
    if (!handle && !followersRaw) continue;
    if (!handle) {
      errors[`handle_${network}`] = `Enter your ${networkLabel(network)} name.`;
      continue;
    }
    const followers = readFollowers(followersRaw);
    if (followers === null) {
      errors[`followers_${network}`] = "Enter how many followers you have, e.g. 12000 or 12k.";
      continue;
    }
    handles.push({ network, handle, followers });
  }

  const samples: string[] = [];
  for (let i = 1; i <= MAX_SAMPLES; i++) {
    const v = s(`sample_${i}`);
    if (!v) continue;
    if (!isLink(v) || v.length > 500) errors[`sample_${i}`] = "Paste the full link, starting with https://";
    else samples.push(v);
  }

  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { name, phone: phone!, location, bio: bio || null, handles, samples, discoverable: form.get("discoverable") === "on" } };
}

/** The handles as stored (CreatorProfile.handles, CampaignCreator.handles), on any network; anything unreadable is left out. */
export function readHandles(value: unknown): Handle[] {
  if (!Array.isArray(value)) return [];
  const out: Handle[] = [];
  for (const h of value) {
    if (!h || typeof h !== "object") continue;
    const { network, handle, followers } = h as Record<string, unknown>;
    if (!isSocialNetwork(network) || typeof handle !== "string" || !handle) continue;
    out.push({ network, handle, followers: typeof followers === "number" && Number.isFinite(followers) ? Math.max(0, Math.floor(followers)) : 0 });
  }
  return out;
}

export type ProfileGap = "phone" | "handle";

/**
 * What a profile still needs before it can apply in one tap to a campaign on these platforms: a WhatsApp number and a
 * handle on at least one of them. Empty when it is complete.
 */
export function profileGaps(profile: { phone: string | null; handles: unknown }, platforms: string[]): ProfileGap[] {
  const gaps: ProfileGap[] = [];
  if (!profile.phone) gaps.push("phone");
  if (!readHandles(profile.handles).some((h) => platforms.includes(h.network))) gaps.push("handle");
  return gaps;
}

/** "Add your WhatsApp number and your Instagram or TikTok name" for the gaps of a campaign on these platforms. */
export function gapsInWords(gaps: ProfileGap[], platforms: string[]): string {
  const parts: string[] = [];
  if (gaps.includes("phone")) parts.push("your WhatsApp number");
  if (gaps.includes("handle")) {
    const names = platforms.filter(isCreatorNetwork).map(networkLabel);
    parts.push(`your ${names.length > 1 ? `${names.slice(0, -1).join(", ")} or ${names.at(-1)}` : (names[0] ?? "account")} name and followers`);
  }
  return parts.length ? `Add ${parts.join(" and ")}` : "";
}

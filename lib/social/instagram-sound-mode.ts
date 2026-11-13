// How a reel on this Instagram connection gets a trending sound (owner decisions, 13 November 2026). Pure, client-safe.
// - "auto": an Instagram account connected through Facebook Login (BuPulse's own app, the "facebook" variant of
//   lib/social/providers/instagram.ts): BuPulse attaches a trending sound itself when the reel is published (Meta's
//   Instagram Audio API works only there).
// - "tip": every other way in (Instagram Login, BuPulse-Socials/Composio, Upload-Post, Zernio, a reminder for an app
//   that is not connected): the client sees the week's trending sounds and can post the reel by hand with one.

export type InstagramSoundMode = "auto" | "tip";

/** Facebook Login asks for these (INSTAGRAM_VIA_FACEBOOK_SCOPES); Instagram Login's are "instagram_business_*". */
const FACEBOOK_LOGIN_SCOPE = "instagram_content_publish";
const OTHER_WAYS = ["composio", "uploadpost", "zernio"];

export function isFacebookLoginInstagram(connection: { provider: string; method?: string | null; scopes?: readonly string[] | null } | null | undefined): boolean {
  if (!connection || connection.provider !== "instagram") return false;
  if (connection.method && connection.method !== "DIRECT") return false;
  const scopes = connection.scopes ?? [];
  return scopes.includes(FACEBOOK_LOGIN_SCOPE) && !scopes.some((s) => OTHER_WAYS.includes(s));
}

/** The mode of an Instagram post's connection (null connection: an app that is not connected, a reminder). */
export function instagramSoundMode(connection: { provider: string; method?: string | null; scopes?: readonly string[] | null } | null | undefined): InstagramSoundMode {
  return isFacebookLoginInstagram(connection) ? "auto" : "tip";
}

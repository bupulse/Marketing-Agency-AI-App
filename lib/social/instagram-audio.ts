// Trending Instagram sounds on BuPulse reels (owner decisions, 13 November 2026). Meta's Instagram Audio API
// (developers.facebook.com/docs/instagram-platform/content-publishing/audio-api/):
// - GET graph.facebook.com/{ver}/ig_audio?audio_type=music&user_id={ig-user-id}: without search_query it returns the
//   TRENDING audio, "authorized for third party use" (it may differ from what the Instagram app shows);
// - a REELS container takes audio_configuration = {"audio_id", "audio_volume" 1-100, "video_volume" 1-100}.
// Only for Instagram accounts connected through Facebook Login (tokens "EA...", host graph.facebook.com); Instagram
// Login does not support it. The docs disagree on field names (cover_artwork_thumbnail_uri vs _url, audio_type as a
// number or a string), so everything here is read defensively. Fetching and parsing only: no database (the cache and
// the admin list are in lib/social/trending-sounds.ts).
import { graphGet, GRAPH_VERSION } from "./graph";

/**
 * How loud the trending sound and the reel's own audio are. The voice-over carries the message, so the song sits under
 * it: the reel's audio (voice-over, any sound of the video itself) at full level, the song at 40%.
 */
export const IG_SOUND_VOLUME = { audio: 40, video: 100 } as const;

const FB_GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;

export type IgAudio = {
  id: string;
  title: string;
  artist: string | null;
  /** Only when Meta says so; the docs list no explicit flag, so this is false unless a field says otherwise. */
  explicit: boolean;
  durationMs: number | null;
  coverUrl: string | null;
  /** Instagram's page for the sound (on_platform_audio_preview_link), for the "Post manually" tip. */
  link: string | null;
  type: "music" | "original_sound" | null;
};

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" && Number.isFinite(v) ? String(v) : null);
const httpsUrl = (v: unknown): string | null => {
  const t = text(v);
  return t && /^https:\/\/\S+$/.test(t) ? t : null;
};
const truthy = (v: unknown) => v === true || v === 1 || v === "true" || v === "1" || v === "explicit";

function audioType(v: unknown): IgAudio["type"] {
  if (v === "music" || v === "MUSIC" || v === 1 || v === "1") return "music";
  if (v === "original_sound" || v === "ORIGINAL_SOUND" || v === 2 || v === "2") return "original_sound";
  return null;
}

/** One audio from a search, trending or metadata answer; null when it has no id or no title. */
export function parseAudio(raw: unknown): IgAudio | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = text(r.audio_id) ?? text(r.id) ?? text(r.audio_asset_id);
  const title = text(r.title) ?? text(r.name) ?? text(r.song_name);
  if (!id || !title || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) return null;
  const duration = Number(r.duration_in_ms ?? r.duration_ms);
  return {
    id,
    title: title.slice(0, 200),
    artist: (text(r.display_artist) ?? text(r.artist_name) ?? text(r.artist) ?? text(r.ig_username))?.slice(0, 200) ?? null,
    explicit: truthy(r.is_explicit) || truthy(r.explicit) || truthy(r.is_explicit_content) || truthy(r.explicit_content),
    durationMs: Number.isFinite(duration) && duration > 0 ? Math.round(duration) : null,
    coverUrl: httpsUrl(r.cover_artwork_thumbnail_uri) ?? httpsUrl(r.cover_artwork_thumbnail_url) ?? httpsUrl(r.cover_artwork_uri),
    link: httpsUrl(r.on_platform_audio_preview_link) ?? httpsUrl(r.permalink),
    type: audioType(r.audio_type),
  };
}

/** The audios of an ig_audio answer: `{ audio: [...] }` (the docs' sample), `{ data: [...] }`, or a bare array. */
export function parseAudioList(body: unknown): IgAudio[] {
  const b = body as Record<string, unknown> | unknown[] | null;
  const list = Array.isArray(b) ? b : Array.isArray(b?.audio) ? b.audio : Array.isArray(b?.data) ? b.data : Array.isArray((b?.data as Record<string, unknown> | undefined)?.audio) ? ((b!.data as Record<string, unknown>).audio as unknown[]) : [];
  const seen = new Set<string>();
  const out: IgAudio[] = [];
  for (const raw of list) {
    const audio = parseAudio(raw);
    if (!audio || seen.has(audio.id)) continue;
    seen.add(audio.id);
    out.push(audio);
  }
  return out;
}

/** The sound to attach: the top trending one that is not marked explicit (Meta lists the most trending first). */
export function pickTrendingAudio(list: readonly IgAudio[]): IgAudio | null {
  return list.find((a) => !a.explicit && a.type !== "original_sound") ?? list.find((a) => !a.explicit) ?? null;
}

const volume = (n: number) => Math.min(100, Math.max(1, Math.round(n)));

/** The audio_configuration value of a REELS container. */
export function audioConfiguration(audioId: string, volumes: { audio: number; video: number } = IG_SOUND_VOLUME): string {
  return JSON.stringify({ audio_id: audioId, audio_volume: volume(volumes.audio), video_volume: volume(volumes.video) });
}

/** Instagram Login tokens start with "IG"; Facebook Login (Page) tokens with "EA". Only the latter can attach sounds. */
export const isFacebookLoginToken = (token: string) => !!token && !token.startsWith("IG");

/**
 * Trending music for this Instagram account (no search words), or the search results for `search`. Throws a
 * SocialError when Meta refuses (the caller falls back: a sound never fails a post).
 */
export async function fetchTrendingAudio(token: string, igUserId: string, options: { search?: string; type?: "music" | "original_sound" } = {}): Promise<IgAudio[]> {
  const body = await graphGet<unknown>("instagram", `${FB_GRAPH}/ig_audio`, {
    audio_type: options.type ?? "music",
    user_id: igUserId,
    ...(options.search ? { search_query: options.search.slice(0, 100) } : {}),
    access_token: token,
  });
  return parseAudioList(body);
}

/** One audio's details (GET /{ig-audio-id}?user_id=...), or null. */
export async function fetchAudio(token: string, igUserId: string, audioId: string): Promise<IgAudio | null> {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(audioId)) return null;
  return parseAudio(await graphGet<unknown>("instagram", `${FB_GRAPH}/${audioId}`, { user_id: igUserId, access_token: token }));
}

/** A sound as the client sees it: "Title – Artist". */
export function soundLabel(sound: { title: string; artist?: string | null }): string {
  return sound.artist ? `${sound.title} – ${sound.artist}` : sound.title;
}

/** What a post records about the sound attached to it (Post.trendingSound). */
export type AttachedSound = { audioId: string; title: string; artist: string | null; link: string | null; attachedAt: string };

/** Post.trendingSound read back; null for anything else. */
export function readAttachedSound(value: unknown): AttachedSound | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const title = text(v.title);
  if (!title || !text(v.audioId)) return null;
  return { audioId: String(v.audioId), title, artist: text(v.artist), link: httpsUrl(v.link), attachedAt: text(v.attachedAt) ?? "" };
}

// ---- the "trending sound tip" (connections that cannot attach a sound) ----

/** One sound of the week as the tip shows it. */
export type TrendingTip = { title: string; artist: string | null; link: string | null };
export const MAX_TRENDING_TIPS = 10;

const instagramLink = (v: unknown): string | null => {
  const url = httpsUrl(v);
  if (!url) return null;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "instagram.com" || host.endsWith(".instagram.com") ? url : null;
  } catch {
    return null;
  }
};

/** A stored tip list read back (the admin's list or a cached API list): at most 10, each with a title. */
export function cleanTrendingTips(raw: unknown): TrendingTip[] {
  if (!Array.isArray(raw)) return [];
  const out: TrendingTip[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const title = text(r.title)?.slice(0, 120);
    if (!title) continue;
    out.push({ title, artist: text(r.artist)?.slice(0, 120) ?? null, link: instagramLink(r.link) });
    if (out.length >= MAX_TRENDING_TIPS) break;
  }
  return out;
}

/**
 * The admin's list typed in a box, one sound per line: "Title | Artist | Instagram audio link" (artist and link are
 * optional). Links that are not Instagram's are dropped.
 */
export function parseTrendingLines(input: string): TrendingTip[] {
  const rows = String(input ?? "")
    .split(/\r?\n/)
    .map((line) => line.split("|").map((p) => p.trim()))
    .filter((parts) => parts[0]);
  return cleanTrendingTips(rows.map(([title, artist, link]) => ({ title, artist, link })));
}

/** The admin's list back in the box. */
export function trendingLines(tips: readonly TrendingTip[]): string {
  return tips.map((t) => [t.title, t.artist ?? "", t.link ?? ""].join(" | ").replace(/(\s\|\s?)+$/, "")).join("\n");
}

/** API audios as tips (explicit ones left out). */
export function tipsFromAudio(list: readonly IgAudio[]): TrendingTip[] {
  return cleanTrendingTips(list.filter((a) => !a.explicit).map((a) => ({ title: a.title, artist: a.artist, link: a.link })));
}

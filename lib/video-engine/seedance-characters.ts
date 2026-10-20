// Seedance presenters from BytePlus's digital character library (owner decision: BytePlus characters for avatars).
// Seedance 2.0 refuses reference photos with real faces; a digital character is passed instead as an image whose URL is
// asset://<asset id> (docs/VIDEO_ENGINE.md, "What Seedance 2.0 takes"). Server-side only.
// From the ModelArk docs, read 17 October 2026:
// - The library itself is browsed in the ModelArk Model Playground ("Digital Character Library" tab); each character
//   asset shows its asset ID there. The owner copies the chosen IDs into video-lab/data/seedance-characters.json.
// - ListAssets (POST https://ark.ap-southeast-1.byteplusapi.com/?Action=ListAssets&Version=2024-01-01) lists the
//   account's own assets by group type (AIGC = digital characters, LivenessFace = real-person portraits). It takes
//   Access Key / Secret Key signing only (not the Seedance API key): BYTEPLUS_ACCESS_KEY_ID and
//   BYTEPLUS_SECRET_ACCESS_KEY. Response: { Result: { Items: [{ Id, Name, URL (valid 12 hours), GroupId, AssetType,
//   Status, ... }], NextToken? } }.
// Without a key the studio shows six preview characters drawn here (no AI image spend), marked as previews.
import { createHash, createHmac } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { SeedanceReference } from "./seedance";

export const ASSETS_HOST = "ark.ap-southeast-1.byteplusapi.com";
const REGION = "ap-southeast-1";
const SERVICE = "ark";
const CACHE_MS = 30 * 60_000;
/** The owner's picks from the Playground: [{ "id": "asset-...", "name": "Amani", "description": "..." }]. */
export const PICKS_FILE = path.resolve("video-lab/data/seedance-characters.json");

export type Character = {
  /** The asset ID (without asset://). */
  id: string;
  name: string;
  description: string;
  /** asset://<id>, the image URL Seedance takes. */
  uri: string;
  /** A picture of the character: BytePlus's link (valid 12 hours), or the studio's own for previews. */
  portraitUrl: string | null;
  /** byteplus: listed from the account; picked: copied from the Playground by the owner; preview: drawn here. */
  source: "byteplus" | "picked" | "preview";
};
export type CharacterList = { source: "byteplus" | "picked" | "preview" | "none"; characters: Character[]; notice: string };

// ---- Signing (the ModelArk "Signature authentication" page: HMAC-SHA256 over a canonical request)

const sha256 = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
const hmac = (key: string | Buffer, s: string) => createHmac("sha256", key).update(s).digest();

/** The signed headers for a ModelArk management call (Host, X-Date, X-Content-Sha256, Content-Type, Authorization). */
export function signAssetsRequest(o: { accessKeyId: string; secretAccessKey: string; action: string; version?: string; body: string; date?: Date; host?: string }): { url: string; headers: Record<string, string> } {
  const host = o.host ?? ASSETS_HOST;
  const version = o.version ?? "2024-01-01";
  const xDate = (o.date ?? new Date()).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const shortDate = xDate.slice(0, 8);
  const query = [`Action=${encodeURIComponent(o.action)}`, `Version=${encodeURIComponent(version)}`].sort().join("&");
  const contentType = "application/json";
  const bodyHash = sha256(o.body);
  const signedHeaders = "content-type;host;x-content-sha256;x-date";
  const canonical = ["POST", "/", query, `content-type:${contentType}`, `host:${host}`, `x-content-sha256:${bodyHash}`, `x-date:${xDate}`, "", signedHeaders, bodyHash].join("\n");
  const scope = `${shortDate}/${REGION}/${SERVICE}/request`;
  const toSign = ["HMAC-SHA256", xDate, scope, sha256(canonical)].join("\n");
  const key = hmac(hmac(hmac(hmac(o.secretAccessKey, shortDate), REGION), SERVICE), "request");
  const signature = createHmac("sha256", key).update(toSign).digest("hex");
  return {
    url: `https://${host}/?${query}`,
    headers: { Host: host, "X-Date": xDate, "X-Content-Sha256": bodyHash, "Content-Type": contentType, Authorization: `HMAC-SHA256 Credential=${o.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}` },
  };
}

// ---- Parsing

type AssetItem = { Id?: unknown; Name?: unknown; URL?: unknown; AssetType?: unknown; Status?: unknown; GroupId?: unknown };
/** ListAssets' answer as characters: active image assets only. Throws in plain English on an error answer. */
export function parseListAssets(body: unknown): { characters: Character[]; nextToken: string | null } {
  const b = (body ?? {}) as { ResponseMetadata?: { Error?: { Code?: string; Message?: string } }; Result?: { Items?: AssetItem[]; NextToken?: unknown } };
  const err = b.ResponseMetadata?.Error;
  if (err) {
    const code = String(err.Code ?? "");
    throw new Error(/Signature|AccessKey|Unauthorized|Auth/i.test(code) ? "BytePlus did not accept the Access Key (BYTEPLUS_ACCESS_KEY_ID and BYTEPLUS_SECRET_ACCESS_KEY)." : `BytePlus could not list the characters (${code || "error"}).`);
  }
  const items = Array.isArray(b.Result?.Items) ? b.Result.Items : [];
  const characters = items
    .filter((i) => typeof i.Id === "string" && i.Id && (i.AssetType === undefined || i.AssetType === "Image") && (i.Status === undefined || i.Status === "Active"))
    .map((i): Character => {
      const id = String(i.Id);
      return { id, name: typeof i.Name === "string" && i.Name.trim() ? i.Name.trim().slice(0, 64) : id, description: "Digital character from the BytePlus library", uri: `asset://${id}`, portraitUrl: typeof i.URL === "string" ? i.URL : null, source: "byteplus" };
    });
  return { characters, nextToken: typeof b.Result?.NextToken === "string" && b.Result.NextToken ? b.Result.NextToken : null };
}

/** The owner's picks file: ids copied from the Playground, with a name and a short description each. */
export function parsePicks(text: string): Character[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("video-lab/data/seedance-characters.json is not valid JSON. It should be a list like [{ \"id\": \"asset-...\", \"name\": \"Amani\" }].");
  }
  const list = Array.isArray(raw) ? raw : [];
  return list
    .filter((x): x is { id: string; name?: unknown; description?: unknown } => !!x && typeof (x as { id?: unknown }).id === "string" && !!(x as { id: string }).id.trim())
    .map((x) => {
      const id = x.id.trim().replace(/^asset:\/\//, "");
      return { id, name: typeof x.name === "string" && x.name.trim() ? x.name.trim().slice(0, 64) : id, description: typeof x.description === "string" ? x.description.slice(0, 200) : "Digital character from the BytePlus library", uri: `asset://${id}`, portraitUrl: null, source: "picked" as const };
    });
}

// ---- Preview characters (no key): fictional, drawn as simple cards

export const PREVIEW_CHARACTERS: (Omit<Character, "uri" | "portraitUrl" | "source"> & { skin: string; outfit: string; hair: "short" | "long" | "bun" })[] = [
  { id: "preview-amani", name: "Amani", description: "Woman in her twenties, warm and lively: shop and UGC reviews", skin: "#8d5a3b", outfit: "#e8505b", hair: "long" },
  { id: "preview-kalisa", name: "Kalisa", description: "Man in his thirties, calm and clear: phones and tech", skin: "#6b4226", outfit: "#2f6fdb", hair: "short" },
  { id: "preview-nadia", name: "Nadia", description: "Woman in her forties, friendly cook: food and restaurants", skin: "#7a4a2e", outfit: "#f2a93b", hair: "bun" },
  { id: "preview-shema", name: "Shema", description: "Man in his twenties, stylish: fashion and events", skin: "#5c3a21", outfit: "#1aa37a", hair: "short" },
  { id: "preview-imena", name: "Imena", description: "Woman in her thirties, confident: salons and services", skin: "#9a6646", outfit: "#8e44ad", hair: "bun" },
  { id: "preview-rukundo", name: "Rukundo", description: "Man in his fifties, trustworthy: real estate and schools", skin: "#4e321d", outfit: "#34495e", hair: "short" },
];

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);

/** A placeholder card for a preview character (SVG): a simple figure, the name and "Preview". */
export function previewCardSvg(id: string): string | null {
  const c = PREVIEW_CHARACTERS.find((x) => x.id === id);
  if (!c) return null;
  const hair = c.hair === "long" ? `<path d="M118 112 q82-76 164 0 v120 h-24 v-92 h-116 v92 h-24z" fill="#1d1410"/>` : c.hair === "bun" ? `<circle cx="200" cy="72" r="26" fill="#1d1410"/><path d="M128 120 q72-60 144 0z" fill="#1d1410"/>` : `<path d="M126 150 q-6-84 74-86 q80 2 74 86 q-10-46-74-50 q-64 4-74 50z" fill="#1d1410"/>`;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 500" width="400" height="500">`,
    `<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#202744"/><stop offset="1" stop-color="#0d1020"/></linearGradient></defs>`,
    `<rect width="400" height="500" fill="url(#bg)"/>`,
    `<rect x="178" y="215" width="44" height="80" fill="${c.skin}"/>`,
    `<path d="M40 500 L40 360 Q200 230 360 360 L360 500 Z" fill="${c.outfit}"/>`,
    `<ellipse cx="200" cy="160" rx="72" ry="86" fill="${c.skin}"/>`,
    hair,
    `<circle cx="174" cy="160" r="6" fill="#1d1410"/><circle cx="226" cy="160" r="6" fill="#1d1410"/><path d="M178 198 q22 16 44 0" stroke="#1d1410" stroke-width="5" fill="none" stroke-linecap="round"/>`,
    `<rect x="0" y="430" width="400" height="70" fill="#000" fill-opacity="0.55"/>`,
    `<text x="24" y="472" font-family="Arial, sans-serif" font-size="30" font-weight="700" fill="#fff">${esc(c.name)}</text>`,
    `<text x="376" y="470" text-anchor="end" font-family="Arial, sans-serif" font-size="16" font-weight="700" fill="#ffd166">PREVIEW</text>`,
    `</svg>`,
  ].join("");
}

/** The preview card as PNG (made with sharp, cached in memory). */
const cards = new Map<string, Buffer>();
export async function previewPortraitPng(id: string): Promise<Buffer | null> {
  const svg = previewCardSvg(id);
  if (!svg) return null;
  const hit = cards.get(id);
  if (hit) return hit;
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  cards.set(id, png);
  return png;
}

const previewList = (): Character[] => PREVIEW_CHARACTERS.map((c) => ({ id: c.id, name: c.name, description: c.description, uri: `asset://${c.id}`, portraitUrl: `/api/seedance/characters/${c.id}/portrait.png`, source: "preview" }));

// ---- Listing, with a cache

let cache: { at: number; list: CharacterList } | null = null;
export const clearCharacterCache = () => {
  cache = null;
};

type ListOptions = { env?: Record<string, string | undefined>; fetchImpl?: typeof fetch; picksFile?: string; now?: number };

/**
 * The presenters the studio can offer: the owner's picks from the Playground, plus the account's own digital-character
 * assets when an Access Key is set (ListAssets, AIGC group, active images); the six preview characters when there is
 * no Seedance key yet; otherwise none, with what to do. Cached 30 minutes (BytePlus's picture links last 12 hours).
 */
export async function listCharacters(o: ListOptions = {}): Promise<CharacterList> {
  const now = o.now ?? Date.now();
  if (cache && now - cache.at < CACHE_MS) return cache.list;
  const env = o.env ?? process.env;
  const notices: string[] = [];
  let picked: Character[] = [];
  try {
    picked = parsePicks(await fs.readFile(o.picksFile ?? PICKS_FILE, "utf8"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") notices.push((e as Error).message);
  }
  let listed: Character[] = [];
  const ak = env.BYTEPLUS_ACCESS_KEY_ID?.trim();
  const sk = env.BYTEPLUS_SECRET_ACCESS_KEY?.trim();
  if (ak && sk) {
    try {
      let token: string | null = null;
      for (let page = 0; page < 5; page++) {
        const body = JSON.stringify({ Filter: { GroupType: "AIGC", Statuses: ["Active"] }, MaxResults: 100, ...(token ? { NextToken: token } : {}) });
        const req = signAssetsRequest({ accessKeyId: ak, secretAccessKey: sk, action: "ListAssets", body, date: new Date(now) });
        const res = await (o.fetchImpl ?? fetch)(req.url, { method: "POST", headers: req.headers, body, signal: AbortSignal.timeout(20_000) });
        const parsed = parseListAssets(await res.json().catch(() => ({ ResponseMetadata: { Error: { Code: `HTTP ${res.status}` } } })));
        listed.push(...parsed.characters);
        token = parsed.nextToken;
        if (!token) break;
      }
    } catch (e) {
      notices.push(e instanceof Error ? e.message : "BytePlus could not list the characters.");
      listed = [];
    }
  }
  const ids = new Set(picked.map((c) => c.id));
  const characters = [...picked, ...listed.filter((c) => !ids.has(c.id))];
  let list: CharacterList;
  if (characters.length) list = { source: picked.length ? "picked" : "byteplus", characters, notice: notices.join(" ") };
  else if (!env.SEEDANCE_API_KEY?.trim()) list = { source: "preview", characters: previewList(), notice: "Preview characters: the real BytePlus characters arrive with the key. Previews cannot be used in a real Seedance video." };
  else list = { source: "none", characters: [], notice: [...notices, "No characters yet: in the ModelArk Playground open the Digital Character Library, copy the asset IDs you like into video-lab/data/seedance-characters.json, or set BYTEPLUS_ACCESS_KEY_ID and BYTEPLUS_SECRET_ACCESS_KEY to list the account's own."].join(" ") };
  cache = { at: now, list };
  return list;
}

/**
 * A character as a Seedance reference: the asset:// image, its label for the prompt writer, and the prompt line for
 * the presenter once it is numbered ("Image 2"). Preview characters are refused: they are not in BytePlus.
 */
export function characterReference(c: Pick<Character, "id" | "name" | "source">, imageNumber: number): { reference: SeedanceReference; label: string; promptLine: string } {
  if (c.source === "preview" || c.id.startsWith("preview-")) throw new Error(`${c.name} is a preview character; real BytePlus characters arrive with the key.`);
  const id = c.id.replace(/^asset:\/\//, "");
  return {
    reference: { kind: "image", url: `asset://${id}`, role: "reference_image" },
    label: `${c.name} (digital character, presenter)`,
    promptLine: `The presenter is ${c.name}, the digital character from Image ${imageNumber}: keep the same face, hair and build in every shot.`,
  };
}

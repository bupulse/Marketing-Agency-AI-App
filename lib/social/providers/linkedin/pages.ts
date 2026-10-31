import type { AccountChoice } from "../../types";

// Reads the LinkedIn Pages (organizations) a member administers out of LinkedIn's answers, the same way for BuPulse's
// own app (lib/social/providers/linkedin.ts) and BuPulse-Socials (lib/social/composio/networks.ts), so the client sees
// each Page's real name and logo in "Where should BuPulse post?" instead of a number. Pure: no calls here.
//
// The shapes LinkedIn answers with:
// - organizationAcls, plain: { elements: [{ organization: "urn:li:organization:42", role, state }] }
//   (older v2 answers say organizationalTarget instead of organization).
// - organizationAcls with a projection: the same, plus "organization~": { localizedName, logoV2: { "original~": {
//   elements: [{ data: {...StillImage: { displaySize }}, identifiers: [{ identifier: "https://media.licdn.com/..." }] }] } } }.
//   https://learn.microsoft.com/en-us/linkedin/marketing/community-management/organizations/organization-access-control-by-role
// - organizations batch get: { results: { "42": { localizedName, logoV2: { cropped, original } } } }, the logos as
//   image URNs that the Images API turns into links.
//   https://learn.microsoft.com/en-us/linkedin/marketing/community-management/organizations/organization-lookup-api
// - images batch get: { results: { "urn:li:image:X": { downloadUrl } } }.
//   https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/images-api

type Json = Record<string, unknown>;

export type LinkedInPage = {
  id: string;
  name?: string;
  /** A link to the logo the picker can show. */
  logoUrl?: string;
  /** The logo as an image URN, when only that came back (one more call turns it into a link). */
  logoUrn?: string;
};

const asObject = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const https = (v: unknown) => (typeof v === "string" && /^https:\/\//.test(v) ? v : undefined);
const ORG_URN = /^urn:li:organization:(\d+)$/;

/** Composio sometimes hands the network's answer over as JSON text. */
function parsed(data: unknown): unknown {
  if (typeof data !== "string") return data;
  try {
    return JSON.parse(data);
  } catch {
    return data;
  }
}

/** The Page's name: localizedName, else the first localized name, else a plain name. */
function nameOf(org: Json): string | undefined {
  const name = org.name;
  if (typeof name === "string") return str(name) ?? str(org.localizedName);
  const localized = Object.values(asObject(asObject(name).localized)).map(str).find(Boolean);
  return str(org.localizedName) ?? localized;
}

/** The logo link from a projected logo ("original~" or "cropped~"): the picture nearest 200 px wide. */
function projectedLogo(logo: Json): string | undefined {
  for (const key of ["cropped~", "original~"]) {
    const images = (Array.isArray(asObject(logo[key]).elements) ? (asObject(logo[key]).elements as unknown[]) : []).map(asObject);
    const options = images.flatMap((image) => {
      const url = (Array.isArray(image.identifiers) ? image.identifiers : []).map((i) => https(asObject(i).identifier)).find(Boolean);
      const still = asObject(asObject(image.data)["com.linkedin.digitalmedia.mediaartifact.StillImage"]);
      const width = Number(asObject(still.displaySize).width ?? asObject(still.storageSize).width) || 200;
      return url ? [{ url, width }] : [];
    });
    options.sort((a, b) => Math.abs(a.width - 200) - Math.abs(b.width - 200));
    if (options[0]) return options[0].url;
  }
  return undefined;
}

/** Turns a logo URN into the Images API's URN (a digitalmediaAsset id is the same picture as urn:li:image). */
export function imageUrn(urn: string): string | undefined {
  const m = /^urn:li:(?:digitalmediaAsset|image):(.+)$/.exec(urn);
  return m ? `urn:li:image:${m[1]}` : undefined;
}

/** What one organization object says about its Page. */
function pageFrom(id: string, org: Json): LinkedInPage {
  const logo = asObject(org.logoV2);
  const logoUrn = str(logo.cropped) ?? str(logo.original);
  return {
    id,
    name: nameOf(org),
    logoUrl: projectedLogo(logo) ?? https(org.logoUrl) ?? https(org.logo),
    logoUrn: logoUrn ? imageUrn(logoUrn) : undefined,
  };
}

/** Keeps what each answer knew: a later answer fills in what an earlier one lacked. */
function merge(into: Map<string, LinkedInPage>, page: LinkedInPage) {
  const before = into.get(page.id);
  into.set(page.id, { id: page.id, name: before?.name ?? page.name, logoUrl: before?.logoUrl ?? page.logoUrl, logoUrn: before?.logoUrn ?? page.logoUrn });
}

/** Every object in the answer, at any depth. */
function* objects(data: unknown): Generator<Json> {
  if (Array.isArray(data)) for (const item of data) yield* objects(item);
  else if (data && typeof data === "object") {
    yield data as Json;
    for (const value of Object.values(data)) yield* objects(value);
  }
}

/**
 * The Pages in an organizationAcls answer (plain or projected), or in any wrapper Composio puts around it: each
 * organization URN, with its name and logo when the answer has them. Ids only otherwise.
 */
export function pagesFromAcls(data: unknown): LinkedInPage[] {
  const answer = parsed(data);
  const pages = new Map<string, LinkedInPage>();
  for (const o of objects(answer)) {
    for (const key of ["organization", "organizationalTarget", "organizationTarget"]) {
      const urn = str(o[key]);
      const id = urn ? ORG_URN.exec(urn)?.[1] : undefined;
      if (id) merge(pages, pageFrom(id, asObject(o[`${key}~`])));
    }
    // A wrapper that already looked the Page up: { id: 42, localizedName: "..." }.
    const ownId = typeof o.id === "number" ? String(o.id) : str(o.id)?.replace(ORG_URN, "$1");
    if (ownId && /^\d+$/.test(ownId) && (str(o.localizedName) || str(o.vanityName))) merge(pages, pageFrom(ownId, o));
  }
  // Any organization URN left (an answer shaped some other way still gives the ids).
  for (const m of JSON.stringify(answer ?? {}).matchAll(/urn:li:organization:(\d+)/g)) if (!pages.has(m[1])) pages.set(m[1], { id: m[1] });
  return [...pages.values()];
}

/** The Pages of an organizations batch get ({ results: { id: organization } }), by id. */
export function pagesFromLookup(data: unknown): Map<string, LinkedInPage> {
  const out = new Map<string, LinkedInPage>();
  const answer = asObject(parsed(data));
  const results = asObject(answer.results ?? asObject(answer.data).results ?? asObject(answer.response_data).results);
  for (const [key, value] of Object.entries(results)) {
    const id = key.replace(ORG_URN, "$1");
    if (/^\d+$/.test(id)) out.set(id, pageFrom(id, asObject(value)));
  }
  return out;
}

/** Logo links from an images batch get ({ results: { urn: { downloadUrl } } }, or a list of images), by image URN. */
export function logosFromImages(data: unknown): Map<string, string> {
  const out = new Map<string, string>();
  const answer = parsed(data);
  for (const o of objects(answer)) {
    const results = asObject(o.results);
    for (const [urn, image] of Object.entries(results)) {
      const url = https(asObject(image).downloadUrl);
      if (url && urn.startsWith("urn:li:image:")) out.set(urn, url);
    }
    const id = str(o.id);
    const url = https(o.downloadUrl);
    if (id?.startsWith("urn:li:image:") && url && !out.has(id)) out.set(id, url);
  }
  return out;
}

/** Adds what a lookup and the logos found to the Pages. */
export function completePages(pages: LinkedInPage[], lookup: Map<string, LinkedInPage>, logos: Map<string, string> = new Map()): LinkedInPage[] {
  return pages.map((page) => {
    const found = lookup.get(page.id);
    const logoUrn = page.logoUrn ?? found?.logoUrn;
    return { id: page.id, name: page.name ?? found?.name, logoUrl: page.logoUrl ?? found?.logoUrl ?? (logoUrn ? logos.get(logoUrn) : undefined), logoUrn };
  });
}

/** The account choice for a Page. "LinkedIn Page <number>" only when LinkedIn gave no name. */
export function pageChoice(page: LinkedInPage): AccountChoice {
  return { externalAccountId: page.id, displayName: page.name ?? `LinkedIn Page ${page.id}`, avatarUrl: page.logoUrl, accountType: "organization" };
}

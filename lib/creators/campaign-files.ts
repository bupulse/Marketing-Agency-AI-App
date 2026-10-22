import "server-only";
import { prisma } from "@/lib/db";
import { GALLERY_VIDEO_BUCKET, isClipPath } from "@/lib/media/rules";
import { createAdminClient } from "@/lib/supabase/admin";
import { readFiles } from "./wizard";

// A campaign's files from the company's Photos (docs/CREATOR_CAMPAIGN_WIZARD.md, "Files" and "Look"): the cover of the
// application page, and the Images, Videos and Documents folders the creators who joined download from their portal.
// The files stay in the company's private buckets ("media", and "gallery-videos" for Gallery videos); this file signs
// short-lived links with the server's key, only for MediaAsset rows of the campaign's own company.

const LINK_SECONDS = 60 * 60;

export type SignedAsset = { id: string; name: string; kind: string; mimeType: string; bytes: number; url: string; downloadUrl: string; posterUrl: string | null };

type AssetRow = { id: string; name: string; kind: string; mimeType: string; bytes: number; path: string; posterPath: string | null };
const ASSET_SELECT = { id: true, name: true, kind: true, mimeType: true, bytes: true, path: true, posterPath: true } as const;

/** Signed links (path -> url) for paths of the company's Photos, in their buckets; a path that cannot be signed is left out. */
async function signPaths(paths: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = [...new Set(paths)];
  const groups: [string, string[]][] = [
    ["media", unique.filter((p) => !isClipPath(p))],
    [GALLERY_VIDEO_BUCKET, unique.filter(isClipPath)],
  ];
  const admin = createAdminClient();
  for (const [bucket, list] of groups) {
    if (!list.length) continue;
    const { data } = await admin.storage.from(bucket).createSignedUrls(list, LINK_SECONDS).catch(() => ({ data: null }));
    for (const d of data ?? []) if (d.path && d.signedUrl && !d.error) out.set(d.path, d.signedUrl);
  }
  return out;
}

/** "Brief.pdf" as a download name (Storage adds Content-Disposition for `download`). */
const downloadLink = (url: string, name: string) => `${url}${url.includes("?") ? "&" : "?"}download=${encodeURIComponent(name.replace(/[\r\n"]/g, "").slice(0, 120) || "file")}`;

async function signAssets(rows: AssetRow[]): Promise<SignedAsset[]> {
  const urls = await signPaths(rows.flatMap((r) => (r.posterPath ? [r.path, r.posterPath] : [r.path])));
  return rows.flatMap((r) => {
    const url = urls.get(r.path);
    if (!url) return [];
    return [{ id: r.id, name: r.name, kind: r.kind, mimeType: r.mimeType, bytes: r.bytes, url, downloadUrl: downloadLink(url, r.name), posterUrl: r.posterPath ? (urls.get(r.posterPath) ?? null) : null }];
  });
}

/** The application page's cover (photo or video), or null when none is picked or it is gone. */
export async function campaignCover(businessId: string, coverAssetId: string | null): Promise<SignedAsset | null> {
  if (!coverAssetId) return null;
  const row = await prisma.mediaAsset.findFirst({ where: { id: coverAssetId, businessId }, select: ASSET_SELECT });
  return row ? ((await signAssets([row]))[0] ?? null) : null;
}

export type CampaignFolders = { images: SignedAsset[]; videos: SignedAsset[]; documents: SignedAsset[]; driveUrl: string | null; exampleLinks: string[] };

/** The files of the campaign's three folders (newest first, 100 each at most), its Drive link and example links. */
export async function campaignFolders(businessId: string, filesValue: unknown): Promise<CampaignFolders> {
  const files = readFiles(filesValue);
  const ids = [files.imagesFolderId, files.videosFolderId, files.documentsFolderId];
  const rows = await Promise.all(
    ids.map((folderId) => (folderId ? prisma.mediaAsset.findMany({ where: { businessId, folderId }, orderBy: { createdAt: "desc" }, take: 100, select: ASSET_SELECT }) : Promise.resolve([] as AssetRow[]))),
  );
  const [images, videos, documents] = await Promise.all(rows.map(signAssets));
  return { images, videos, documents, driveUrl: files.driveUrl ?? null, exampleLinks: files.exampleLinks };
}

/**
 * What a creator who joined the campaign reads before posting: the brief, do's and don'ts, rules, mentions, formats,
 * the files and links. Null unless this profile is JOINED to it (checked here, so a guessed id opens nothing).
 */
export async function campaignKitFor(profileId: string, campaignId: string) {
  const member = await prisma.campaignCreator.findFirst({ where: { profileId, campaignId, status: "JOINED" }, select: { id: true } });
  if (!member) return null;
  const c = await prisma.creatorCampaign.findUnique({
    where: { id: campaignId },
    select: { id: true, name: true, brief: true, rules: true, dos: true, donts: true, mentions: true, formats: true, platforms: true, platformMode: true, startsOn: true, endsOn: true, files: true, businessId: true, business: { select: { name: true } }, tasks: { orderBy: { startsOn: "asc" }, select: { id: true, title: true, instructions: true, startsOn: true, endsOn: true, postsPerDay: true, platforms: true, platformMode: true, mediaKind: true } } },
  });
  if (!c) return null;
  return { campaign: c, folders: await campaignFolders(c.businessId, c.files) };
}

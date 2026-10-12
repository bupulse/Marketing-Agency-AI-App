import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { logError } from "@/lib/errors";
import { SocialError } from "@/lib/social/types";
import { ImageTooLargeError, prepareForInstagram } from "./jpeg";
import { isVideoPath } from "@/lib/visuals/post-media";
import { bucketForPath } from "./schemas";

/** Signed links stay valid for an hour when a network fetches them, and a week in reminder emails. */
export const PUBLISH_URL_SECONDS = 60 * 60;
export const EMAIL_URL_SECONDS = 7 * 24 * 60 * 60;

/** Storage client with the service key: the publisher has no signed-in user. Null when the key is not set. */
export function adminStorageClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Signs stored files (either bucket) in one request per bucket. Files that cannot be signed are left out. */
export async function signPaths(client: SupabaseClient, paths: string[], expiresInSeconds: number): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const byBucket = new Map<"media" | "designs", string[]>();
  for (const path of new Set(paths)) {
    const bucket = bucketForPath(path);
    byBucket.set(bucket, [...(byBucket.get(bucket) ?? []), path]);
  }
  await Promise.all(
    [...byBucket].map(async ([bucket, list]) => {
      const { data, error } = await client.storage.from(bucket).createSignedUrls(list, expiresInSeconds);
      if (error || !data) return;
      for (const item of data) if (item.path && item.signedUrl && !item.error) out.set(item.path, item.signedUrl);
    }),
  );
  return out;
}

/** Networks that only accept JPEG. */
export function requiresJpeg(network: string): boolean {
  return network === "instagram";
}

/** The cached JPEG copy of a stored image sits next to it. Removed with the original (design and photo deletion, account purge). */
export const jpegCopyPath = (path: string) => `${path}.jpg`;

/**
 * Like signPaths, for a network. For Instagram every image goes through prepareForInstagram (JPEG, 4:5 to 1.91:1,
 * under 8 MB). A changed image is stored once as a copy next to the original and the copy is signed; the copy is
 * reused afterwards. Images are handled one at a time, to keep memory low. `jpeg` lists the original paths whose
 * signed URL now points at a prepared JPEG. An image over the size limit fails the post with a friendly message.
 */
export async function signPathsForNetwork(
  client: SupabaseClient,
  paths: string[],
  network: string,
  expiresInSeconds: number,
): Promise<{ urls: Map<string, string>; jpeg: Set<string> }> {
  if (!requiresJpeg(network)) return { urls: await signPaths(client, paths, expiresInSeconds), jpeg: new Set() };

  const converted = new Set<string>();
  for (const path of paths) {
    // Reels are sent as they are (MP4); only images need the JPEG copy.
    if (isVideoPath(path)) continue;
    const bucket = client.storage.from(bucketForPath(path));
    const copy = jpegCopyPath(path);
    try {
      const { data: exists } = await bucket.exists(copy);
      if (exists) {
        converted.add(path);
        continue;
      }
      const { data: file, error } = await bucket.download(path);
      if (error || !file) throw error ?? new Error("Could not download the image");
      const prepared = await prepareForInstagram(new Uint8Array(await file.arrayBuffer()));
      if (!prepared) continue;
      const { error: uploadError } = await bucket.upload(copy, prepared, { contentType: "image/jpeg", upsert: true });
      if (uploadError) throw uploadError;
      converted.add(path);
    } catch (error) {
      if (error instanceof ImageTooLargeError) throw new SocialError(error.message, "invalid", "instagram");
      await logError(error, { source: "publishing.jpeg", level: "warn", path });
    }
  }

  const signed = await signPaths(client, paths.map((p) => (converted.has(p) ? jpegCopyPath(p) : p)), expiresInSeconds);
  const urls = new Map<string, string>();
  for (const p of paths) {
    const url = signed.get(converted.has(p) ? jpegCopyPath(p) : p);
    if (url) urls.set(p, url);
  }
  return { urls, jpeg: converted };
}

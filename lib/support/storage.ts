import "server-only";
import { logError } from "@/lib/errors";
import { createAdminClient } from "@/lib/supabase/admin";

// The private "support" bucket (see the migration): no Storage policies, so only the server's key issues upload tokens
// and short-lived download links. Object paths are conv/<conversationId>/<attachmentId>.<ext>.

export const SUPPORT_BUCKET = "support";
export const DOWNLOAD_SECONDS = 60 * 60;

const bucket = () => createAdminClient().storage.from(SUPPORT_BUCKET);

export async function createUploadSlot(path: string): Promise<{ signedUrl: string; token: string }> {
  const { data, error } = await bucket().createSignedUploadUrl(path);
  if (error || !data) throw error ?? new Error("createSignedUploadUrl returned nothing");
  return { signedUrl: data.signedUrl, token: data.token };
}

/** Signed links for many files at once; a file that cannot be signed (deleted, storage down) simply has none. */
export async function signedDownloadUrls(paths: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!paths.length) return out;
  try {
    const { data, error } = await bucket().createSignedUrls([...new Set(paths)], DOWNLOAD_SECONDS);
    if (error) throw error;
    for (const row of data ?? []) if (row.path && row.signedUrl && !row.error) out.set(row.path, row.signedUrl);
  } catch (error) {
    await logError(error, { source: "support.storage.sign", level: "warn" });
  }
  return out;
}

/** The stored object's size and type, or null when nothing was uploaded there. */
export async function objectInfo(path: string): Promise<{ bytes: number; mime: string | null } | null> {
  const slash = path.lastIndexOf("/");
  const { data, error } = await bucket().list(path.slice(0, slash), { search: path.slice(slash + 1), limit: 1 });
  if (error) throw error;
  const hit = data?.find((o) => o.name === path.slice(slash + 1));
  if (!hit) return null;
  const meta = (hit.metadata ?? {}) as { size?: number; mimetype?: string };
  return { bytes: Number(meta.size ?? 0), mime: meta.mimetype ?? null };
}

export async function downloadObject(path: string): Promise<Uint8Array> {
  const { data, error } = await bucket().download(path);
  if (error || !data) throw error ?? new Error("download returned nothing");
  return new Uint8Array(await data.arrayBuffer());
}

export async function removeObjects(paths: string[]): Promise<void> {
  for (let i = 0; i < paths.length; i += 100) {
    const { error } = await bucket().remove(paths.slice(i, i + 100));
    if (error) throw error;
  }
}

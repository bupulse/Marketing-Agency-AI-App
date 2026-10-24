import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

// The Training Lab's files (docs/TRAINING_LAB.md): the private Storage bucket "training-lab" (migration
// 20261031200100_training_lab), with no Storage policies, so only the server's key issues upload tokens and short-lived
// links. Paths are "<adminUserId>/<exampleId>/<name>": one folder per example, under the admin who added it.

export const TRAINING_BUCKET = "training-lab";
export const DOWNLOAD_SECONDS = 60 * 60;

const ID = /^[A-Za-z0-9-]{1,64}$/;
const NAME_MAX = 80;

/** A file name that is safe in a Storage path: lower case letters, digits, dots, dashes; the extension kept. */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const clean = base
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/-{2,}/g, "-")
    .replace(/-\./g, ".")
    .replace(/^[-.]+|[-.]+$/g, "");
  if (!clean) return "file";
  if (clean.length <= NAME_MAX) return clean;
  const dot = clean.lastIndexOf(".");
  const ext = dot > 0 && clean.length - dot <= 10 ? clean.slice(dot) : "";
  return clean.slice(0, NAME_MAX - ext.length).replace(/[-.]+$/, "") + ext;
}

/** The folder of one example's files. Throws on an id that could leave it (a slash, dots, an empty id). */
export function exampleFolder(adminUserId: string, exampleId: string): string {
  if (!ID.test(adminUserId)) throw new Error("Not an admin user id");
  if (!ID.test(exampleId)) throw new Error("Not an example id");
  return `${adminUserId}/${exampleId}/`;
}

export function examplePath(adminUserId: string, exampleId: string, fileName: string): string {
  return exampleFolder(adminUserId, exampleId) + safeFileName(fileName);
}

/** True when `path` is a file directly in this example's folder (what the browser says it uploaded is checked here). */
export function isExamplePath(path: string, adminUserId: string, exampleId: string): boolean {
  let folder: string;
  try {
    folder = exampleFolder(adminUserId, exampleId);
  } catch {
    return false;
  }
  if (!path.startsWith(folder)) return false;
  const name = path.slice(folder.length);
  return name.length > 0 && safeFileName(name) === name;
}

const bucket = () => createAdminClient().storage.from(TRAINING_BUCKET);

/** Where the browser uploads an example's file (a signed upload URL for this path). */
export async function createUploadSlot(path: string): Promise<{ signedUrl: string; token: string }> {
  const { data, error } = await bucket().createSignedUploadUrl(path);
  if (error || !data) throw error ?? new Error("createSignedUploadUrl returned nothing");
  return { signedUrl: data.signedUrl, token: data.token };
}

/** A short-lived link to an example's file, or null when it cannot be signed (deleted, storage down). */
export async function signedDownloadUrl(path: string): Promise<string | null> {
  const { data, error } = await bucket().createSignedUrl(path, DOWNLOAD_SECONDS);
  return error || !data ? null : data.signedUrl;
}

export async function removeObjects(paths: string[]): Promise<void> {
  for (let i = 0; i < paths.length; i += 100) {
    const { error } = await bucket().remove(paths.slice(i, i + 100));
    if (error) throw error;
  }
}

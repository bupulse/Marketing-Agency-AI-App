import "server-only";
import { logError } from "@/lib/errors";
import { createAdminClient } from "@/lib/supabase/admin";

// The private "mail" bucket (migration 20261123120000_mail): no Storage policies, so only the server's key reads and
// writes. Paths:
//   raw/<sha256>.eml               one raw message, shared by every copy (rule copies, forwards, two of our mailboxes)
//   att/<sha256>/<n>-<filename>    attachments of that raw message
//   out/<messageId>/<n>-<filename> attachments of mail we send
//   photos/<memberId>-<time>.jpg   profile photos (a new name each time, so browsers never show an old one)
//   backgrounds/<memberId>-<time>.jpg  a person's own background photo

export const MAIL_BUCKET = "mail";
export const LINK_SECONDS = 15 * 60;

const bucket = () => createAdminClient().storage.from(MAIL_BUCKET);

/** Stores bytes at a path; an object already there (the same raw message delivered twice) is kept as it is. */
export async function putObject(path: string, bytes: Uint8Array, contentType: string): Promise<void> {
  const { error } = await bucket().upload(path, bytes, { contentType, upsert: false });
  if (error && !/exists|duplicate/i.test(error.message)) throw error;
}

/** Stores bytes at a path, replacing what is there (profile and background photos). */
export async function putObjectReplacing(path: string, bytes: Uint8Array, contentType: string): Promise<void> {
  const { error } = await bucket().upload(path, bytes, { contentType, upsert: true });
  if (error) throw error;
}

export async function getObject(path: string): Promise<Uint8Array> {
  const { data, error } = await bucket().download(path);
  if (error || !data) throw error ?? new Error("download returned nothing");
  return new Uint8Array(await data.arrayBuffer());
}

/** A short-lived link to one object (download or preview), or null when it cannot be signed. */
export async function signedUrl(path: string, opts: { download?: string } = {}): Promise<string | null> {
  try {
    const { data, error } = await bucket().createSignedUrl(path, LINK_SECONDS, opts.download ? { download: opts.download } : undefined);
    if (error || !data) throw error ?? new Error("no signed url");
    return data.signedUrl;
  } catch (error) {
    await logError(error, { source: "mail.storage.sign", level: "warn" });
    return null;
  }
}

export async function removeObjects(paths: string[]): Promise<void> {
  for (let i = 0; i < paths.length; i += 100) {
    const { error } = await bucket().remove(paths.slice(i, i + 100));
    if (error) throw error;
  }
}

/** A file name safe inside a storage path (letters, digits, dot, dash, underscore). */
export function pathSafe(name: string): string {
  const clean = name.normalize("NFKD").replace(/[^\w.-]+/g, "_").replace(/_+/g, "_").replace(/^[._]+/, "").slice(0, 120);
  return clean || "file";
}

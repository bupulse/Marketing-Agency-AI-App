import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const BUCKETS = ["brand", "media", "designs", "gallery-videos"] as const;
export type Bucket = (typeof BUCKETS)[number];

const DEFAULT_DOWNLOAD_SECONDS = 60 * 60;

function safeFileName(name: string): string {
  const cleaned = name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || "file";
}

// Object paths always start with the owner's user id: that is what the Storage policies check.
export function buildObjectPath(
  userId: string,
  fileName: string,
  folder?: string,
): string {
  const id = globalThis.crypto.randomUUID();
  const parts = [userId, ...(folder ? [safeFileName(folder)] : [])];
  return `${parts.join("/")}/${id}-${safeFileName(fileName)}`;
}

// Signed URL the browser can upload one file to, without exposing any key. Made with the user's session, so the
// Storage policies apply (own folder, account not read-only). `service` makes it with the service key instead, for
// the few uploads the app allows while the account is read-only (the onboarding logo while the demo is pending); the
// caller has then already checked the user and built the path in their own folder.
export async function createSignedUploadUrl(bucket: Bucket, path: string, options: { service?: boolean } = {}) {
  // The gallery-videos bucket has no Storage policies: only the server's key can issue its upload tokens.
  const supabase = options.service || bucket === "gallery-videos" ? createAdminClient() : await createClient();
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUploadUrl(path);
  if (error) throw error;
  return { path: data.path, token: data.token, signedUrl: data.signedUrl };
}

export async function createSignedDownloadUrl(
  bucket: Bucket,
  path: string,
  expiresInSeconds = DEFAULT_DOWNLOAD_SECONDS,
) {
  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, expiresInSeconds);
  if (error) throw error;
  return data.signedUrl;
}

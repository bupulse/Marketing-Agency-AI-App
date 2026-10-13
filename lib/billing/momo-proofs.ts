import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { PROOF_BUCKET, PROOF_MAX_BYTES, sniffProofType, type ProofType } from "./momo-shared";

// The private "payment-proofs" Storage bucket (migration 20261017170000_payment_proofs): screenshots of Mobile Money
// confirmations. No Storage policy names it, so only the service key reaches it; every caller has already checked who
// is asking (the client whose open payment it is, or an AAL2 admin). Paths: <userId>/<paymentId>/<uuid>.<ext>.

const bucket = () => createAdminClient().storage.from(PROOF_BUCKET);

/** A one-file signed upload URL for `path` (the browser uploads straight to Storage, no key exposed). */
export async function createProofUpload(path: string): Promise<{ path: string; token: string }> {
  const { data, error } = await bucket().createSignedUploadUrl(path);
  if (error || !data) throw error ?? new Error("Storage did not issue an upload URL");
  return { path: data.path, token: data.token };
}

export class ProofFileError extends Error {}

/**
 * Checks an uploaded screenshot: it exists, is at most 5 MB, and its first bytes are a JPEG, PNG or WebP. A file that
 * fails is deleted and ProofFileError says why (safe to show); a missing file is ProofFileError too. The bytes that
 * passed are then written by the server to `verifiedPath` (never overwritten: upsert off) with the sniffed type, and the
 * upload is removed, so what the owner sees is exactly what was checked: the client's upload token cannot change it.
 */
export async function checkProofObject(path: string, verifiedPath: string): Promise<{ bytes: number; type: ProofType; path: string }> {
  const b = bucket();
  const { data, error } = await b.download(path);
  if (error || !data) throw new ProofFileError("The screenshot did not arrive. Add it again.");
  const bytes = data.size;
  const fail = async (message: string): Promise<never> => {
    await b.remove([path]).catch(() => {});
    throw new ProofFileError(message);
  };
  if (!(bytes > 0)) return fail("That screenshot is empty. Add it again.");
  if (bytes > PROOF_MAX_BYTES) return fail("The screenshot can be at most 5 MB.");
  const type = sniffProofType(new Uint8Array(await data.slice(0, 16).arrayBuffer()));
  if (!type) return fail("That file is not a JPEG, PNG or WebP image. Send a screenshot of the confirmation message.");
  const { error: copyError } = await b.upload(verifiedPath, data, { contentType: type, upsert: false });
  if (copyError) throw new ProofFileError("The screenshot could not be saved right now. Send it again.");
  await b.remove([path]).catch(() => {});
  return { bytes, type, path: verifiedPath };
}

/** Where the server keeps a checked screenshot: "verified/<userId>/<paymentId>/<uuid>.<ext>", written by the server only. */
export function verifiedProofPath(uploadPath: string): string {
  return `verified/${uploadPath}`;
}

/** The checked screenshot's bytes, re-sniffed (for the admin proxy route), or null. */
export async function readProofObject(path: string): Promise<{ bytes: Uint8Array; type: ProofType } | null> {
  try {
    const { data, error } = await bucket().download(path);
    if (error || !data || data.size > PROOF_MAX_BYTES) return null;
    const bytes = new Uint8Array(await data.arrayBuffer());
    const type = sniffProofType(bytes.subarray(0, 16));
    return type ? { bytes, type } : null;
  } catch {
    return null;
  }
}

/** A short-lived link to a screenshot. Null when Storage cannot make one. (The console uses the proxy route instead.) */
export async function proofSignedUrl(path: string, seconds = 10 * 60): Promise<string | null> {
  try {
    const { data, error } = await bucket().createSignedUrl(path, seconds);
    return error || !data ? null : data.signedUrl;
  } catch {
    return null;
  }
}

/** Best effort: an orphaned screenshot is swept again by the next run. */
export async function removeProofObjects(paths: string[]): Promise<number> {
  if (paths.length === 0) return 0;
  try {
    const { error } = await bucket().remove(paths);
    return error ? 0 : paths.length;
  } catch {
    return 0;
  }
}

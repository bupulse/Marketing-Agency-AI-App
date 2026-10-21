import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

// Company logos for the marketplace and the creator's portal: Business.logoUrl is a path in the private "brand"
// bucket, so each page gets short-lived signed links, many in one call.

/** Signed links (an hour) for these logo paths; a path that cannot be signed is left out. */
export async function logoUrls(paths: (string | null | undefined)[]): Promise<Map<string, string>> {
  const unique = [...new Set(paths.filter((p): p is string => Boolean(p)))];
  const out = new Map<string, string>();
  if (!unique.length) return out;
  const { data } = await createAdminClient()
    .storage.from("brand")
    .createSignedUrls(unique, 60 * 60)
    .catch(() => ({ data: null }));
  for (const row of data ?? []) if (row.path && row.signedUrl && !row.error) out.set(row.path, row.signedUrl);
  return out;
}

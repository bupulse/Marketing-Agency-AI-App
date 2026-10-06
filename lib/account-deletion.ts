import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/errors";
import { BUCKETS } from "@/lib/storage";

const PAGE = 100;

export type PurgeResult = { due: number; deleted: number; failed: number; filesRemoved: number };

// Admin client for Storage. Never import this anywhere that reaches the browser.
function adminClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

// Every object path under `prefix`, walking sub-folders (Storage lists folders as entries without an id).
async function listObjects(admin: SupabaseClient, bucket: string, prefix: string): Promise<string[]> {
  const paths: string[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await admin.storage.from(bucket).list(prefix, { limit: PAGE, offset });
    if (error) throw error;
    for (const entry of data ?? []) {
      const path = `${prefix}/${entry.name}`;
      if (entry.id) paths.push(path);
      else paths.push(...(await listObjects(admin, bucket, path)));
    }
    if (!data || data.length < PAGE) return paths;
  }
}

// Best effort: a failing bucket is logged and skipped so the account is still erased.
async function removeUserFiles(admin: SupabaseClient, userId: string): Promise<number> {
  let removed = 0;
  for (const bucket of BUCKETS) {
    // Errors propagate: the account is only deleted once its files are gone, otherwise the
    // files could never be found again (the purge looks users up by their account).
    const paths = await listObjects(admin, bucket, userId);
    for (let i = 0; i < paths.length; i += PAGE) {
      const chunk = paths.slice(i, i + PAGE);
      const { error } = await admin.storage.from(bucket).remove(chunk);
      if (error) throw error;
      removed += chunk.length;
    }
  }
  return removed;
}

async function stillDue(id: string, now: Date) {
  const user = await prisma.user.findFirst({ where: { id, deletionScheduledFor: { lte: now } }, select: { id: true } });
  return user !== null;
}

/**
 * Erases accounts whose 30-day grace period has ended: their Storage files, then the auth user,
 * which cascades to the User row and everything under it.
 */
export async function purgeDueAccounts(now = new Date()): Promise<PurgeResult> {
  const due = await prisma.user.findMany({
    where: { deletionScheduledFor: { lte: now } },
    select: { id: true },
  });
  const result: PurgeResult = { due: due.length, deleted: 0, failed: 0, filesRemoved: 0 };
  if (!due.length) return result;

  const admin = adminClient();
  if (!admin) {
    // Without the key the files can't be removed, so nobody is deleted; tomorrow's run retries.
    await logError(new Error("SUPABASE_SECRET_KEY is not set; accounts due for deletion were kept"), {
      source: "account-deletion",
      level: "warn",
    });
    result.failed = due.length;
    return result;
  }

  for (const { id } of due) {
    try {
      // Re-check right before erasing, so someone who just pressed "Keep my account" is safe.
      if (!(await stillDue(id, now))) continue;
      result.filesRemoved += await removeUserFiles(admin, id);
      const deleted = await prisma.$executeRaw`
        DELETE FROM auth.users a USING public."User" u
        WHERE a.id = u.id AND u.id = ${id}::uuid AND u."deletionScheduledFor" <= ${now}`;
      if (deleted > 0) result.deleted += 1;
    } catch (error) {
      result.failed += 1;
      await logError(error, { source: "account-deletion", userId: id });
    }
  }
  return result;
}

import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { prisma } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma/client";
import { logError } from "@/lib/errors";
import { BUCKETS } from "@/lib/storage";

const PAGE = 100;

export type PurgeResult = { due: number; deleted: number; failed: number; filesRemoved: number; orphansRemoved?: number };

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

// The company's invoice PDFs (private "invoices" bucket, pdf/<businessId>/). Their Invoice rows cascade with the company,
// so the files would otherwise outlive the account with the client's details on them. Errors propagate like above.
async function removeInvoiceFiles(admin: SupabaseClient, userId: string): Promise<number> {
  const business = await prisma.business.findUnique({ where: { userId }, select: { id: true } });
  if (!business) return 0;
  const paths = await listObjects(admin, "invoices", `pdf/${business.id}`);
  for (let i = 0; i < paths.length; i += PAGE) {
    const { error } = await admin.storage.from("invoices").remove(paths.slice(i, i + PAGE));
    if (error) throw error;
  }
  return paths.length;
}

// Screenshots of the account's Mobile Money payments (private "payment-proofs" bucket, <userId>/<paymentId>/,
// docs/MOMO.md). The ManualPayment rows cascade with the user. Errors propagate like above.
async function removePaymentProofs(admin: SupabaseClient, userId: string): Promise<number> {
  // The client's uploads (<userId>/...) and the server's checked copies (verified/<userId>/...).
  const paths = [...(await listObjects(admin, "payment-proofs", userId)), ...(await listObjects(admin, "payment-proofs", `verified/${userId}`))];
  for (let i = 0; i < paths.length; i += PAGE) {
    const { error } = await admin.storage.from("payment-proofs").remove(paths.slice(i, i + PAGE));
    if (error) throw error;
  }
  return paths.length;
}

// The company's voiceovers (media bucket, voice/<businessId>/, docs/VOICE_AND_MUSIC.md): kept by company, not by user,
// so the user-folder sweep above does not reach them. Errors propagate like above.
async function removeVoiceFiles(admin: SupabaseClient, userId: string): Promise<number> {
  const business = await prisma.business.findUnique({ where: { userId }, select: { id: true } });
  if (!business) return 0;
  const paths = await listObjects(admin, "media", `voice/${business.id}`);
  for (let i = 0; i < paths.length; i += PAGE) {
    const { error } = await admin.storage.from("media").remove(paths.slice(i, i + PAGE));
    if (error) throw error;
  }
  return paths.length;
}

async function stillDue(id: string, now: Date) {
  const user = await prisma.user.findFirst({ where: { id, deletionScheduledFor: { lte: now } }, select: { id: true } });
  return user !== null;
}

/** A paid subscription that will charge again: erasing the account would orphan it at the provider. */
async function stillBilling(id: string) {
  const sub = await prisma.subscription.findUnique({
    where: { userId: id },
    select: { providerSubscriptionId: true, status: true, cancelAtPeriodEnd: true },
  });
  return Boolean(sub?.providerSubscriptionId && !sub.cancelAtPeriodEnd && (sub.status === "ACTIVE" || sub.status === "PAST_DUE"));
}

/**
 * Erases accounts whose 30-day grace period has ended: their Storage files, then the auth user,
 * which cascades to the User row and everything under it.
 */
export async function purgeDueAccounts(now = new Date()): Promise<PurgeResult> {
  const result = await purgeDue(now);
  try {
    result.orphansRemoved = await sweepOrphanLogins(now);
  } catch (error) {
    await logError(error, { source: "account-deletion.orphans" });
  }
  return result;
}

async function purgeDue(now: Date): Promise<PurgeResult> {
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
      if (await stillBilling(id)) {
        // Deletion cancels billing up front; if that ever didn't stick, keep the account and alert.
        result.failed += 1;
        await logError(new Error("Account due for deletion still has an active paid subscription"), {
          source: "account-deletion.billing",
          userId: id,
        });
        continue;
      }
      // A company account takes its teammates' sign-ins with it (they exist only for this company); a teammate leaving
      // alone has nobody here and no files of their own, so this is empty and the rest of the steps still apply.
      const teammates = (
        await prisma.membership.findMany({ where: { business: { userId: id }, userId: { not: id } }, select: { userId: true } })
      ).map((m) => m.userId);
      result.filesRemoved += await removeUserFiles(admin, id);
      result.filesRemoved += await removeInvoiceFiles(admin, id);
      result.filesRemoved += await removeVoiceFiles(admin, id);
      result.filesRemoved += await removePaymentProofs(admin, id);
      // Teammates go BEFORE the company account: once it is deleted their memberships cascade away, and a failure after that
      // would leave logins that belong to no company for good. A failure here is retried tomorrow, with the company still intact.
      // The last re-check keeps them safe if the owner pressed "Keep" while files were being removed.
      if (!(await stillDue(id, now))) continue;
      for (const teammateId of teammates) await eraseTeammateLogin(teammateId);
      // Admin records about this user stay as a trail but lose their personal details (free-text reasons, before/after values).
      await prisma.$executeRaw`SELECT public.redact_audit_for_user(${id})`;
      // Private admin notes about the client (no foreign key, so they would otherwise outlive the account).
      await prisma.adminNote.deleteMany({ where: { userId: id } });
      await unlinkAnalytics(id);
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

/** Product analytics events lose every link to the person (user, business, visit session, properties); the counts stay. */
async function unlinkAnalytics(userId: string) {
  const business = await prisma.business.findUnique({ where: { userId }, select: { id: true } });
  await prisma.analyticsEvent.updateMany({
    where: { OR: [{ userId }, ...(business ? [{ businessId: business.id }] : [])] },
    data: { userId: null, businessId: null, sessionId: null, props: Prisma.DbNull },
  });
}

/**
 * Everything that must go when a teammate leaves; shared by removal, the admin console, account deletion and the orphan sweep.
 * Their own Storage folder (their login id, not the company's) is emptied, the invitations they sent die with them, and their
 * records lose their personal details before the sign-in itself is deleted.
 */
export async function eraseTeammateLogin(userId: string, db: Pick<typeof prisma, "$executeRaw" | "adminNote" | "analyticsEvent" | "invite"> = prisma) {
  const admin = adminClient();
  if (admin) await removeUserFiles(admin, userId);
  await db.invite.deleteMany({ where: { invitedBy: userId, acceptedAt: null } });
  await db.$executeRaw`SELECT public.redact_audit_for_user(${userId})`;
  await db.adminNote.deleteMany({ where: { userId } });
  await db.analyticsEvent.updateMany({ where: { userId }, data: { userId: null, sessionId: null, props: Prisma.DbNull } });
  await db.$executeRaw`DELETE FROM auth.users WHERE id = ${userId}::uuid`;
}

/**
 * Logins that belong to no company (no membership and no business) for over a day: a teammate whose company was erased
 * half way, or a sign-up that never finished. Nothing can be done with them, so they are erased like any removed teammate.
 */
export async function sweepOrphanLogins(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT u."id"::text AS id FROM "User" u
    WHERE u."createdAt" < ${cutoff}
      AND NOT EXISTS (SELECT 1 FROM "Membership" m WHERE m."userId" = u."id")
      AND NOT EXISTS (SELECT 1 FROM "Business" b WHERE b."userId" = u."id")
    LIMIT 100`;
  for (const { id } of rows) await eraseTeammateLogin(id);
  return rows.length;
}

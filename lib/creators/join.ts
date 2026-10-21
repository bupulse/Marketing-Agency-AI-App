import "server-only";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/errors";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashToken } from "@/lib/team/service";

// A selected creator's invite link, /creator/join/<token> (docs/CREATOR_CAMPAIGNS.md, "People and links"). Single
// use, 14 days, only the sha-256 of the token stored (CampaignCreator.inviteTokenHash), like team invites. A new email
// gets a creator login (already confirmed: the link proves they own the address); an email that has a BuPulse login
// signs in first and the campaign is added to their profile. Either way the claim (SELECTED -> JOINED) is one
// conditional update, so a link opened twice at once joins once.

export type JoinErrorCode = "invalid" | "not_found" | "expired" | "used" | "exists" | "wrong_account";

export class JoinError extends Error {
  constructor(public code: JoinErrorCode, message: string) {
    super(message);
    this.name = "JoinError";
  }
}

const TOKEN = /^[A-Za-z0-9_-]{32,128}$/;

export type JoinPreview =
  | { status: "valid"; email: string; name: string; campaignName: string; companyName: string; hasLogin: boolean }
  | { status: "expired" | "used" | "unknown" };

async function inviteRow(token: string) {
  if (!TOKEN.test(token)) return null;
  return prisma.campaignCreator.findUnique({
    where: { inviteTokenHash: await hashToken(token) },
    select: { id: true, status: true, email: true, name: true, phone: true, inviteExpiresAt: true, profileId: true, campaign: { select: { name: true, business: { select: { name: true } } } } },
  });
}

export async function previewJoin(token: string, now = new Date()): Promise<JoinPreview> {
  const row = await inviteRow(token);
  if (!row) return { status: "unknown" };
  if (row.status === "JOINED") return { status: "used" };
  if (row.status !== "SELECTED") return { status: "unknown" };
  if (!row.inviteExpiresAt || row.inviteExpiresAt <= now) return { status: "expired" };
  const login = await prisma.user.findUnique({ where: { email: row.email }, select: { id: true } });
  return { status: "valid", email: row.email, name: row.name, campaignName: row.campaign.name, companyName: row.campaign.business.name, hasLogin: Boolean(login) };
}

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/** SELECTED -> JOINED for this link, only once, only while it is open. False when someone else got there first. */
async function claim(tx: Tx, id: string, tokenHash: string, profileId: string, now: Date): Promise<boolean> {
  const claimed = await tx.campaignCreator.updateMany({
    where: { id, status: "SELECTED", inviteTokenHash: tokenHash, inviteExpiresAt: { gt: now } },
    data: { status: "JOINED", joinedAt: now, profileId },
  });
  return claimed.count === 1;
}

async function openRow(token: string, now: Date) {
  const row = await inviteRow(token);
  if (!row) throw new JoinError("not_found", "This invitation link is not valid.");
  if (row.status === "JOINED") throw new JoinError("used", "This invitation was already used. Sign in to see the campaign.");
  if (row.status !== "SELECTED") throw new JoinError("not_found", "This invitation is no longer valid. Ask the company for a new one.");
  if (!row.inviteExpiresAt || row.inviteExpiresAt <= now) throw new JoinError("expired", "This invitation has expired. Ask the company to send a new one.");
  return row;
}

/**
 * Joins as a NEW person: their sign-in (confirmed), User row (no Business, no Membership), creator profile and the
 * campaign, in one go. The caller signs them in with the password afterwards.
 */
export async function joinAsNewCreator(token: string, input: { name: string; password: string }, now = new Date()): Promise<{ email: string }> {
  const name = input.name.trim().slice(0, 100);
  if (!name) throw new JoinError("invalid", "Enter your name.");
  if (input.password.length < 8 || input.password.length > 128) throw new JoinError("invalid", "Use a password with at least 8 characters.");
  const row = await openRow(token, now);
  const tokenHash = await hashToken(token);
  if (await prisma.user.findUnique({ where: { email: row.email }, select: { id: true } })) throw new JoinError("exists", "This email already has a BuPulse login. Sign in to add the campaign to it.");

  const admin = createAdminClient();
  const created = await admin.auth.admin.createUser({ email: row.email, password: input.password, email_confirm: true, user_metadata: { full_name: name, creator: true } });
  if (created.error || !created.data.user) {
    // Two tabs at once: the other one made the login a moment ago and is claiming the link; else the address has a
    // sign-in of its own (from another sign-up), and the person signs in with it.
    if (created.error?.code === "email_exists") {
      const claimed = async () => (await prisma.campaignCreator.findUnique({ where: { id: row.id }, select: { status: true } }))?.status === "JOINED";
      const fresh = await prisma.$queryRaw<{ fresh: boolean }[]>`
        SELECT (raw_user_meta_data->>'creator' = 'true' AND created_at > now() - interval '60 seconds') AS fresh
        FROM auth.users WHERE lower(email) = ${row.email} LIMIT 1`;
      if (fresh[0]?.fresh) for (let i = 0; i < 12 && !(await claimed()); i++) await new Promise((r) => setTimeout(r, 500));
      if (await claimed()) throw new JoinError("used", "This invitation was already used. Sign in to see the campaign.");
      throw new JoinError("exists", "This email already has a BuPulse login. Sign in to add the campaign to it.");
    }
    if (created.error?.code === "weak_password") throw new JoinError("invalid", "That password is too easy to guess. Try a longer one.");
    await logError(created.error ?? new Error("createUser returned no user"), { source: "creators.join" });
    throw new JoinError("invalid", "We could not create your login. Please try again.");
  }
  const authId = created.data.user.id;
  try {
    await prisma.$transaction(async (tx) => {
      await tx.user.create({ data: { id: authId, email: row.email, name, signUpMethod: "PASSWORD" } });
      const profile = await tx.creatorProfile.create({ data: { userId: authId, name, phone: row.phone } });
      if (!(await claim(tx, row.id, tokenHash, profile.id, now))) throw new JoinError("used", "This invitation was already used. Sign in to see the campaign.");
    });
  } catch (error) {
    await admin.auth.admin.deleteUser(authId).catch(() => {});
    if (error instanceof JoinError) throw error;
    await logError(error, { source: "creators.join" });
    throw new JoinError("invalid", "We could not finish joining. Please try again.");
  }
  return { email: row.email };
}

/**
 * Adds the campaign to the signed-in person's creator profile (made now when they have none: a company person can be
 * a creator too). The link was sent to the application's email, so only that login may use it.
 */
export async function joinWithLogin(token: string, user: { id: string; email?: string | null }, now = new Date()): Promise<void> {
  const row = await openRow(token, now);
  if ((user.email ?? "").trim().toLowerCase() !== row.email) throw new JoinError("wrong_account", `This invitation is for ${row.email}. Sign out, then sign in with that email.`);
  const tokenHash = await hashToken(token);
  await prisma.$transaction(async (tx) => {
    const account = await tx.user.findUnique({ where: { id: user.id }, select: { name: true } });
    const profile = await tx.creatorProfile.upsert({ where: { userId: user.id }, create: { userId: user.id, name: account?.name?.trim() || row.name, phone: row.phone }, update: {} });
    if (!(await claim(tx, row.id, tokenHash, profile.id, now))) throw new JoinError("used", "This invitation was already used.");
  });
}

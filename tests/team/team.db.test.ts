import crypto, { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Teams against the real database, Auth and Storage, so it is skipped unless asked for:
//   RUN_DB_TESTS=1 node --env-file=.env node_modules/vitest/vitest.mjs run tests/team/team.db.test.ts
// It creates throwaway companies and users (delivered+...@resend.dev) and removes them afterwards. Email is captured, not sent.
const enabled = Boolean(process.env.RUN_DB_TESTS && process.env.DATABASE_URL && process.env.SUPABASE_SECRET_KEY && process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
const url = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
const admin = enabled ? createClient(url, process.env.SUPABASE_SECRET_KEY as string, { auth: { persistSession: false, autoRefreshToken: false } }) : null;

const mails = vi.hoisted(() => [] as { to: string; text: string }[]);
vi.mock("@/lib/publishing/email", async (orig) => ({
  ...(await orig<typeof import("@/lib/publishing/email")>()),
  sendEmail: async (e: { to: string; text: string }) => {
    mails.push(e);
    return true;
  },
}));

const tag = randomUUID().slice(0, 8);
const addr = (n: string) => `delivered+tm${tag}${n}@resend.dev`;
const PASSWORD = "Teamtest123";

describe.skipIf(!enabled)("teams against Supabase", { timeout: 120_000 }, () => {
  let prisma: typeof import("@/lib/db").prisma;
  const made: string[] = [];
  const A = { owner: randomUUID(), biz: `tmA${tag}` };
  const B = { owner: randomUUID(), biz: `tmB${tag}` };
  const C = { owner: randomUUID(), biz: `tmC${tag}` };

  async function company(c: { owner: string; biz: string }, label: string, plan: string) {
    const email = addr(label);
    const { error } = await admin!.auth.admin.createUser({ id: c.owner, email, password: PASSWORD, email_confirm: true });
    if (error) throw error;
    made.push(c.owner);
    await prisma.user.create({ data: { id: c.owner, email, name: `Owner ${label}` } });
    await prisma.business.create({ data: { id: c.biz, userId: c.owner, name: `Co ${label}`, widgetKey: `k${c.owner.replace(/-/g, "")}`.slice(0, 20) } as never });
    await prisma.membership.create({ data: { businessId: c.biz, userId: c.owner, role: "OWNER" } });
    const now = new Date();
    await prisma.subscription.create({ data: { userId: c.owner, plan, status: "ACTIVE", currentPeriodStart: now, currentPeriodEnd: new Date(now.getTime() + 30 * 864e5) } as never });
    return { email };
  }
  const actorOf = async (userId: string) => {
    const { resolveCompany } = await import("@/lib/team/company");
    const c = (await resolveCompany(userId))!;
    return { actorId: userId, id: c.ownerId, role: c.role, businessId: c.businessId };
  };
  const tokenFrom = (to: string) => /\/invite\/([0-9a-f]{64})/.exec([...mails].reverse().find((m) => m.to === to)!.text)![1];

  beforeAll(async () => {
    ({ prisma } = await import("@/lib/db"));
    await company(A, "a", "STANDARD");
    await company(B, "b", "STANDARD");
    await company(C, "c", "PRO");
  });

  /** A teammate created directly (no invitation), with a real password so a session can be opened for them. */
  async function joinMember(co: { biz: string }, label: string, role: "ADMIN" | "MEMBER") {
    const email = addr(label);
    const { data, error } = await admin!.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
    if (error) throw error;
    made.push(data.user.id);
    await prisma.user.create({ data: { id: data.user.id, email, name: label } });
    await prisma.membership.create({ data: { businessId: co.biz, userId: data.user.id, role } });
    return { id: data.user.id, email };
  }
  const sessionFor = async (email: string) => {
    const c = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string, { auth: { persistSession: false, autoRefreshToken: false } });
    const r = await c.auth.signInWithPassword({ email, password: PASSWORD });
    expect(r.error).toBeNull();
    return c;
  };

  afterAll(async () => {
    for (const id of made) {
      await admin!.storage.from("media").remove([`${id}/ok.png`, `${id}/foreign.png`]);
      await prisma.user.deleteMany({ where: { id } });
      await admin!.auth.admin.deleteUser(id);
    }
    await prisma.$disconnect();
  });

  it("migration: every business has exactly one OWNER, and it is the company account's user", async () => {
    const rows = await prisma.$queryRaw<{ id: string; owners: number; accountOwner: number }[]>`
      SELECT b."id", count(m.*) FILTER (WHERE m."role" = 'OWNER')::int AS owners,
             count(m.*) FILTER (WHERE m."role" = 'OWNER' AND m."userId" = b."userId")::int AS "accountOwner"
      FROM "Business" b LEFT JOIN "Membership" m ON m."businessId" = b."id" GROUP BY b."id"`;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.filter((r) => r.owners !== 1 || r.accountOwner !== 1)).toEqual([]);
  });

  let memberId = "";
  const memberMail = addr("m1");

  it("invite -> accept: a new person joins, signs in and shares the company", async () => {
    const { createInvite, previewInvite, acceptInvite } = await import("@/lib/team/service");
    const owner = await actorOf(A.owner);
    const invite = await createInvite(owner, { email: memberMail, role: "MEMBER" });
    expect(invite.sent).toBe(true);
    const token = tokenFrom(memberMail);
    expect(await previewInvite(token)).toMatchObject({ status: "valid", email: memberMail, role: "MEMBER" });
    await acceptInvite(token, { name: "Mia Member", password: PASSWORD });
    const user = await prisma.user.findUnique({ where: { email: memberMail } });
    memberId = user!.id;
    made.push(memberId);
    expect(await prisma.membership.findUnique({ where: { userId: memberId } })).toMatchObject({ businessId: A.biz, role: "MEMBER" });
    // single use
    expect(await previewInvite(token)).toEqual({ status: "used" });
    await expect(acceptInvite(token, { name: "Again", password: PASSWORD })).rejects.toMatchObject({ code: "used" });
  });

  it("expired invitations cannot be opened or accepted", async () => {
    const { createInvite, previewInvite, acceptInvite } = await import("@/lib/team/service");
    const email = addr("exp");
    await createInvite(await actorOf(A.owner), { email, role: "MEMBER" });
    const token = tokenFrom(email);
    await prisma.invite.updateMany({ where: { businessId: A.biz, email }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await previewInvite(token)).toEqual({ status: "expired" });
    await expect(acceptInvite(token, { name: "Late", password: PASSWORD })).rejects.toMatchObject({ code: "expired" });
    await prisma.invite.deleteMany({ where: { businessId: A.biz, email } });
  });

  it("someone who already belongs to another company cannot join", async () => {
    const { acceptInvite } = await import("@/lib/team/service");
    const ownerB = (await prisma.user.findUnique({ where: { id: B.owner } }))!.email;
    // createInvite refuses such an address up front (next block); here the account appeared AFTER the invitation was sent.
    const token = crypto.randomBytes(32).toString("hex");
    await prisma.invite.create({ data: { businessId: A.biz, email: ownerB, role: "MEMBER", tokenHash: crypto.createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 864e5) } });
    await expect(acceptInvite(token, { name: "Bee", password: PASSWORD })).rejects.toMatchObject({ code: "other_company" });
    await prisma.invite.deleteMany({ where: { businessId: A.biz, email: ownerB } });
  });

  it("seat limit: Standard allows 3 users counting open invitations", async () => {
    const { createInvite } = await import("@/lib/team/service");
    const owner = await actorOf(A.owner);
    await createInvite(owner, { email: addr("s1"), role: "MEMBER" }); // owner + member + this = 3
    await expect(createInvite(owner, { email: addr("s2"), role: "MEMBER" })).rejects.toMatchObject({ code: "seats" });
    await prisma.invite.deleteMany({ where: { businessId: A.biz } });
  });

  it("a Member can invite nobody and cannot touch the team", async () => {
    const { createInvite, removeMember, changeRole, transferOwnership } = await import("@/lib/team/service");
    const member = await actorOf(memberId);
    expect(member).toMatchObject({ id: A.owner, role: "MEMBER" });
    await expect(createInvite(member, { email: addr("x"), role: "MEMBER" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(removeMember(member, A.owner)).rejects.toMatchObject({ code: "forbidden" });
    await expect(changeRole(member, A.owner, "MEMBER")).rejects.toMatchObject({ code: "forbidden" });
    await expect(transferOwnership(member, memberId)).rejects.toMatchObject({ code: "forbidden" });
  });

  it("members see their company's data and spend its credits; other companies see nothing of it", async () => {
    const { consumeUsage, getUsageSummary } = await import("@/lib/usage");
    await prisma.design.create({ data: { id: `d${tag}`, businessId: A.biz, kind: "TEMPLATE", aspectRatio: "1:1", path: `${A.owner}/designs/x.png`, width: 1, height: 1 } });
    await prisma.project.create({ data: { id: `p${tag}`, businessId: A.biz, type: "product", title: "Shared project", features: [], photoPaths: [] } });
    const member = await actorOf(memberId);
    const other = await actorOf(B.owner);
    expect(other.id).not.toBe(member.id);
    const seen = async (a: { id: string }) => ({
      designs: await prisma.design.count({ where: { id: `d${tag}`, business: { userId: a.id } } }),
      projects: await prisma.project.count({ where: { id: `p${tag}`, business: { userId: a.id } } }),
    });
    expect(await seen(member)).toEqual({ designs: 1, projects: 1 });
    expect(await seen(other)).toEqual({ designs: 0, projects: 0 });

    const before = (await getUsageSummary(member.id)).used.text;
    await consumeUsage(member.id, "text"); // what an action does with requireActiveUser().id
    expect((await getUsageSummary(A.owner)).used.text).toBe(before + 1);
    expect((await getUsageSummary(B.owner)).used.text).toBe(0);
    expect(await prisma.usageRecord.count({ where: { userId: memberId } })).toBe(0);
    expect(await prisma.subscription.count({ where: { userId: memberId } })).toBe(0);
  });

  it("storage: a member reads and writes the company folder and nobody else's", async () => {
    const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
    await admin!.storage.from("media").upload(`${B.owner}/foreign.png`, png, { contentType: "image/png", upsert: true });
    const session = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string, { auth: { persistSession: false, autoRefreshToken: false } });
    const signed = await session.auth.signInWithPassword({ email: memberMail, password: PASSWORD });
    expect(signed.error).toBeNull();
    const bucket = session.storage.from("media");
    expect((await bucket.upload(`${A.owner}/ok.png`, png, { contentType: "image/png", upsert: true })).error).toBeNull();
    expect((await bucket.download(`${A.owner}/ok.png`)).error).toBeNull();
    expect((await bucket.upload(`${B.owner}/denied.png`, png, { contentType: "image/png" })).error).not.toBeNull();
    expect((await bucket.download(`${B.owner}/foreign.png`)).error).not.toBeNull();
    // the folder helper answers only for the caller: it takes no uid, so nobody can ask for another user's company
    const own = await session.rpc("bupulse_company_folder");
    expect(own.data).toBe(A.owner);
    const probe = await session.rpc("bupulse_company_folder", { uid: B.owner });
    expect(probe.error).not.toBeNull();
    // their own login folder also stays theirs alone
    expect((await bucket.upload(`${B.owner}/foreign.png`, png, { contentType: "image/png", upsert: true })).error).not.toBeNull();
  });

  it("owner: role change, transfer, then removal deletes the teammate's sign-in", async () => {
    const { changeRole, transferOwnership, removeMember } = await import("@/lib/team/service");
    const owner = await actorOf(A.owner);
    await changeRole(owner, memberId, "ADMIN");
    expect((await prisma.membership.findUnique({ where: { userId: memberId } }))!.role).toBe("ADMIN");
    await expect(removeMember(owner, A.owner)).rejects.toMatchObject({ code: "forbidden" });
    await transferOwnership(owner, memberId);
    const roles = await prisma.membership.findMany({ where: { businessId: A.biz }, select: { userId: true, role: true } });
    expect(roles.find((r) => r.userId === memberId)!.role).toBe("OWNER");
    expect(roles.find((r) => r.userId === A.owner)!.role).toBe("ADMIN");
    // billing and files stay on the company account
    expect((await prisma.business.findUnique({ where: { id: A.biz } }))!.userId).toBe(A.owner);
    // the new owner (an Owner who is not the account) gets the company subject through resolveCompany
    expect(await actorOf(memberId)).toMatchObject({ id: A.owner, role: "OWNER" });
    // the former owner is now an Admin and can remove the new owner? no: the Owner is protected
    await expect(removeMember(await actorOf(A.owner), memberId)).rejects.toMatchObject({ code: "forbidden" });
    await transferOwnership(await actorOf(memberId), A.owner); // hand it back
    await removeMember(await actorOf(A.owner), memberId);
    expect(await prisma.user.findUnique({ where: { id: memberId } })).toBeNull();
    expect((await admin!.auth.admin.getUserById(memberId)).data.user).toBeNull();
    made.splice(made.indexOf(memberId), 1);
  });

  describe("integrity", () => {
    it("a company can never have two owners", async () => {
      const m = await joinMember(C, "own2", "MEMBER");
      await expect(prisma.membership.update({ where: { userId: m.id }, data: { role: "OWNER" } })).rejects.toThrow();
      await prisma.user.deleteMany({ where: { id: m.id } });
      made.splice(made.indexOf(m.id), 1);
      await admin!.auth.admin.deleteUser(m.id);
    });

    it("two invitations racing for the last seat: exactly one wins", async () => {
      const { createInvite } = await import("@/lib/team/service");
      const owner = await actorOf(C.owner);
      // PRO has 10 seats: fill 8, leaving one free for the owner, then race two invitations
      const fillers = [];
      for (let i = 0; i < 8; i++) fillers.push(await prisma.invite.create({ data: { businessId: C.biz, email: addr(`f${i}`), role: "MEMBER", tokenHash: `${tag}fill${i}`.padEnd(64, "0"), expiresAt: new Date(Date.now() + 864e5) } }));
      const results = await Promise.allSettled([createInvite(owner, { email: addr("r1"), role: "MEMBER" }), createInvite(owner, { email: addr("r2"), role: "MEMBER" })]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const lost = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
      expect(lost.reason).toMatchObject({ code: "seats" });
      await prisma.invite.deleteMany({ where: { businessId: C.biz } });
    });

    it("invitations die with their sender's rights; team changes are audited under the company", async () => {
      const { createInvite, changeRole, removeMember, previewInvite, acceptInvite } = await import("@/lib/team/service");
      const adminUser = await joinMember(C, "adm1", "ADMIN");
      const adminUser2 = await joinMember(C, "adm2", "ADMIN");
      const owner = await actorOf(C.owner);
      await createInvite(await actorOf(adminUser.id), { email: addr("i1"), role: "MEMBER" });
      const t1 = tokenFrom(addr("i1"));
      await createInvite(await actorOf(adminUser2.id), { email: addr("i2"), role: "MEMBER" });
      const t2 = tokenFrom(addr("i2"));
      expect((await previewInvite(t1)).status).toBe("valid");
      await changeRole(owner, adminUser.id, "MEMBER"); // demoted: the invitations they sent are deleted
      expect(await previewInvite(t1)).toEqual({ status: "unknown" });
      await expect(acceptInvite(t1, { name: "Nope", password: PASSWORD })).rejects.toBeTruthy();
      await removeMember(owner, adminUser2.id); // removed: the same
      expect(await previewInvite(t2)).toEqual({ status: "unknown" });
      const rows = await prisma.auditLog.findMany({ where: { target: `company:${C.biz}` }, select: { actor: true, action: true, before: true, after: true } });
      const actions = rows.map((r) => r.action);
      expect(actions).toEqual(expect.arrayContaining(["team_invite", "team_change_role", "team_remove_member"]));
      expect(rows.every((r) => r.actor === `user:${C.owner}` || r.actor.startsWith("user:"))).toBe(true);
      // the removal row survived the erase of the person it is about, and holds no full email
      const removal = rows.find((r) => r.action === "team_remove_member")!;
      expect(JSON.stringify(removal)).not.toContain(adminUser2.email);
      made.splice(made.indexOf(adminUser2.id), 1);
    });

    it("an address that already has an account cannot be invited; a lost accept race says 'used'", async () => {
      const { createInvite, acceptInvite } = await import("@/lib/team/service");
      const owner = await actorOf(C.owner);
      await expect(createInvite(owner, { email: (await prisma.user.findUnique({ where: { id: B.owner } }))!.email, role: "MEMBER" })).rejects.toMatchObject({ code: "other_company" });
      const email = addr("race");
      await createInvite(owner, { email, role: "MEMBER" });
      const token = tokenFrom(email);
      const results = await Promise.allSettled([acceptInvite(token, { name: "A", password: PASSWORD }), acceptInvite(token, { name: "B", password: PASSWORD })]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason).toMatchObject({ code: "used" });
      const joined = await prisma.user.findUnique({ where: { email } });
      if (joined) made.push(joined.id);
    });

    it("brand files (the logo) can be changed by Owner and Admins only; Members can read them", async () => {
      const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
      const member = await joinMember(C, "mem9", "MEMBER");
      const adm = await joinMember(C, "adm9", "ADMIN");
      await admin!.storage.from("brand").upload(`${C.owner}/logo.png`, png, { contentType: "image/png", upsert: true });
      const asMember = (await sessionFor(member.email)).storage.from("brand");
      const asAdmin = (await sessionFor(adm.email)).storage.from("brand");
      expect((await asMember.download(`${C.owner}/logo.png`)).error).toBeNull();
      expect((await asMember.upload(`${C.owner}/logo.png`, png, { contentType: "image/png", upsert: true })).error).not.toBeNull();
      expect((await asMember.remove([`${C.owner}/logo.png`])).data ?? []).toHaveLength(0);
      expect((await asAdmin.upload(`${C.owner}/logo2.png`, png, { contentType: "image/png" })).error).toBeNull();
      // a member can still upload project photos to the media bucket
      expect((await (await sessionFor(member.email)).storage.from("media").upload(`${C.owner}/p.png`, png, { contentType: "image/png", upsert: true })).error).toBeNull();
      await admin!.storage.from("brand").remove([`${C.owner}/logo.png`, `${C.owner}/logo2.png`]);
      await admin!.storage.from("media").remove([`${C.owner}/p.png`]);
    });
  });
});

import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { isAdminEmail } from "@/lib/admin/auth";
import { prisma } from "@/lib/db";
import { createClient } from "@/lib/supabase/server";
import { canUseMail, isMailAdmin, sendableDepartmentIds, visibleMailboxIds, type Viewer } from "./access-rules";

// The B Mail page and action guard (docs/MAIL_CRM.md "Mail console": the normal BuPulse sign-in plus the authenticator
// code). Served at /mail on bupulse.com (mail.bupulse.com later). Every page and server action calls requireMail().

export type MailMe = {
  userId: string;
  email: string;
  name: string;
  memberId: string | null;
  isOwner: boolean;
  isAdmin: boolean;
  /** Mailboxes this person sees and may send from. */
  mailboxIds: string[];
  /** Departments this person may send to as a whole. */
  departmentIds: string[];
  photoPath: string | null;
  prefs: Record<string, unknown>;
};

type Gate = { ok: true; me: MailMe } | { ok: false; to: "login" | "no-access" | "verify" | "setup" };

async function gate(): Promise<Gate> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  const user = !error ? data.user : null;
  if (!user?.email) return { ok: false, to: "login" };
  const email = user.email.trim().toLowerCase();
  const isOwner = isAdminEmail(email);
  const member = await prisma.mailMember.findUnique({
    where: { email },
    select: { id: true, name: true, role: true, departmentId: true, status: true, mail: true, userId: true, photoPath: true, prefs: true, access: { select: { mailboxId: true } } },
  });
  if (member?.userId && member.userId !== user.id) return { ok: false, to: "no-access" };
  const viewer: Viewer = { isOwner, member: member ? { id: member.id, role: member.role, departmentId: member.departmentId, status: member.status, mail: member.mail } : null, grants: member?.access.map((a) => a.mailboxId) ?? [] };
  if (!canUseMail(viewer)) return { ok: false, to: "no-access" };

  const [aal, factors] = await Promise.all([supabase.auth.mfa.getAuthenticatorAssuranceLevel(), supabase.auth.mfa.listFactors()]);
  const hasTotp = !!factors.data?.totp?.some((f) => f.status === "verified");
  if (!hasTotp) return { ok: false, to: "setup" };
  if (aal.data?.currentLevel !== "aal2") return { ok: false, to: "verify" };

  const [mailboxes, departments] = await Promise.all([
    prisma.mailbox.findMany({ select: { id: true, kind: true, visibility: true, departmentId: true, memberId: true } }),
    prisma.mailDepartment.findMany({ select: { id: true, headMemberId: true } }),
  ]);
  // First full sign-in of an invited member: link the login and mark them active.
  if (member && (member.status === "invited" || !member.userId)) {
    await prisma.mailMember.update({ where: { id: member.id }, data: { userId: user.id, status: member.status === "invited" ? "active" : member.status } }).catch(() => undefined);
  }
  return {
    ok: true,
    me: {
      userId: user.id,
      email,
      name: member?.name || (user.user_metadata?.full_name as string | undefined) || email.split("@")[0],
      memberId: member?.id ?? null,
      isOwner,
      isAdmin: isMailAdmin(viewer),
      mailboxIds: visibleMailboxIds(viewer, mailboxes),
      departmentIds: sendableDepartmentIds(viewer, departments),
      photoPath: member?.photoPath ?? null,
      prefs: (member?.prefs as Record<string, unknown> | null) ?? {},
    },
  };
}

/** For pages and server actions: the signed-in B Mail user at AAL2, else a redirect to the right step. */
export const requireMail = cache(async (): Promise<MailMe> => {
  const g = await gate();
  if (g.ok) return g.me;
  if (g.to === "login") redirect("/mail/sign-in");
  redirect(`/mail/${g.to}`);
});

/** For route handlers: the user or null (no redirects). */
export async function mailUserOrNull(): Promise<MailMe | null> {
  const g = await gate();
  return g.ok ? g.me : null;
}

/** For the code and setup pages: signed in and allowed, whatever the assurance level. */
export async function requireMailIdentity() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user?.email) redirect("/mail/sign-in");
  const email = user.email.trim().toLowerCase();
  const member = await prisma.mailMember.findUnique({ where: { email }, select: { id: true, role: true, departmentId: true, status: true, mail: true } });
  if (!canUseMail({ isOwner: isAdminEmail(email), member, grants: [] })) redirect("/mail/no-access");
  const [aal, factors] = await Promise.all([supabase.auth.mfa.getAuthenticatorAssuranceLevel(), supabase.auth.mfa.listFactors()]);
  return {
    supabase,
    user,
    email,
    aal: aal.data ?? null,
    methods: aal.data?.currentAuthenticationMethods ?? null,
    hasTotp: !!factors.data?.totp?.some((f) => f.status === "verified"),
  };
}

export const requireMailAdmin = async (): Promise<MailMe> => {
  const me = await requireMail();
  if (!me.isAdmin) redirect("/mail");
  return me;
};

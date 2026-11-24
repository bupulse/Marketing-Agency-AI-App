// Who sees which mailbox in B Mail, and who may send to a department (docs/MAIL_CRM.md "Department mailboxes",
// "Departments"). Pure: the page guard, the API routes and the tests share it.

export type MailboxRow = { id: string; kind: string; visibility: string; departmentId: string | null; memberId: string | null };
export type MemberRow = { id: string; role: string; departmentId: string | null; status: string; mail: boolean };
export type DepartmentRow = { id: string; headMemberId: string | null };

export type Viewer = {
  /** The owner (ADMIN_EMAILS): everything, always. */
  isOwner: boolean;
  member: MemberRow | null;
  /** Mailbox ids given to this member one by one (MailboxAccess). */
  grants: string[];
};

/** Roles: member, admin ("Mail admin"), owner ("Super admin": office@ as system administrator, cyusa@). */
export const MAIL_ROLES = ["member", "admin", "owner"] as const;
export const isMailAdmin = (v: Viewer) => v.isOwner || v.member?.role === "admin" || v.member?.role === "owner";
/** Super admins (and the ADMIN_EMAILS owner) may make other people admins or super admins. */
export const isSuperAdmin = (v: Viewer) => v.isOwner || v.member?.role === "owner";

/** May this person open B Mail at all: the owner, or an active/invited member with Mail switched on. */
export function canUseMail(v: Viewer): boolean {
  if (v.isOwner) return true;
  const m = v.member;
  return !!m && m.mail && (m.status === "active" || m.status === "invited");
}

/**
 * The mailboxes a person sees. Owner and mail admins: all, including the catch-all. Members: their own mailbox, every
 * mailbox seen by everyone (support@), their department's mailbox, and mailboxes given to them one by one.
 */
export function visibleMailboxIds(v: Viewer, mailboxes: MailboxRow[]): string[] {
  if (!canUseMail(v)) return [];
  if (isMailAdmin(v)) return mailboxes.map((m) => m.id);
  const me = v.member!;
  return mailboxes
    .filter((b) =>
      b.memberId === me.id ||
      b.visibility === "everyone" ||
      (b.visibility === "department" && !!b.departmentId && b.departmentId === me.departmentId) ||
      v.grants.includes(b.id),
    )
    .filter((b) => b.kind !== "catchall" || v.grants.includes(b.id))
    .map((b) => b.id);
}

/** The departments a person may pick in To: owner and mail admins any; a head their own; members none. */
export function sendableDepartmentIds(v: Viewer, departments: DepartmentRow[]): string[] {
  if (!canUseMail(v)) return [];
  if (isMailAdmin(v)) return departments.map((d) => d.id);
  return departments.filter((d) => d.headMemberId && d.headMemberId === v.member?.id).map((d) => d.id);
}

/** May this person send as a mailbox: the ones they see (support@ for everyone means read and reply, owner's choice). */
export const canSendFrom = (visible: string[], mailboxId: string) => visible.includes(mailboxId);

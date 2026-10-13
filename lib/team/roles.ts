// Company roles and what each may do. Pure (no database), so the pages, the actions and the tests share one table.
// Every server action and API route calls `can()` itself; hiding a button is only a courtesy.

export const ROLES = ["OWNER", "ADMIN", "MEMBER"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = { OWNER: "Owner", ADMIN: "Admin", MEMBER: "Member" };
export const ROLE_HELP: Record<Role, string> = {
  OWNER: "Billing, the plan and deleting the company, plus everything an Admin can do.",
  ADMIN: "Everything except billing and deleting the company: team, channels, connectors, widget and settings.",
  MEMBER: "Create, edit and schedule content and designs, and see leads. No billing, channels or settings.",
};

/** Rank for comparisons: a higher number can manage a lower one. */
const RANK: Record<Role, number> = { MEMBER: 1, ADMIN: 2, OWNER: 3 };

export const PERMISSIONS = {
  /** Create, edit and schedule posts, content, designs, photos and projects; view leads and update their status. */
  content: "MEMBER",
  /** Autopilot settings (the plan, runs and approvals follow `content`). */
  autopilotSettings: "ADMIN",
  /** Content -> Settings: which apps' posts go out without approval (approving posts follows `content`). */
  contentSettings: "ADMIN",
  /** Social channels, store connections, Cloudflare, Drive and the other connectors. */
  channels: "ADMIN",
  connectors: "ADMIN",
  /** Website chat widget settings and its check. */
  widget: "ADMIN",
  /** Webhooks and API keys. */
  webhooks: "ADMIN",
  /** Brand, business details and company settings. */
  settings: "ADMIN",
  /** Invite, remove and change the role of teammates. */
  team: "ADMIN",
  /** Plan, payment, invoices, cancel. */
  billing: "OWNER",
  /** Delete the company, transfer ownership. */
  company: "OWNER",
} as const satisfies Record<string, Role>;
export type Permission = keyof typeof PERMISSIONS;

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export function atLeast(role: Role, min: Role): boolean {
  return RANK[role] >= RANK[min];
}

export function can(role: Role, permission: Permission): boolean {
  return atLeast(role, PERMISSIONS[permission]);
}

/** The roles an inviter may hand out: nobody invites an Owner (ownership moves by transfer). Members manage nobody. */
export function assignableRoles(actor: Role): Role[] {
  return atLeast(actor, "ADMIN") ? ["ADMIN", "MEMBER"] : [];
}

/** Friendly text for someone who may not do something, naming who can. */
export function askMessage(permission: Permission): string {
  return PERMISSIONS[permission] === "OWNER"
    ? "Ask your company owner to do this."
    : "Ask your company owner or an admin to do this.";
}

/** Thrown by `requireActiveUser(permission)` when the signed-in role may not do this. The message is safe to show. */
export class ForbiddenError extends Error {
  constructor(public permission: Permission) {
    super(askMessage(permission));
    this.name = "ForbiddenError";
  }
}

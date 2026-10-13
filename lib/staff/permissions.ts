// Who may do what in the admin console (docs/ADMIN.md, "Organisation"). Pure data and rules, safe to import anywhere.
//
// Deny by default: a page, route or server action names the permission it needs (requirePermission / staffAction in
// lib/staff/auth.ts) and a person without it gets a 404 (pages, routes) or a refusal (actions). The owner (ADMIN_EMAILS)
// has every permission; staff have their role's.

export const PERMISSIONS = {
  // Pages and areas
  overview: { label: "Overview and inbox", group: "Areas" },
  "clients.view": { label: "All clients (companies, users, health, usage, connections)", group: "Areas" },
  "clients.manage": { label: "Change clients (suspend, trial, users, region, notes)", group: "Areas" },
  "clients.own": { label: "My clients (assigned clients only, contact and status)", group: "Areas" },
  demos: { label: "Demos and availability", group: "Areas" },
  requests: { label: "Plan requests and offers", group: "Areas" },
  "sales.team": { label: "Sales team: every agent, every client's agent, leaderboard", group: "Areas" },
  "sales.board": { label: "Leaderboard and own sales numbers", group: "Areas" },
  "money.revenue": { label: "Revenue and profit", group: "Areas" },
  "money.costs": { label: "View and edit costs", group: "Areas" },
  "payments.view": { label: "Payments and invoices", group: "Areas" },
  "plans.manage": { label: "Plans, add-on prices and regions", group: "Areas" },
  content: { label: "Content, funnels, designs, music, industries, announcements", group: "Areas" },
  ai: { label: "AI calls, spend and budget", group: "Areas" },
  system: { label: "Health, services, errors, activity, audit, flags, settings, updates", group: "Areas" },
  jarvis: { label: "Jarvis API keys", group: "Areas" },
  // Actions
  "payments.approve": { label: "Approve or reject payments, mark invoices paid", group: "Actions" },
  "approvals.decide": { label: "Approve money requests (refunds, plan changes)", group: "Actions" },
  "clients.reassign": { label: "Reassign a client to another agent", group: "Actions" },
  "staff.manage": { label: "Manage staff and roles", group: "Actions" },
  "screen.manage": { label: "Create and revoke sales screen links, sounds", group: "Actions" },
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];
export const isPermission = (v: unknown): v is Permission => typeof v === "string" && v in PERMISSIONS;

export type BuiltInRole = { key: string; name: string; description: string; permissions: Permission[]; sales?: boolean };

export const OWNER_ROLE = "owner";

/** Built-in roles. Owner has everything; the others are a starting point, a custom role can tick any mix. */
export const BUILT_IN_ROLES: BuiltInRole[] = [
  { key: OWNER_ROLE, name: "Owner", description: "Everything.", permissions: ALL_PERMISSIONS },
  {
    key: "sales_manager",
    name: "Sales manager",
    description: "All clients and agents, reassigns clients, demos, requests and offers, the leaderboard.",
    permissions: ["overview", "clients.view", "clients.own", "demos", "requests", "sales.team", "sales.board", "clients.reassign"],
    sales: true,
  },
  { key: "sales_agent", name: "Sales agent", description: "Their own clients' contact and status, their link, their numbers and the leaderboard.", permissions: ["clients.own", "sales.board"], sales: true },
  { key: "finance", name: "Finance", description: "Payments (approve), invoices, revenue, costs and money requests.", permissions: ["overview", "payments.view", "payments.approve", "approvals.decide", "money.revenue", "money.costs", "requests", "plans.manage"] },
  { key: "support", name: "Support / client success", description: "All clients and their accounts, demos and plan requests.", permissions: ["overview", "clients.view", "clients.manage", "demos", "requests"] },
  { key: "marketing", name: "Marketing", description: "Content performance, funnels, design and music libraries, announcements.", permissions: ["content"] },
  { key: "it", name: "IT", description: "System health, services, AI, Jarvis keys, settings and staff.", permissions: ["overview", "system", "ai", "jarvis", "staff.manage"] },
  { key: "content_team", name: "Content team", description: "Design and music libraries, industries, content performance.", permissions: ["content"] },
];

export const builtInRole = (key: string) => BUILT_IN_ROLES.find((r) => r.key === key);

/** A role's permissions: built-in, else the custom role's ticked ones (unknown names dropped). Unknown role: none. */
export function permissionsOf(roleKey: string, custom: { key: string; permissions: string[] }[] = []): Permission[] {
  const built = builtInRole(roleKey);
  if (built) return [...built.permissions];
  const c = custom.find((r) => r.key === roleKey);
  return c ? c.permissions.filter(isPermission) : [];
}

/** Sales staff: a referral link and a place on the leaderboard (built-in sales roles, or any role with clients.own). */
export const isSalesRole = (roleKey: string, permissions: readonly Permission[]) => !!builtInRole(roleKey)?.sales || permissions.includes("clients.own");

/** Unambiguous letters and digits for referral codes (no 0, O, 1, I). */
export const REF_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const REF_CODE = /^[A-Z2-9]{4,8}$/;
export const normalizeRef = (v: string | null | undefined): string | null => {
  const c = (v ?? "").trim().toUpperCase();
  return REF_CODE.test(c) ? c : null;
};

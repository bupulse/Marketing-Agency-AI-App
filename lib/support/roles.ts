// Who sees what in the support app (docs/SUPPORT_DASHBOARD.md, owner 9 November 2026). Pure, no imports.
//   AGENT       chats and visitors (live visitors, visitor analytics)
//   TECH        the same, plus server monitoring (uptime, the server PC, site checks)
//   SUPERVISOR  everything an agent sees, every chat, stats and server monitoring
// admin@bupulse.com signs in with the admin console's session and counts as a supervisor who also approves staff.
export type SupportRoleName = "AGENT" | "SUPERVISOR" | "TECH";

export const canSeeVisitorAnalytics = (role: SupportRoleName): boolean => role === "AGENT" || role === "TECH" || role === "SUPERVISOR";
export const canSeeMonitoring = (role: SupportRoleName): boolean => role === "SUPERVISOR" || role === "TECH";
export const canSeeChatStats = (role: SupportRoleName): boolean => role === "SUPERVISOR";

import {
  Activity,
  BadgeCheck,
  Bot,
  Briefcase,
  Building2,
  CalendarCheck,
  ChartLine,
  Clapperboard,
  CloudDownload,
  Coins,
  Cpu,
  FileText,
  Flag,
  Funnel,
  Gauge,
  Globe,
  Headset,
  HeartPulse,
  Inbox,
  Layers,
  LayoutGrid,
  Megaphone,
  MessageSquarePlus,
  Music,
  Palette,
  Plug,
  Quote,
  Receipt,
  ScrollText,
  Server,
  Settings,
  Smartphone,
  Sparkles,
  Stethoscope,
  Tags,
  TriangleAlert,
  Users,
  Wallet,
  Wrench,
  Handshake,
  Medal,
  Network,
  Contact,
  Tv,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import type { Permission } from "@/lib/staff/permissions";

// The admin console's map: one group ("folder") per area, each page with a one-line explanation. The sidebar, the
// breadcrumbs, the page headers and the search (Cmd/Ctrl+K) all read this list, so a page added here is findable
// everywhere. The files live in matching route groups: app/admin/(console)/(clients|money|content|ai|system)/.

export type BadgeKey = "inbox" | "approvals" | "payments" | "requests" | "reports" | "health" | "errors";
/** `perm`: the permission the page needs (any of a list); the page checks it and the menu hides what you cannot open. */
export type AdminNavItem = { href: string; perm: Permission | readonly Permission[]; label: string; icon: LucideIcon; description: string; badge?: BadgeKey; keywords?: string };
export type AdminNavGroup = { id: string; title: string | null; icon?: LucideIcon; items: AdminNavItem[] };

export const ADMIN_NAV: AdminNavGroup[] = [
  {
    id: "home",
    title: null,
    items: [
      { href: "/admin", perm: "overview", label: "Overview", icon: Gauge, description: "Today and this month at a glance: money, clients, AI spend and what needs you." },
      { href: "/admin/inbox", perm: "overview", label: "Inbox", icon: Inbox, badge: "inbox", description: "Everything waiting for you: payments, demos, requests, invoices, offers.", keywords: "to-do todo tasks" },
    ],
  },
  {
    id: "sales",
    title: "Sales",
    icon: Handshake,
    items: [
      { href: "/admin/sales", perm: "clients.own", label: "My clients", icon: Contact, description: "Your clients: contact, plan, trial days left, last sign-in, posts and payment status, and your referral link.", keywords: "agent referral link whatsapp" },
      { href: "/admin/sales/team", perm: "sales.team", label: "Sales team", icon: Users, description: "Every agent and every client's agent; reassign a client with a reason.", keywords: "reassign agents manager" },
      { href: "/admin/sales/leaderboard", perm: "sales.board", label: "Leaderboard", icon: Medal, description: "This month's sales per agent: own sales, team share and total.", keywords: "ranking performance" },
      { href: "/admin/sales/partners", perm: ["sales.team", "money.revenue"], label: "Partners", icon: Network, description: "Outside partners: applications, their links, the companies they brought, commission owed and paid.", keywords: "affiliate referral commission agency coworking momo agent payout" },
    ],
  },
  {
    id: "clients",
    title: "Clients",
    icon: Users,
    items: [
      { href: "/admin/companies", perm: "clients.view", label: "Companies", icon: Building2, description: "Every company, newest first. Open one for its users, usage and actions.", keywords: "business customers" },
      { href: "/admin/users", perm: "clients.view", label: "Users", icon: Users, description: "Every person with an account, and their company.", keywords: "people email" },
      { href: "/admin/client-health", perm: "clients.view", label: "Client health", icon: Stethoscope, description: "Who is active, whose trial ends soon, who is late paying or barely using BuPulse.", keywords: "churn risk inactive trial" },
      { href: "/admin/usage", perm: "clients.view", label: "Usage per client", icon: LayoutGrid, description: "What each client used this period, what it cost in AI, and what they pay.", keywords: "margin cost texts images video voice" },
      { href: "/admin/demos", perm: "demos", label: "Demos", icon: CalendarCheck, description: "Booked demos, your availability and the meeting link.", keywords: "calendar booking" },
      { href: "/admin/requests", perm: "requests", label: "Plan requests", icon: MessageSquarePlus, badge: "requests", description: "Businesses asking for a custom plan." },
      { href: "/admin/connections", perm: "clients.view", label: "Connections", icon: Plug, description: "Clients' social accounts and stores, and their health.", keywords: "facebook instagram tiktok shopify" },
      { href: "/admin/creators", perm: "clients.view", label: "Creator marketplace", icon: Clapperboard, badge: "reports", description: "Creator campaigns on the marketplace, creator profiles and reports: hide, block and resolve.", keywords: "creators influencers campaigns reports block hide moderation" },
    ],
  },
  {
    id: "money",
    title: "Money",
    icon: Wallet,
    items: [
      { href: "/admin/revenue", perm: "money.revenue", label: "Revenue and profit", icon: Coins, description: "Revenue from every client ever, MRR, ARPU, churn, costs and profit by month.", keywords: "income mrr arpu churn lifetime" },
      { href: "/admin/costs", perm: "money.costs", label: "Costs", icon: Receipt, description: "Hosting, the domain, subscriptions and each AI provider's real bill or estimate.", keywords: "expenses bills hosting domain google" },
      { href: "/admin/payments", perm: ["payments.view", "payments.approve"], label: "Payments", icon: Smartphone, badge: "payments", description: "Mobile Money payments to confirm, and the payment details clients see.", keywords: "momo mtn airtel" },
      { href: "/admin/invoices", perm: "payments.view", label: "Invoices", icon: FileText, description: "Invoices sent to clients, paid and overdue." },
      { href: "/admin/offers", perm: "requests", label: "Offers", icon: Sparkles, description: "Custom plans offered to one company." },
      { href: "/admin/plans", perm: "plans.manage", label: "Plans and prices", icon: Layers, description: "The plans, their limits, features and prices.", keywords: "pricing" },
      { href: "/admin/addon-prices", perm: "plans.manage", label: "Add-on prices", icon: Tags, description: "What each add-on costs per month in each region." },
      { href: "/admin/settings/regions", perm: "plans.manage", label: "Regions", icon: Globe, description: "Price regions, their currency, payment methods and card prices.", keywords: "rwanda currency rate" },
    ],
  },
  {
    id: "livechat",
    title: "Live chat",
    icon: Headset,
    items: [
      { href: "/admin/live-chat", perm: "liveChat", label: "Live chat", icon: Headset, description: "Support agents, departments, team hours, greetings and the AI rules of BuPulse's own help chat.", keywords: "support agents chat helpdesk tawk" },
    ],
  },
  {
    id: "content",
    title: "Content",
    icon: Palette,
    items: [
      { href: "/admin/content", perm: "content", label: "Content performance", icon: ChartLine, description: "What clients post and how it performs." },
      { href: "/admin/funnels", perm: "content", label: "Funnels", icon: Funnel, description: "Visit to sign-up to paying, and where people drop off.", keywords: "conversion marketing" },
      { href: "/admin/designs", perm: "content", label: "Design library", icon: Palette, description: "Templates and looks the designs are made from." },
      { href: "/admin/music", perm: "content", label: "Music library", icon: Music, description: "Tracks for videos, and generating new ones." },
      { href: "/admin/industries", perm: "content", label: "Industries", icon: Briefcase, description: "The industries clients pick at sign-up, and their defaults." },
      { href: "/admin/announcements", perm: "content", label: "Announcements", icon: Megaphone, description: "Banners shown to every client in the app." },
      { href: "/admin/testimonials", perm: "content", label: "Testimonials", icon: Quote, description: "Real client quotes shown on the home and pricing pages.", keywords: "reviews quotes clients" },
    ],
  },
  {
    id: "ai",
    title: "AI and usage",
    icon: Cpu,
    items: [
      { href: "/admin/ai", perm: "ai", label: "AI calls and spend", icon: Cpu, description: "AI spend against the monthly cap, by day, model, feature and client.", keywords: "gemini claude elevenlabs budget tokens" },
      { href: "/admin/approvals", perm: "approvals.decide", label: "Approvals", icon: BadgeCheck, badge: "approvals", description: "Money requests from Jarvis or the console, waiting for your OK." },
      { href: "/admin/training-lab", perm: "ai", label: "Training Lab", icon: Sparkles, description: "Owner only: teach the engines by example, with reels, videos, posts, Kinyarwanda recordings and actors.", keywords: "examples teach train reels voice kinyarwanda actors consent" },
      { href: "/admin/jarvis", perm: "jarvis", label: "Jarvis", icon: Bot, description: "Jarvis API keys and what Jarvis may do.", keywords: "api mcp keys" },
    ],
  },
  {
    id: "system",
    title: "System",
    icon: Wrench,
    items: [
      { href: "/admin/health", perm: "system", label: "Health", icon: HeartPulse, badge: "health", description: "Jobs, queues and checks: is anything down?" },
      { href: "/admin/services", perm: "system", label: "Services", icon: Server, description: "Every outside service: test it, switch it off." },
      { href: "/admin/errors", perm: "system", label: "Errors", icon: TriangleAlert, badge: "errors", description: "Server errors and warnings, newest first.", keywords: "logs bugs" },
      { href: "/admin/activity", perm: "system", label: "Live activity", icon: Activity, description: "What is happening right now, updated every few seconds.", keywords: "feed events" },
      { href: "/admin/audit", perm: "system", label: "Audit log", icon: ScrollText, description: "Every admin and Jarvis action, who did it and when." },
      { href: "/admin/flags", perm: "system", label: "Feature flags", icon: Flag, description: "Turn features on or off, for everyone or one company." },
      { href: "/admin/settings", perm: "system", label: "Settings", icon: Settings, description: "Trial length, the RWF rate, demo times and other settings.", keywords: "configuration" },
      { href: "/admin/settings/updates", perm: "system", label: "Updates", icon: CloudDownload, description: "The running version, new releases, install or roll back.", keywords: "deploy release version" },
    ],
  },
  {
    id: "organisation",
    title: "Organisation",
    icon: Network,
    items: [
      { href: "/admin/organisation", perm: "staff.manage", label: "Staff", icon: ShieldCheck, description: "Who works in the console, their role, invitations, disabling and removing.", keywords: "team people invite roles permissions" },
      { href: "/admin/organisation/roles", perm: "staff.manage", label: "Roles", icon: Layers, description: "Built-in roles and custom roles with ticked permissions." },
      { href: "/admin/organisation/screen", perm: "screen.manage", label: "Sales screen", icon: Tv, description: "Links for the sales room TV, and its celebration sounds.", keywords: "tv sounds celebration" },
    ],
  },
];

export const ADMIN_PAGES: (AdminNavItem & { group: AdminNavGroup })[] = ADMIN_NAV.flatMap((group) => group.items.map((item) => ({ ...item, group })));

/** The page a path belongs to: the item whose href is the longest prefix of it (so /admin/settings/regions is Regions). */
export function findNavItem(pathname: string): (AdminNavItem & { group: AdminNavGroup }) | null {
  let best: (AdminNavItem & { group: AdminNavGroup }) | null = null;
  for (const p of ADMIN_PAGES) {
    const hit = p.href === "/admin" ? pathname === "/admin" : pathname === p.href || pathname.startsWith(`${p.href}/`);
    if (hit && (!best || p.href.length > best.href.length)) best = p;
  }
  return best;
}

export type Crumb = { label: string; href?: string };

/** Admin > Money > Invoices > Details: the group, the page, and "Details" for anything below the page. */
export function breadcrumbsFor(pathname: string): Crumb[] {
  const item = findNavItem(pathname);
  if (!item) return [{ label: "Admin", href: "/admin" }];
  const crumbs: Crumb[] = [{ label: "Admin", href: "/admin" }];
  if (item.href === "/admin") return [{ label: "Overview" }];
  // A one-page folder named like its page (Live chat) is not repeated.
  if (item.group.title && item.group.title !== item.label) crumbs.push({ label: item.group.title });
  const deeper = pathname !== item.href;
  crumbs.push({ label: item.label, href: deeper ? item.href : undefined });
  if (deeper) {
    const rest = pathname.slice(item.href.length + 1).split("/")[0];
    crumbs.push({ label: rest === "new" ? "New" : rest === "settings" ? "Settings" : "Details" });
  }
  return crumbs;
}

/** The menu for one person: only the pages their permissions open (empty folders dropped). */
export function navFor(permissions: readonly Permission[]): AdminNavGroup[] {
  const allowed = (p: AdminNavItem["perm"]) => (typeof p === "string" ? [p] : p).some((x) => permissions.includes(x));
  return ADMIN_NAV.map((g) => ({ ...g, items: g.items.filter((i) => allowed(i.perm)) })).filter((g) => g.items.length > 0);
}

/** The first page a person may open (where /admin sends someone without the Overview). */
export const firstPageFor = (permissions: readonly Permission[]): string | null => navFor(permissions)[0]?.items[0]?.href ?? null;

/** Simple ranking for the search: label start, then word start, then anywhere (label, group, keywords). */
export function searchPages(query: string): (AdminNavItem & { group: AdminNavGroup })[] {
  const q = query.trim().toLowerCase();
  if (!q) return ADMIN_PAGES;
  const score = (p: AdminNavItem & { group: AdminNavGroup }) => {
    const label = p.label.toLowerCase();
    if (label.startsWith(q)) return 0;
    if (label.split(/\s+/).some((w) => w.startsWith(q))) return 1;
    if (`${label} ${p.group.title ?? ""} ${p.keywords ?? ""}`.toLowerCase().includes(q)) return 2;
    if (p.description.toLowerCase().includes(q)) return 3;
    return 9;
  };
  return ADMIN_PAGES.map((p) => ({ p, s: score(p) })).filter((x) => x.s < 9).sort((a, b) => a.s - b.s).map((x) => x.p);
}

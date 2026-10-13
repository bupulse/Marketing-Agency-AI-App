import {
  Activity,
  BadgeCheck,
  Bot,
  Briefcase,
  Building2,
  CalendarCheck,
  ChartLine,
  CloudDownload,
  Coins,
  Cpu,
  FileText,
  Flag,
  Funnel,
  Gauge,
  Globe,
  HeartPulse,
  Inbox,
  Layers,
  LayoutGrid,
  Megaphone,
  MessageSquarePlus,
  Music,
  Palette,
  Plug,
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
  type LucideIcon,
} from "lucide-react";

// The admin console's map: one group ("folder") per area, each page with a one-line explanation. The sidebar, the
// breadcrumbs, the page headers and the search (Cmd/Ctrl+K) all read this list, so a page added here is findable
// everywhere. The files live in matching route groups: app/admin/(console)/(clients|money|content|ai|system)/.

export type BadgeKey = "inbox" | "approvals" | "payments" | "requests" | "health" | "errors";
export type AdminNavItem = { href: string; label: string; icon: LucideIcon; description: string; badge?: BadgeKey; keywords?: string };
export type AdminNavGroup = { id: string; title: string | null; icon?: LucideIcon; items: AdminNavItem[] };

export const ADMIN_NAV: AdminNavGroup[] = [
  {
    id: "home",
    title: null,
    items: [
      { href: "/admin", label: "Overview", icon: Gauge, description: "Today and this month at a glance: money, clients, AI spend and what needs you." },
      { href: "/admin/inbox", label: "Inbox", icon: Inbox, badge: "inbox", description: "Everything waiting for you: payments, demos, requests, invoices, offers.", keywords: "to-do todo tasks" },
    ],
  },
  {
    id: "clients",
    title: "Clients",
    icon: Users,
    items: [
      { href: "/admin/companies", label: "Companies", icon: Building2, description: "Every company, newest first. Open one for its users, usage and actions.", keywords: "business customers" },
      { href: "/admin/users", label: "Users", icon: Users, description: "Every person with an account, and their company.", keywords: "people email" },
      { href: "/admin/client-health", label: "Client health", icon: Stethoscope, description: "Who is active, whose trial ends soon, who is late paying or barely using BuPulse.", keywords: "churn risk inactive trial" },
      { href: "/admin/usage", label: "Usage per client", icon: LayoutGrid, description: "What each client used this period, what it cost in AI, and what they pay.", keywords: "margin cost texts images video voice" },
      { href: "/admin/demos", label: "Demos", icon: CalendarCheck, description: "Booked demos, your availability and the meeting link.", keywords: "calendar booking" },
      { href: "/admin/requests", label: "Plan requests", icon: MessageSquarePlus, badge: "requests", description: "Businesses asking for a custom plan." },
      { href: "/admin/connections", label: "Connections", icon: Plug, description: "Clients' social accounts and stores, and their health.", keywords: "facebook instagram tiktok shopify" },
    ],
  },
  {
    id: "money",
    title: "Money",
    icon: Wallet,
    items: [
      { href: "/admin/revenue", label: "Revenue and profit", icon: Coins, description: "Revenue from every client ever, MRR, ARPU, churn, costs and profit by month.", keywords: "income mrr arpu churn lifetime" },
      { href: "/admin/costs", label: "Costs", icon: Receipt, description: "Hosting, the domain, subscriptions and each AI provider's real bill or estimate.", keywords: "expenses bills hosting domain google" },
      { href: "/admin/payments", label: "Payments", icon: Smartphone, badge: "payments", description: "Mobile Money payments to confirm, and the payment details clients see.", keywords: "momo mtn airtel" },
      { href: "/admin/invoices", label: "Invoices", icon: FileText, description: "Invoices sent to clients, paid and overdue." },
      { href: "/admin/offers", label: "Offers", icon: Sparkles, description: "Custom plans offered to one company." },
      { href: "/admin/plans", label: "Plans and prices", icon: Layers, description: "The plans, their limits, features and prices.", keywords: "pricing" },
      { href: "/admin/addon-prices", label: "Add-on prices", icon: Tags, description: "What each add-on costs per month in each region." },
      { href: "/admin/settings/regions", label: "Regions", icon: Globe, description: "Price regions, their currency, payment methods and card prices.", keywords: "rwanda currency rate" },
    ],
  },
  {
    id: "content",
    title: "Content",
    icon: Palette,
    items: [
      { href: "/admin/content", label: "Content performance", icon: ChartLine, description: "What clients post and how it performs." },
      { href: "/admin/funnels", label: "Funnels", icon: Funnel, description: "Visit to sign-up to paying, and where people drop off.", keywords: "conversion marketing" },
      { href: "/admin/designs", label: "Design library", icon: Palette, description: "Templates and looks the designs are made from." },
      { href: "/admin/music", label: "Music library", icon: Music, description: "Tracks for videos, and generating new ones." },
      { href: "/admin/industries", label: "Industries", icon: Briefcase, description: "The industries clients pick at sign-up, and their defaults." },
      { href: "/admin/announcements", label: "Announcements", icon: Megaphone, description: "Banners shown to every client in the app." },
    ],
  },
  {
    id: "ai",
    title: "AI and usage",
    icon: Cpu,
    items: [
      { href: "/admin/ai", label: "AI calls and spend", icon: Cpu, description: "AI spend against the monthly cap, by day, model, feature and client.", keywords: "gemini claude elevenlabs budget tokens" },
      { href: "/admin/approvals", label: "Approvals", icon: BadgeCheck, badge: "approvals", description: "Money requests from Jarvis or the console, waiting for your OK." },
      { href: "/admin/jarvis", label: "Jarvis", icon: Bot, description: "Jarvis API keys and what Jarvis may do.", keywords: "api mcp keys" },
    ],
  },
  {
    id: "system",
    title: "System",
    icon: Wrench,
    items: [
      { href: "/admin/health", label: "Health", icon: HeartPulse, badge: "health", description: "Jobs, queues and checks: is anything down?" },
      { href: "/admin/services", label: "Services", icon: Server, description: "Every outside service: test it, switch it off." },
      { href: "/admin/errors", label: "Errors", icon: TriangleAlert, badge: "errors", description: "Server errors and warnings, newest first.", keywords: "logs bugs" },
      { href: "/admin/activity", label: "Live activity", icon: Activity, description: "What is happening right now, updated every few seconds.", keywords: "feed events" },
      { href: "/admin/audit", label: "Audit log", icon: ScrollText, description: "Every admin and Jarvis action, who did it and when." },
      { href: "/admin/flags", label: "Feature flags", icon: Flag, description: "Turn features on or off, for everyone or one company." },
      { href: "/admin/settings", label: "Settings", icon: Settings, description: "Trial length, the RWF rate, demo times and other settings.", keywords: "configuration" },
      { href: "/admin/settings/updates", label: "Updates", icon: CloudDownload, description: "The running version, new releases, install or roll back.", keywords: "deploy release version" },
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
  if (item.group.title) crumbs.push({ label: item.group.title });
  const deeper = pathname !== item.href;
  crumbs.push({ label: item.label, href: deeper ? item.href : undefined });
  if (deeper) {
    const rest = pathname.slice(item.href.length + 1).split("/")[0];
    crumbs.push({ label: rest === "new" ? "New" : rest === "settings" ? "Settings" : "Details" });
  }
  return crumbs;
}

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

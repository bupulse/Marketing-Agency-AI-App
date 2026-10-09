import {
  Activity,
  BadgeCheck,
  Bot,
  ChartLine,
  Coins,
  Cpu,
  Flag,
  Funnel,
  Gauge,
  Layers,
  HeartPulse,
  Megaphone,
  Plug,
  ScrollText,
  Server,
  TriangleAlert,
  Building2,
  type LucideIcon,
} from "lucide-react";

export type AdminNavItem = { href: string; label: string; icon: LucideIcon; badge?: "approvals" | "health" };
export type AdminNavGroup = { title: string | null; items: AdminNavItem[] };

export const ADMIN_NAV: AdminNavGroup[] = [
  { title: null, items: [{ href: "/admin", label: "Overview", icon: Gauge }] },
  {
    title: "Clients",
    items: [
      { href: "/admin/companies", label: "Companies", icon: Building2 },
      { href: "/admin/connections", label: "Connections", icon: Plug },
    ],
  },
  {
    title: "Money",
    items: [
      { href: "/admin/revenue", label: "Revenue and costs", icon: Coins },
      { href: "/admin/plans", label: "Plans", icon: Layers },
      { href: "/admin/approvals", label: "Approvals", icon: BadgeCheck, badge: "approvals" },
    ],
  },
  {
    title: "Product",
    items: [
      { href: "/admin/content", label: "Content performance", icon: ChartLine },
      { href: "/admin/funnels", label: "Funnels", icon: Funnel },
    ],
  },
  {
    title: "System",
    items: [
      { href: "/admin/health", label: "Health", icon: HeartPulse, badge: "health" },
      { href: "/admin/services", label: "Services", icon: Server },
      { href: "/admin/ai", label: "AI usage", icon: Cpu },
      { href: "/admin/errors", label: "Errors", icon: TriangleAlert },
      { href: "/admin/activity", label: "Live activity", icon: Activity },
    ],
  },
  {
    title: "Settings",
    items: [
      { href: "/admin/flags", label: "Feature flags", icon: Flag },
      { href: "/admin/announcements", label: "Announcements", icon: Megaphone },
      { href: "/admin/jarvis", label: "Jarvis", icon: Bot },
      { href: "/admin/audit", label: "Audit log", icon: ScrollText },
    ],
  },
];

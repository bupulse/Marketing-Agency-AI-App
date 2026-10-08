import {
  BadgeCheck,
  Bot,
  ChartLine,
  Coins,
  Flag,
  Funnel,
  Gauge,
  Megaphone,
  ScrollText,
  Sparkles,
  TriangleAlert,
  Users,
  type LucideIcon,
} from "lucide-react";

export type AdminNavItem = { href: string; label: string; icon: LucideIcon; badge?: "approvals" };

export const ADMIN_NAV: AdminNavItem[] = [
  { href: "/admin", label: "Overview", icon: Gauge },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/approvals", label: "Approvals", icon: BadgeCheck, badge: "approvals" },
  { href: "/admin/revenue", label: "Revenue and costs", icon: Coins },
  { href: "/admin/funnels", label: "Funnels", icon: Funnel },
  { href: "/admin/content", label: "Content performance", icon: ChartLine },
  { href: "/admin/errors", label: "Errors", icon: TriangleAlert },
  { href: "/admin/flags", label: "Feature flags", icon: Flag },
  { href: "/admin/announcements", label: "Announcements", icon: Megaphone },
  { href: "/admin/audit", label: "Audit log", icon: ScrollText },
  { href: "/admin/jarvis", label: "Jarvis", icon: Bot },
];

export const ADMIN_BRAND_ICON = Sparkles;

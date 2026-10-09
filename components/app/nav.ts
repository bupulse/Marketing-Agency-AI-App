import {
  Blocks,
  CalendarDays,
  ChartLine,
  ChartNoAxesColumn,
  CreditCard,
  FolderKanban,
  House,
  MessageCircle,
  Image as ImageIcon,
  Images,
  PenLine,
  Palette,
  Plug,
  Settings,
  UsersRound,
  Sparkles,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { Permission } from "@/lib/team/roles";

export type NavItem = { href: string; label: string; icon: LucideIcon; /** Hidden from roles that may not use the page. */ permission?: Permission };

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Home", icon: House },
  { href: "/dashboard/projects", label: "Projects", icon: FolderKanban },
  { href: "/dashboard/content", label: "Content", icon: PenLine },
  { href: "/dashboard/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/dashboard/analytics", label: "Analytics", icon: ChartLine },
  { href: "/dashboard/autopilot", label: "Autopilot", icon: Sparkles },
  { href: "/dashboard/gallery", label: "Gallery", icon: Images },
  { href: "/dashboard/designs", label: "Designs", icon: ImageIcon },
  { href: "/dashboard/leads", label: "Leads", icon: Users },
  { href: "/dashboard/widget", label: "Website chat", icon: MessageCircle, permission: "widget" },
  { href: "/dashboard/connections", label: "Channels", icon: Plug, permission: "channels" },
  { href: "/dashboard/connectors", label: "Connectors", icon: Blocks, permission: "connectors" },
  { href: "/dashboard/brand", label: "Brand", icon: Palette, permission: "settings" },
  { href: "/dashboard/usage", label: "Usage", icon: ChartNoAxesColumn },
  { href: "/dashboard/billing", label: "Billing", icon: CreditCard, permission: "billing" },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
  { href: "/dashboard/settings/team", label: "Team", icon: UsersRound, permission: "team" },
];

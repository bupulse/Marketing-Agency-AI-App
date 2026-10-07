import {
  CalendarDays,
  ChartNoAxesColumn,
  CreditCard,
  FolderKanban,
  House,
  Image as ImageIcon,
  Images,
  PenLine,
  Palette,
  Plug,
  Settings,
  Sparkles,
  Users,
  type LucideIcon,
} from "lucide-react";

export type NavItem = { href: string; label: string; icon: LucideIcon };

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Home", icon: House },
  { href: "/dashboard/projects", label: "Projects", icon: FolderKanban },
  { href: "/dashboard/content", label: "Content", icon: PenLine },
  { href: "/dashboard/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/dashboard/autopilot", label: "Autopilot", icon: Sparkles },
  { href: "/dashboard/gallery", label: "Gallery", icon: Images },
  { href: "/dashboard/designs", label: "Designs", icon: ImageIcon },
  { href: "/dashboard/leads", label: "Leads", icon: Users },
  { href: "/dashboard/connections", label: "Connections", icon: Plug },
  { href: "/dashboard/brand", label: "Brand", icon: Palette },
  { href: "/dashboard/usage", label: "Usage", icon: ChartNoAxesColumn },
  { href: "/dashboard/billing", label: "Billing", icon: CreditCard },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];

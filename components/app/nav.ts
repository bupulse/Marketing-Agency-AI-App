import {
  Blocks,
  BookOpen,
  BookUser,
  Inbox,
  Workflow,
  Camera,
  CalendarDays,
  ChartLine,
  ChartNoAxesColumn,
  Clapperboard,
  Film,
  CreditCard,
  HardDrive,
  House,
  KeyRound,
  MessageCircle,
  Mic,
  Image as ImageIcon,
  Images,
  PenLine,
  Palette,
  Plug,
  Settings,
  ShoppingBag,
  UsersRound,
  Sparkles,
  Store,
  Users,
  Webhook,
  type LucideIcon,
} from "lucide-react";
import { featureForRoute, type FeatureKey } from "@/lib/features";
import type { Permission } from "@/lib/team/roles";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Hidden from roles that may not use the page. */
  permission?: Permission;
  /** Hidden when the company's plan lacks the feature (from the route, see lib/features.ts). */
  feature: FeatureKey | null;
};

const item = (href: string, label: string, icon: LucideIcon, permission?: Permission): NavItem => ({ href, label, icon, permission, feature: featureForRoute(href) });

export const NAV_ITEMS: NavItem[] = [
  item("/dashboard", "Home", House),
  item("/dashboard/knowledge", "Knowledge base", BookOpen),
  item("/dashboard/content", "Content", PenLine),
  item("/dashboard/calendar", "Calendar", CalendarDays),
  item("/dashboard/analytics", "Analytics", ChartLine),
  item("/dashboard/autopilot", "Autopilot", Sparkles),
  item("/dashboard/gallery", "Gallery", Images),
  item("/dashboard/designs", "Designs", ImageIcon),
  item("/dashboard/video", "Videos", Film),
  item("/dashboard/inbox", "Inbox", Inbox),
  item("/dashboard/contacts", "Contacts", BookUser),
  item("/dashboard/automations", "Automations", Workflow),
  item("/dashboard/leads", "Leads", Users),
  item("/dashboard/widget", "Website chat", MessageCircle, "widget"),
  item("/dashboard/connections", "Channels", Plug, "channels"),
  item("/dashboard/connectors", "Connectors", Blocks, "connectors"),
  item("/dashboard/brand", "Brand", Palette, "settings"),
  item("/dashboard/usage", "Usage", ChartNoAxesColumn),
  item("/dashboard/billing", "Billing", CreditCard, "billing"),
  item("/dashboard/settings", "Settings", Settings),
  item("/dashboard/settings/team", "Team", UsersRound, "team"),
];

/** One icon per feature, for the "Add to your plan" group and page. */
export const FEATURE_ICONS: Record<FeatureKey, LucideIcon> = {
  content: PenLine,
  designs: ImageIcon,
  aiPhotos: Camera,
  calendar: CalendarDays,
  gallery: Images,
  websiteChat: MessageCircle,
  autopilot: Sparkles,
  analytics: ChartLine,
  canva: Palette,
  storeImport: ShoppingBag,
  driveImport: HardDrive,
  webhooks: Webhook,
  apiAccess: KeyRound,
  ownComposio: Blocks,
  managed: Store,
  video: Clapperboard,
  voice: Mic,
  videoStudio: Clapperboard,
  aiVideo: Film,
  inbox: Inbox,
  automations: Workflow,
};

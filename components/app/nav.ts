import {
  Sunrise,
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
  ImagePlus,
  KeyRound,
  Link2,
  Megaphone,
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
import { featureForRoute, featureOf, type FeatureKey } from "@/lib/features";
import { can, type Permission, type Role } from "@/lib/team/roles";

// The dashboard's menu (docs/guide/features/35-finding-your-way.md): groups of pages, the + Create actions, the phone
// bottom bar and "Find a page" all read these lists, so a page added here shows up everywhere, for the roles and plans
// that may open it. Pure (no React, no server code): the tests check the grouping, the filtering and the search.

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Hidden from roles that may not use the page. */
  permission?: Permission;
  /** Hidden when the company's plan lacks the feature (from the route, see lib/features.ts). */
  feature: FeatureKey | null;
  /** Other words people may type in "Find a page" (MoMo for Billing, Instagram for Channels). */
  keywords?: string;
  /** The page's feature is "Coming soon" (lib/features.ts): listed in the menu as such, never a link. */
  soon?: boolean;
};

const item = (href: string, label: string, icon: LucideIcon, keywords: string, permission?: Permission): NavItem => {
  const feature = featureForRoute(href);
  return { href, label, icon, permission, feature, keywords, soon: feature !== null && featureOf(feature).status === "coming_soon" };
};

export type NavGroupId = "home" | "create" | "publish" | "customers" | "results" | "business" | "account";
/** `title` null: no heading (Home, at the top). */
export type NavGroup = { id: NavGroupId; title: string | null; items: NavItem[] };

export const NAV_GROUPS: readonly NavGroup[] = [
  { id: "home", title: null, items: [item("/dashboard", "Home", House, "start dashboard overview today")] },
  {
    id: "create",
    title: "Create",
    items: [
      item("/dashboard/content", "Posts", PenLine, "content captions hashtags write approve review today"),
      item("/dashboard/video", "Videos", Film, "video reels tiktok shorts clips film studio"),
      item("/dashboard/designs", "Designs", ImageIcon, "design image picture flyer poster template graphics canva"),
      item("/dashboard/gallery", "Photos", Images, "gallery pictures images upload media files folders albums"),
      item("/dashboard/autopilot", "Autopilot", Sparkles, "automatic auto plan week ai"),
    ],
  },
  {
    id: "publish",
    title: "Publish",
    items: [
      item("/dashboard/calendar", "Calendar", CalendarDays, "schedule planner dates publish post later"),
      item("/dashboard/connections", "Channels", Plug, "connections connect apps social accounts instagram facebook tiktok linkedin youtube whatsapp", "channels"),
      item("/dashboard/creators", "Creators", Megaphone, "creator campaigns influencers ambassadors challenge views payouts", "creators"),
      item("/dashboard/bio", "Link in bio", Link2, "bio linktree link page instagram profile", "settings"),
    ],
  },
  {
    id: "customers",
    title: "Customers",
    items: [
      item("/dashboard/inbox", "Inbox", Inbox, "messages chat dm conversations replies comments whatsapp instagram"),
      item("/dashboard/leads", "Leads", Users, "customers prospects enquiries requests"),
      item("/dashboard/contacts", "Contacts", BookUser, "people customers clients phone numbers"),
      item("/dashboard/automations", "Automations", Workflow, "workflow auto reply bot rules"),
      item("/dashboard/widget", "Website chat", MessageCircle, "chat widget bubble website site", "widget"),
    ],
  },
  { id: "results", title: "Results", items: [item("/dashboard/analytics", "Analytics", ChartLine, "results stats statistics reports performance insights reach views likes followers")] },
  {
    id: "business",
    title: "My business",
    items: [
      item("/dashboard/knowledge", "Business info", BookOpen, "knowledge base products services company profile faqs hours location address prices campaigns"),
      item("/dashboard/brand", "Brand", Palette, "logo colours colors fonts style", "settings"),
    ],
  },
  {
    id: "account",
    title: "Account & settings",
    items: [
      item("/dashboard/billing", "Billing", CreditCard, "payment pay momo mobile money mtn airtel plan subscription invoice card upgrade price", "billing"),
      item("/dashboard/settings/team", "Team", UsersRound, "members staff invite users people roles", "team"),
      item("/dashboard/usage", "Usage", ChartNoAxesColumn, "credits limits generations used quota"),
      item("/dashboard/settings", "Settings", Settings, "account profile password timezone notifications"),
      item("/dashboard/connectors", "Connectors", Blocks, "integrations api webhooks drive shopify woocommerce store cloudflare", "connectors"),
    ],
  },
];

/** The group folded by default (it opens by itself on its own pages). */
export const FOLDED_GROUP: NavGroupId = "account";

export const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

/** True when the role and the plan may open the page (a "Coming soon" page opens for nobody). */
export function canSee(item: Pick<NavItem, "permission" | "feature" | "soon">, role: Role, features: readonly FeatureKey[]): boolean {
  return !item.soon && (!item.permission || can(role, item.permission)) && (!item.feature || features.includes(item.feature));
}

/**
 * The menu for a role and a plan: each group with the pages they may open, plus the "Coming soon" ones their role
 * could use (shown, not clickable); a group left empty is not shown.
 */
export function navFor(role: Role, features: readonly FeatureKey[]): NavGroup[] {
  const shown = (i: NavItem) => canSee(i, role, features) || (i.soon === true && (!i.permission || can(role, i.permission)));
  return NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter(shown) })).filter((g) => g.items.length > 0);
}

/** The menu item for the page open now: Home and Settings only on themselves (Team is its own item), the others on their sub-pages too. */
export function isActive(pathname: string, href: string): boolean {
  if (href === "/dashboard" || href === "/dashboard/settings") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** The group whose page is open now, if any. */
export function activeGroup(pathname: string, groups: readonly NavGroup[] = NAV_GROUPS): NavGroupId | null {
  return groups.find((g) => g.items.some((i) => isActive(pathname, i.href)))?.id ?? null;
}

/**
 * The Video Studio link (docs/VIDEO_STUDIO_SPLIT.md): "open" opens studio.bupulse.com in a new tab, signed in;
 * "upgrade" goes to the Videos library, which says the plan has no video credits; null: no link.
 */
export type StudioLink = "open" | "upgrade" | null;

export type CreateAction = {
  id: "post" | "video" | "design" | "photo";
  label: string;
  /** One line under the label. */
  text: string;
  href: string;
  icon: LucideIcon;
  /** A plain link in a new tab (the Video Studio): never prefetched, as each visit writes a sign-in ticket. */
  external?: boolean;
  keywords: string;
};

/**
 * The + Create menu: each action goes to the page that starts it. New post opens "Create today's content" on the
 * General posts (?create=1); Add photo opens the Photos upload (?upload=1). Only what the role and the plan allow.
 */
export function createActions(role: Role, features: readonly FeatureKey[], studio: StudioLink = null): CreateAction[] {
  if (!can(role, "content")) return [];
  const out: CreateAction[] = [];
  // The day view needs posting too (components/content-board/subject-page.tsx); without it the Posts page is the start.
  if (features.includes("content")) {
    out.push({ id: "post", label: "New post", text: "AI makes it for you, or you create it", href: features.includes("calendar") ? "/dashboard/content/general?create=1" : "/dashboard/content", icon: PenLine, keywords: "post caption write content create" });
  }
  out.push(
    studio === "open"
      ? { id: "video", label: "New video", text: "Opens the Video Studio in a new tab", href: "/dashboard/video/open", icon: Clapperboard, external: true, keywords: "video reel tiktok short film studio make" }
      : { id: "video", label: "New video", text: "Your videos, and how to make new ones", href: "/dashboard/video", icon: Clapperboard, keywords: "video reel tiktok short film studio make" },
  );
  if (features.includes("designs")) out.push({ id: "design", label: "New design", text: "A branded image with your logo and colours", href: "/dashboard/designs", icon: ImageIcon, keywords: "design image picture flyer poster template make" });
  if (features.includes("gallery")) out.push({ id: "photo", label: "Add photo", text: "Upload photos or videos from your phone", href: "/dashboard/gallery?upload=1", icon: ImagePlus, keywords: "photo picture image upload gallery add" });
  return out;
}

/**
 * The phone bottom bar's pages around the big +: Home, Calendar, Inbox. A page the role or plan cannot open gives its
 * place to the next one that fits (no Inbox in the plan: Posts), never one already on the bar.
 */
export function bottomBarItems(role: Role, features: readonly FeatureKey[]): NavItem[] {
  const visible = NAV_ITEMS.filter((i) => canSee(i, role, features));
  const used = new Set<string>();
  const pick = (hrefs: string[]) => {
    const found = hrefs.map((h) => visible.find((i) => i.href === h)).find((i) => i && !used.has(i.href));
    if (found) used.add(found.href);
    return found ?? null;
  };
  const home = pick(["/dashboard"]);
  const left = pick(["/dashboard/calendar", "/dashboard/content", "/dashboard/designs", "/dashboard/gallery"]);
  const right = pick(["/dashboard/inbox", "/dashboard/content", "/dashboard/leads", "/dashboard/designs", "/dashboard/gallery"]);
  return [home, left, right].filter((i): i is NavItem => i !== null);
}

/** One line in "Find a page": a menu page or a Create action. */
export type FinderEntry = { key: string; href: string; label: string; group: string; icon: LucideIcon; keywords: string; external?: boolean };

/** Everything "Find a page" can open for a role and a plan: the Create actions first, then the menu in its order. */
export function finderEntries(role: Role, features: readonly FeatureKey[], studio: StudioLink = null): FinderEntry[] {
  const actions = createActions(role, features, studio).map((a) => ({ key: `create:${a.id}`, href: a.href, label: a.label, group: "Create", icon: a.icon, keywords: a.keywords, external: a.external }));
  const pages = navFor(role, features).flatMap((g) => g.items.filter((i) => !i.soon).map((i) => ({ key: i.href, href: i.href, label: i.label, group: g.title ?? "", icon: i.icon, keywords: i.keywords ?? "" })));
  return [...actions, ...pages];
}

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/**
 * Simple ranking for "Find a page": the name starts with it, then a word of the name does, then the name, group or
 * other words contain it, then every word typed is found somewhere. Ties keep the menu's order.
 */
export function searchEntries<T extends Pick<FinderEntry, "label" | "group" | "keywords">>(query: string, entries: readonly T[]): T[] {
  const q = fold(query.trim()).replace(/\s+/g, " ");
  if (!q) return [...entries];
  const score = (e: T) => {
    const label = fold(e.label);
    const all = `${label} ${fold(e.group)} ${fold(e.keywords)}`;
    if (label.startsWith(q)) return 0;
    if (label.split(" ").some((w) => w.startsWith(q))) return 1;
    if (all.includes(q)) return 2;
    if (q.split(" ").every((w) => all.includes(w))) return 3;
    return 9;
  };
  return entries.map((e) => ({ e, s: score(e) })).filter((x) => x.s < 9).sort((a, b) => a.s - b.s).map((x) => x.e);
}

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
  dailyPosts: Sunrise,
  creators: Megaphone,
};

// The one list of everything BuPulse can do, with what each feature needs. Pure data and pure helpers (no server
// imports), so the admin plan form, the sidebar, the entitlement checks and the tests all share it. Plans store a
// list of these keys (PlanDefinition.featureKeys); lib/entitlements.ts turns a company's plan into what it may use.
// To add a feature: add its key to FEATURE_KEYS, describe it in FEATURES, and gate its pages, actions and routes
// with featureGate / assertFeature. The dependency graph must stay a tree-like DAG (the tests check for cycles).

import type { ServiceId } from "@/lib/admin/service-catalog";
import type { UsageMetric } from "@/lib/plans";

export const FEATURE_KEYS = [
  "content",
  "designs",
  "aiPhotos",
  "calendar",
  "gallery",
  "websiteChat",
  "autopilot",
  "analytics",
  "canva",
  "storeImport",
  "driveImport",
  "webhooks",
  "apiAccess",
  "ownComposio",
  "managed",
  "video",
  "voice",
] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];

/** built: sellable and enforced. coming_soon: listed as "Coming soon", cannot be put in a plan. */
export type FeatureStatus = "built" | "coming_soon";

export interface FeatureDef {
  key: FeatureKey;
  label: string;
  /** One line for the plan builder and the "Add to your plan" page. */
  description: string;
  /** Features that must be in the plan too. Direct ones only; the helpers follow the chain. */
  requires: FeatureKey[];
  /** The usage limit that counts this feature's use, when it has one. */
  metric?: UsageMetric;
  /**
   * Outside services the feature runs on. It is unusable while ALL of them are switched off in the admin console
   * (one still on is enough: a store import works with Shopify off while WooCommerce is on). A feature that keeps
   * working without its services lists none: the website chat still collects leads while the AI is off.
   */
  services: ServiceId[];
  status: FeatureStatus;
  /**
   * app: pages, actions and routes in the dashboard are gated by it (listed in `routes`).
   * service: sold and delivered by people (Managed by BuPulse) or outside the app (own Composio account); nothing to gate.
   */
  kind: "app" | "service";
  /** Dashboard routes (prefixes) the feature unlocks. The sidebar hides items under them when it is missing. */
  routes: string[];
}

export const FEATURES: readonly FeatureDef[] = [
  {
    key: "content",
    label: "AI content",
    description: "Captions, hashtags, video scripts and ad headlines written for your business, products and campaigns.",
    requires: [],
    metric: "text",
    services: ["gemini", "claude"],
    status: "built",
    kind: "app",
    routes: ["/dashboard/knowledge/products", "/dashboard/knowledge/campaigns", "/dashboard/knowledge/audience", "/dashboard/knowledge/competitors", "/dashboard/knowledge/reviews", "/dashboard/knowledge/interview", "/dashboard/projects", "/dashboard/content"],
  },
  {
    key: "designs",
    label: "Branded designs",
    description: "Ready-made templates with your logo, colours and photos, in every size the networks need.",
    requires: [],
    services: [],
    status: "built",
    kind: "app",
    routes: ["/dashboard/designs"],
  },
  {
    key: "aiPhotos",
    label: "AI photos",
    description: "Describe an image and get a photo-real design, with your headline and logo laid over it.",
    requires: ["designs"],
    metric: "image",
    services: ["gemini"],
    status: "built",
    kind: "app",
    routes: [],
  },
  {
    key: "calendar",
    label: "Calendar and scheduling",
    description: "Connect your channels, compose posts, schedule them and let BuPulse publish at the right time.",
    requires: [],
    services: [],
    status: "built",
    kind: "app",
    routes: ["/dashboard/calendar", "/dashboard/connections"],
  },
  {
    key: "gallery",
    label: "Media gallery",
    description: "Upload and organise your photos and files in folders, ready for designs and posts.",
    requires: [],
    services: [],
    status: "built",
    kind: "app",
    routes: ["/dashboard/gallery"],
  },
  {
    key: "websiteChat",
    label: "Website chat and leads",
    description: "A chat bubble on your website that answers visitors and collects their details in your leads inbox.",
    requires: [],
    metric: "chat",
    services: [],
    status: "built",
    kind: "app",
    routes: ["/dashboard/widget", "/dashboard/leads", "/dashboard/domains"],
  },
  {
    key: "autopilot",
    label: "Autopilot",
    description: "AI plans your week of posts, writes one for each network and gets them ready for you to approve.",
    requires: ["content", "designs", "calendar", "gallery"],
    services: ["gemini", "claude"],
    status: "built",
    kind: "app",
    routes: ["/dashboard/autopilot"],
  },
  {
    key: "analytics",
    label: "Analytics",
    description: "Reach, engagement and chat results for your connected channels, compared with the period before.",
    requires: ["calendar"],
    services: [],
    status: "built",
    kind: "app",
    routes: ["/dashboard/analytics"],
  },
  {
    key: "canva",
    label: "Canva editing",
    description: "Open your designs in Canva, edit them there and bring Canva designs into BuPulse.",
    requires: ["designs"],
    services: ["canva"],
    status: "built",
    kind: "app",
    routes: [],
  },
  {
    key: "storeImport",
    label: "Store import",
    description: "Bring your Shopify or WooCommerce products into BuPulse, with photos and prices, and keep them in sync.",
    requires: [],
    services: ["shopify", "woocommerce"],
    status: "built",
    kind: "app",
    routes: ["/dashboard/stores"],
  },
  {
    key: "driveImport",
    label: "Drive and Dropbox import",
    description: "Pick photos and files from Google Drive or Dropbox straight into your gallery.",
    requires: ["gallery"],
    services: ["google-drive", "dropbox"],
    status: "built",
    kind: "app",
    routes: [],
  },
  {
    key: "webhooks",
    label: "Webhooks",
    description: "Send your leads and post events to your own tools as they happen.",
    requires: [],
    services: [],
    status: "built",
    kind: "app",
    routes: ["/dashboard/connectors/webhooks"],
  },
  {
    key: "apiAccess",
    label: "API access",
    description: "API keys for your own scripts and tools to read your products, campaigns, content, posts and leads.",
    requires: [],
    services: [],
    status: "built",
    kind: "app",
    routes: ["/dashboard/connectors/api"],
  },
  {
    key: "ownComposio",
    label: "Own Composio account",
    description: "Connect hundreds more apps through your own Composio account.",
    requires: [],
    services: [],
    status: "built",
    kind: "service",
    routes: [],
  },
  {
    key: "managed",
    label: "Managed by BuPulse",
    description: "The BuPulse team runs your social media for you with BuPulse: posts made, scheduled and published.",
    requires: ["calendar"],
    services: [],
    status: "built",
    kind: "service",
    routes: [],
  },
  {
    key: "video",
    label: "Videos",
    description: "Short vertical videos made from your photos and scripts, with captions, ready for Reels, TikTok and Shorts. AI video is coming soon.",
    requires: ["content"],
    metric: "videoSeconds",
    // Slideshow videos are drawn in the owner's browser: no outside service.
    services: [],
    status: "built",
    kind: "app",
    routes: [],
  },
  {
    key: "voice",
    label: "Voiceover",
    description: "A spoken voiceover and captions (SRT) for your video scripts.",
    requires: ["content"],
    metric: "voiceCharacters",
    services: [],
    status: "coming_soon",
    kind: "app",
    routes: [],
  },
];

const BY_KEY: Record<FeatureKey, FeatureDef> = Object.fromEntries(FEATURES.map((f) => [f.key, f])) as Record<FeatureKey, FeatureDef>;

export function isFeatureKey(value: unknown): value is FeatureKey {
  return typeof value === "string" && (FEATURE_KEYS as readonly string[]).includes(value);
}

export function featureOf(key: FeatureKey): FeatureDef {
  return BY_KEY[key];
}

export function featureLabel(key: FeatureKey): string {
  return BY_KEY[key].label;
}

/** Keys that can be put in a plan today. */
export const BUILT_FEATURE_KEYS: FeatureKey[] = FEATURES.filter((f) => f.status === "built").map((f) => f.key);

/** Built features that live in the app (what "every feature" means for a plan; services like Managed are sold apart). */
export const BUILT_APP_FEATURE_KEYS: FeatureKey[] = FEATURES.filter((f) => f.status === "built" && f.kind === "app").map((f) => f.key);

/** The keys in registry order, so plans are stored and compared the same way whatever order they were ticked in. */
export function sortFeatureKeys(keys: Iterable<FeatureKey>): FeatureKey[] {
  const set = new Set(keys);
  return FEATURE_KEYS.filter((k) => set.has(k));
}

/** The keys plus every feature they need, directly or through another one. Unknown keys are dropped. */
export function withPrerequisites(keys: Iterable<string>): FeatureKey[] {
  const out = new Set<FeatureKey>();
  const visit = (key: FeatureKey) => {
    if (out.has(key)) return;
    out.add(key);
    for (const need of BY_KEY[key].requires) visit(need);
  };
  for (const key of keys) if (isFeatureKey(key)) visit(key);
  return sortFeatureKeys(out);
}

/** Among `keys`, the features that need `key` (directly or through another one). Empty when it can be removed. */
export function dependentsOf(key: FeatureKey, keys: Iterable<string>): FeatureKey[] {
  const selected = new Set<FeatureKey>();
  for (const k of keys) if (isFeatureKey(k) && k !== key) selected.add(k);
  return sortFeatureKeys([...selected].filter((k) => withPrerequisites([k]).includes(key)));
}

export type FeatureSetProblem =
  | { kind: "unknown"; key: string }
  | { kind: "coming_soon"; key: FeatureKey }
  | { kind: "missing"; key: FeatureKey; neededBy: FeatureKey[] };

/**
 * Checks a plan's feature list: every key exists, none is "coming soon", and every prerequisite is in the list.
 * `message` is one sentence an admin can act on; `keys` is the cleaned, ordered list when there is no problem.
 */
export function validateFeatureSet(input: Iterable<string>): { ok: true; keys: FeatureKey[] } | { ok: false; problems: FeatureSetProblem[]; message: string } {
  const problems: FeatureSetProblem[] = [];
  const keys = new Set<FeatureKey>();
  for (const key of input) {
    if (!isFeatureKey(key)) problems.push({ kind: "unknown", key: String(key) });
    else if (BY_KEY[key].status === "coming_soon") problems.push({ kind: "coming_soon", key });
    else keys.add(key);
  }
  for (const need of FEATURE_KEYS) {
    if (keys.has(need)) continue;
    const neededBy = sortFeatureKeys([...keys].filter((k) => BY_KEY[k].requires.includes(need)));
    if (neededBy.length > 0) problems.push({ kind: "missing", key: need, neededBy });
  }
  if (problems.length === 0) return { ok: true, keys: sortFeatureKeys(keys) };
  const messages = problems.map((p) =>
    p.kind === "unknown"
      ? `"${p.key}" is not a feature.`
      : p.kind === "coming_soon"
        ? `${BY_KEY[p.key].label} is coming soon and cannot be in a plan yet.`
        : `${BY_KEY[p.key].label} is needed by ${p.neededBy.map((k) => BY_KEY[k].label).join(" and ")}.`,
  );
  return { ok: false, problems, message: messages.join(" ") };
}

/** A chain of keys that loops back on itself, or null. The registry test keeps this null. */
export function findCycle(defs: readonly Pick<FeatureDef, "key" | "requires">[] = FEATURES): FeatureKey[] | null {
  const requires = new Map(defs.map((d) => [d.key, d.requires]));
  const state = new Map<FeatureKey, "visiting" | "done">();
  const path: FeatureKey[] = [];
  const walk = (key: FeatureKey): FeatureKey[] | null => {
    const seen = state.get(key);
    if (seen === "done") return null;
    if (seen === "visiting") return [...path.slice(path.indexOf(key)), key];
    state.set(key, "visiting");
    path.push(key);
    for (const need of requires.get(key) ?? []) {
      const found = walk(need);
      if (found) return found;
    }
    path.pop();
    state.set(key, "done");
    return null;
  };
  for (const def of defs) {
    const found = walk(def.key);
    if (found) return found;
  }
  return null;
}

/** The feature a dashboard path belongs to (longest route prefix wins), or null for pages that need none. */
export function featureForRoute(pathname: string): FeatureKey | null {
  let best: { key: FeatureKey; length: number } | null = null;
  for (const f of FEATURES) {
    for (const route of f.routes) {
      if ((pathname === route || pathname.startsWith(`${route}/`)) && (!best || route.length > best.length)) best = { key: f.key, length: route.length };
    }
  }
  return best?.key ?? null;
}

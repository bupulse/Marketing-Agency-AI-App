// The outside services BuPulse depends on. Pure data (no server imports) so tests, the console and the switch can share it.

export const SERVICE_IDS = [
  "gemini",
  "claude",
  "resend",
  "paddle",
  "supabase",
  "turnstile",
  "canva",
  "meta",
  "linkedin",
  "tiktok",
  "youtube",
  "google-drive",
  "dropbox",
  "shopify",
  "woocommerce",
  "cloudflare",
] as const;
export type ServiceId = (typeof SERVICE_IDS)[number];

export function isServiceId(value: unknown): value is ServiceId {
  return typeof value === "string" && (SERVICE_IDS as readonly string[]).includes(value);
}

/** Which service publishes to which network. Facebook and Instagram share one Meta app. */
export const NETWORK_SERVICE: Record<string, ServiceId> = {
  facebook: "meta",
  instagram: "meta",
  linkedin: "linkedin",
  tiktok: "tiktok",
  youtube: "youtube",
};
export const networksOf = (service: ServiceId): string[] => Object.entries(NETWORK_SERVICE).filter(([, s]) => s === service).map(([n]) => n);

/** AI provider names in the AiCall ledger -> service. */
export const AI_PROVIDER_SERVICE: Record<string, ServiceId> = { gemini: "gemini", claude: "claude" };

export type ServiceInfo = {
  id: ServiceId;
  name: string;
  purpose: string;
  /** Environment variable names the service needs. Only names are ever reported, never values. */
  env: string[];
  /** Names that make the service optional-but-better; reported the same way. */
  optionalEnv?: string[];
  /** What stops working for clients when it is off. */
  features: string[];
  /** false: core to sign-in or abuse protection, so there is no off switch. */
  killable: boolean;
  /** One line: what "off" does. */
  whenOff: string;
};

export const SERVICES: ServiceInfo[] = [
  {
    id: "gemini",
    name: "Google Gemini",
    purpose: "Writes captions, scripts and chat replies; makes AI images.",
    env: ["GEMINI_API_KEY"],
    optionalEnv: ["GEMINI_TEXT_MODEL", "GEMINI_TEXT_FALLBACK_MODEL", "GEMINI_IMAGE_MODEL", "WIDGET_MODEL"],
    features: ["Content generation", "AI images", "Autopilot weekly plans", "Website chat replies"],
    killable: true,
    whenOff: "AI writing and images pause with a friendly message. The website chat still collects visitor details.",
  },
  {
    id: "claude",
    name: "Anthropic Claude",
    purpose: "Alternative text model, used only when AI_TEXT_PROVIDER=claude.",
    env: ["ANTHROPIC_API_KEY"],
    optionalEnv: ["CLAUDE_TEXT_MODEL", "CLAUDE_EFFORT"],
    features: ["Content generation (when selected)"],
    killable: true,
    whenOff: "Text generation pauses with a friendly message while Claude is the selected provider.",
  },
  {
    id: "resend",
    name: "Resend",
    purpose: "Sends emails: new-lead alerts, digests, reminders, Autopilot approvals.",
    env: ["RESEND_API_KEY"],
    optionalEnv: ["RESEND_FROM"],
    features: ["Lead alert emails", "Daily lead digest", "Post reminders", "Autopilot emails"],
    killable: true,
    whenOff: "Emails are skipped (leads are still saved and appear in the dashboard and the next digest).",
  },
  {
    id: "paddle",
    name: "Paddle",
    purpose: "Takes payments and manages subscriptions.",
    env: ["PADDLE_API_KEY", "PADDLE_CLIENT_TOKEN", "PADDLE_WEBHOOK_SECRET"],
    optionalEnv: ["PADDLE_ENVIRONMENT", "PADDLE_PRICE_STANDARD_MONTH", "PADDLE_PRICE_STANDARD_YEAR", "PADDLE_PRICE_PRO_MONTH", "PADDLE_PRICE_PRO_YEAR"],
    features: ["New checkouts", "Plan changes and portal", "Refunds and admin plan changes"],
    killable: true,
    whenOff: "New checkouts and admin money actions stop. Webhooks keep being received so no payment event is lost.",
  },
  {
    id: "supabase",
    name: "Supabase",
    purpose: "Database, sign-in and file storage.",
    env: ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY", "DATABASE_URL"],
    features: ["Everything"],
    killable: false,
    whenOff: "Not switchable: BuPulse cannot run without it.",
  },
  {
    id: "turnstile",
    name: "Cloudflare Turnstile",
    purpose: "Stops bots on sign-up and the website chat.",
    env: ["TURNSTILE_SITE_KEY", "TURNSTILE_SECRET_KEY"],
    features: ["Sign-up protection", "Website chat bot check"],
    killable: false,
    whenOff: "Not switchable: switching abuse protection off is never safe.",
  },
  {
    id: "canva",
    name: "Canva",
    purpose: "Edit designs in Canva and import Canva designs.",
    env: ["CANVA_CLIENT_ID", "CANVA_CLIENT_SECRET"],
    optionalEnv: ["CANVA_REDIRECT_URI"],
    features: ["Edit in Canva", "Import from Canva"],
    killable: true,
    whenOff: "Canva connect, edit and import show as temporarily unavailable.",
  },
  {
    id: "meta",
    name: "Meta (Facebook and Instagram)",
    purpose: "Publishes to Facebook Pages and Instagram.",
    env: ["FACEBOOK_APP_ID", "FACEBOOK_APP_SECRET"],
    optionalEnv: ["INSTAGRAM_APP_ID", "INSTAGRAM_APP_SECRET", "META_APP_SECRET"],
    features: ["Facebook posts", "Instagram posts", "Connecting Facebook and Instagram"],
    killable: true,
    whenOff: "Facebook and Instagram posts wait as scheduled (not failed) and publish when it is back on.",
  },
  {
    id: "linkedin",
    name: "LinkedIn",
    purpose: "Publishes to LinkedIn.",
    env: ["LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET"],
    optionalEnv: ["LINKEDIN_COMMUNITY_MANAGEMENT"],
    features: ["LinkedIn posts", "Connecting LinkedIn"],
    killable: true,
    whenOff: "LinkedIn posts wait as scheduled and publish when it is back on.",
  },
  {
    id: "tiktok",
    name: "TikTok",
    purpose: "Sends posts to TikTok.",
    env: ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"],
    optionalEnv: ["TIKTOK_PHOTO_POSTING"],
    features: ["TikTok posts", "Connecting TikTok"],
    killable: true,
    whenOff: "TikTok posts wait as scheduled and publish when it is back on.",
  },
  {
    id: "youtube",
    name: "YouTube (Google)",
    purpose: "Uploads videos to YouTube.",
    env: ["GOOGLE_YOUTUBE_CLIENT_ID", "GOOGLE_YOUTUBE_CLIENT_SECRET"],
    features: ["YouTube posts", "Connecting YouTube"],
    killable: true,
    whenOff: "YouTube posts wait as scheduled and publish when it is back on.",
  },
  {
    id: "google-drive",
    name: "Google Drive Picker",
    purpose: "Lets clients pick photos from Google Drive.",
    env: ["GOOGLE_PICKER_API_KEY", "GOOGLE_PICKER_APP_ID"],
    optionalEnv: ["GOOGLE_CLIENT_ID"],
    features: ["Import from Google Drive"],
    killable: true,
    whenOff: "Drive import shows as temporarily unavailable.",
  },
  {
    id: "dropbox",
    name: "Dropbox Chooser",
    purpose: "Lets clients pick photos from Dropbox.",
    env: ["DROPBOX_APP_KEY"],
    features: ["Import from Dropbox"],
    killable: true,
    whenOff: "Dropbox import shows as temporarily unavailable.",
  },
  {
    id: "shopify",
    name: "Shopify",
    purpose: "Imports products from clients' Shopify stores.",
    env: ["SHOPIFY_API_KEY", "SHOPIFY_API_SECRET"],
    optionalEnv: ["SHOPIFY_API_VERSION"],
    features: ["Connect Shopify", "Import and re-sync products"],
    killable: true,
    whenOff: "Shopify connect, import and the daily re-sync pause; stored products are untouched.",
  },
  {
    id: "woocommerce",
    name: "WooCommerce",
    purpose: "Imports products from clients' WooCommerce stores (each client's own keys).",
    env: [],
    features: ["Connect WooCommerce", "Import and re-sync products"],
    killable: true,
    whenOff: "WooCommerce connect, import and the daily re-sync pause; stored products are untouched.",
  },
  {
    id: "cloudflare",
    name: "Cloudflare API",
    purpose: "Installs the chat widget on clients' websites (their own API token).",
    env: [],
    features: ["Connect Cloudflare", "One-click widget install"],
    killable: true,
    whenOff: "Cloudflare connect and install show as temporarily unavailable; the copy-paste snippet still works.",
  },
];

export const serviceInfo = (id: ServiceId) => SERVICES.find((s) => s.id === id)!;

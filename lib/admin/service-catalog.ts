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
  "twitter",
  "google-drive",
  "dropbox",
  "link-import",
  "shopify",
  "woocommerce",
  "cloudflare",
  "elevenlabs",
  "whatsapp",
  "seedance",
  "veo",
  "premium3d",
  "composio",
  "studio",
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
  twitter: "twitter",
};
export const networksOf = (service: ServiceId): string[] => Object.entries(NETWORK_SERVICE).filter(([, s]) => s === service).map(([n]) => n);

/** AI provider names in the AiCall ledger -> service. */
export const AI_PROVIDER_SERVICE: Record<string, ServiceId> = { gemini: "gemini", claude: "claude", elevenlabs: "elevenlabs", byteplus: "seedance", veo: "veo" };

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
  /**
   * BuPulse cannot work properly without it, so missing keys are a problem on the Overview ("always", or only in
   * "production"). Every other service without keys is simply not set up yet: shown on Services as "Not connected".
   */
  core?: "always" | "production";
  /** One line: what "off" does. */
  whenOff: string;
  /**
   * Off until an admin switches it on (a missing switch row means off, not on): for a service that costs money per
   * use and needs setup outside BuPulse first.
   */
  defaultOff?: true;
};

export const SERVICES: ServiceInfo[] = [
  {
    id: "elevenlabs",
    name: "ElevenLabs",
    purpose: "Speaks the voiceover of content videos (text to speech).",
    env: ["ELEVENLABS_API_KEY"],
    optionalEnv: ["ELEVENLABS_MODEL"],
    features: ["Voiceover on videos", "Video Studio voice-overs (coming soon)"],
    killable: true,
    whenOff: "Videos are made without a voiceover, with captions and music only.",
  },
  {
    id: "gemini",
    name: "Google Gemini",
    purpose: "Writes captions, scripts and chat replies; makes AI images.",
    env: ["GEMINI_API_KEY"],
    optionalEnv: ["GEMINI_TEXT_MODEL", "GEMINI_TEXT_FALLBACK_MODEL", "GEMINI_IMAGE_MODEL", "WIDGET_MODEL"],
    features: ["Content generation", "AI images", "Autopilot weekly plans", "Website chat replies"],
    killable: true,
    core: "always",
    whenOff: "AI writing and images pause with a friendly message. The website chat still collects visitor details.",
  },
  {
    id: "claude",
    name: "Anthropic Claude",
    purpose: "Alternative text model, used only when AI_TEXT_PROVIDER=claude. The Video Studio (coming soon) designs its videos and writes its Seedance prompts with it, through ANTHROPIC_API_KEY only (docs/VIDEO_APP_INTEGRATION.md).",
    env: ["ANTHROPIC_API_KEY"],
    optionalEnv: ["CLAUDE_TEXT_MODEL", "CLAUDE_EFFORT"],
    features: ["Content generation (when selected)", "Video Studio design (coming soon)"],
    killable: true,
    whenOff: "Text generation pauses with a friendly message while Claude is the selected provider. Once the Video Studio is live, video design pauses too; finished videos and scheduled posts are not affected.",
  },
  {
    id: "resend",
    name: "Resend",
    purpose: "Sends emails: new-lead alerts, digests, reminders, Autopilot approvals.",
    env: ["RESEND_API_KEY"],
    optionalEnv: ["RESEND_FROM"],
    features: ["Lead alert emails", "Daily lead digest", "Post reminders", "Autopilot emails"],
    killable: true,
    core: "always",
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
    core: "always",
    whenOff: "Not switchable: BuPulse cannot run without it.",
  },
  {
    id: "turnstile",
    name: "Cloudflare Turnstile",
    purpose: "Stops bots on sign-up and the website chat.",
    env: ["TURNSTILE_SITE_KEY", "TURNSTILE_SECRET_KEY"],
    features: ["Sign-up protection", "Website chat bot check"],
    killable: false,
    core: "production",
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
    optionalEnv: ["INSTAGRAM_APP_ID", "INSTAGRAM_APP_SECRET", "META_APP_SECRET", "META_WEBHOOK_VERIFY_TOKEN"],
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
    purpose:
      "Sends posts to TikTok. Two ways: BuPulse's own TikTok app with its own sign-in (TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET), or the same kind of app added in Composio as an auth config, whose id goes in COMPOSIO_TIKTOK_AUTH_CONFIG_ID: clients then connect TikTok through BuPulse-Socials and BuPulse uploads their videos (to the TikTok inbox, or posted directly once TIKTOK_DIRECT_POST=true after TikTok's audit).",
    env: ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"],
    optionalEnv: ["TIKTOK_PHOTO_POSTING", "COMPOSIO_TIKTOK_AUTH_CONFIG_ID", "TIKTOK_DIRECT_POST"],
    features: ["TikTok posts", "Connecting TikTok"],
    killable: true,
    whenOff: "TikTok posts wait as scheduled and publish when it is back on.",
  },
  {
    id: "twitter",
    name: "X (Twitter)",
    purpose:
      "Posts to X. Composio has no X app of its own, so BuPulse's X developer app is added in Composio as an auth config and its id goes in COMPOSIO_TWITTER_AUTH_CONFIG_ID; clients then connect X through BuPulse-Socials. X has no free plan: it charges BuPulse's X account for every call (about $0.015 a post, $0.20 a post with a link, $0.005 a post read), so it stays off until it is switched on here.",
    env: ["COMPOSIO_TWITTER_AUTH_CONFIG_ID"],
    features: ["X posts", "Connecting X", "X post numbers (read about once a week)"],
    killable: true,
    defaultOff: true,
    whenOff: "X shows \"Coming soon\" in Channels and X posts wait as scheduled. Off until the owner switches it on, after the X app has credit.",
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
    id: "link-import",
    name: "Import from a link",
    purpose: "Lets clients paste a link (Google Drive, Dropbox or any website) and copies the photo or video into their gallery. BuPulse's server downloads the file; no keys needed.",
    env: [],
    features: ["Import from a link"],
    killable: true,
    whenOff: "\"From a link\" shows as coming soon and link imports are refused.",
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
  {
    id: "whatsapp",
    name: "WhatsApp Cloud API (Meta)",
    purpose: "Sends new-lead alerts to business owners on WhatsApp (an approved utility template, paid per message).",
    env: ["WHATSAPP_CLOUD_TOKEN", "WHATSAPP_PHONE_NUMBER_ID"],
    optionalEnv: ["WHATSAPP_ALERT_TEMPLATE", "WHATSAPP_TEMPLATE_LANGUAGE"],
    features: ["WhatsApp lead alerts"],
    killable: true,
    defaultOff: true,
    whenOff: "No WhatsApp alerts are sent and clients do not see the option; email and phone alerts carry on. Off until switched on (docs/RELEASE_2.0.md).",
  },
  {
    id: "seedance",
    name: "Seedance 2.0 (BytePlus ModelArk)",
    purpose: "ByteDance's AI video model: filmed-looking clips from text, photos and digital characters. The Video Studio's AI video (coming soon) uses it; no client feature calls it yet. SEEDANCE_USD_PER_M_TOKENS sets the cost estimate; the BytePlus Access Key (BYTEPLUS_ACCESS_KEY_ID and BYTEPLUS_SECRET_ACCESS_KEY) lists the account's digital characters.",
    env: ["SEEDANCE_API_KEY"],
    optionalEnv: ["SEEDANCE_MODEL", "SEEDANCE_BASE_URL", "SEEDANCE_USD_PER_M_TOKENS", "BYTEPLUS_ACCESS_KEY_ID", "BYTEPLUS_SECRET_ACCESS_KEY"],
    features: ["AI video (Video Studio, coming soon)"],
    killable: true,
    whenOff: "Nothing changes for clients today: no feature uses Seedance yet. Once AI video is built, it pauses with a friendly message.",
  },
  {
    id: "veo",
    name: "Google Veo AI clips",
    purpose: "Google's AI video model (Veo 3.1 Lite through the Gemini API): short real moving clips of the client's product, mixed into Video Studio videos when the client picks \"AI makes the clips\" (docs/VIDEO_ENGINE.md, \"Veo AI clips\"). It uses the Gemini key (GEMINI_API_KEY, billing must be on: Veo has no free tier) and is billed per second of video ($0.05 at 720p). VEO_MODEL changes the model (default veo-3.1-lite-generate-preview); VEO_USD_PER_SECOND overrides the price used for credits and costs.",
    env: ["GEMINI_API_KEY"],
    optionalEnv: ["VEO_MODEL", "VEO_USD_PER_SECOND"],
    features: ["AI clips in Video Studio videos (\"AI makes the clips\")"],
    killable: true,
    // Paid per second: off until the owner switches it on.
    defaultOff: true,
    whenOff: "The \"AI makes the clips\" choice is hidden in the Video Studio, with a short note that AI clips are paused. Videos are made from the client's photos and their own clips; clips already made stay in their videos and Gallery. Off until the owner switches it on (Veo is paid per second of video).",
  },
  {
    id: "composio",
    name: "Composio",
    purpose: "\"BuPulse-Socials\": BuPulse's own Composio account. Clients connect Facebook, Instagram, LinkedIn and YouTube through Composio's approved apps (no Composio account for them), and BuPulse posts through it, while BuPulse's own apps wait for Meta, LinkedIn and Google. TikTok and X join once BuPulse's own TikTok and X apps are added in Composio (their auth config ids are on the TikTok and X cards). SOCIALS_DIRECT (optional, e.g. facebook,instagram) sends those networks back to BuPulse's own apps once approved.",
    env: ["COMPOSIO_API_KEY"],
    optionalEnv: ["SOCIALS_DIRECT"],
    features: ["Connecting Facebook, Instagram, LinkedIn and YouTube (BuPulse-Socials), and TikTok and X once their apps are added", "Posting and post numbers for accounts connected that way"],
    killable: true,
    whenOff: "New social connections use BuPulse's own apps instead (\"Coming soon\" where those are not set up). Accounts already connected through BuPulse-Socials keep posting through it.",
  },
  {
    id: "premium3d",
    name: "Premium 3D (Blender)",
    purpose: "Real 3D product clips in the Video Studio: Claude designs a Blender scene from the product and Blender renders it on the studio computer, one clip at a time (docs/BLENDER.md, docs/STUDIO_DEPLOY.md item 9). Clients pay 100 credits at 540p, 150 at 720p, 70 for a re-render. BLENDER_BIN points at Blender when it is not in /Applications; BLENDER_TIMEOUT_MS stops a render that runs too long (default 30 minutes).",
    env: [],
    optionalEnv: ["BLENDER_BIN", "BLENDER_TIMEOUT_MS"],
    features: ["Premium 3D clips for clients in the Video Studio"],
    killable: true,
    // The studio computer renders one clip at a time: off until the owner opens it to clients after Motion is live.
    defaultOff: true,
    whenOff: "Clients see Premium 3D as \"coming soon\" in the Video Studio and cannot start a clip. Clips already queued still render, and finished ones stay in their library. The owner's own tests on the studio are not affected. Off until the owner switches it on.",
  },
  {
    id: "studio",
    name: "Video Studio",
    purpose: "BuPulse's own video site (studio.bupulse.com, docs/VIDEO_STUDIO_SPLIT.md), where clients make their marketing videos. \"Open Video Studio\" in BuPulse signs them in with one click, and every video it finishes appears in their Videos library. STUDIO_URL changes the address (default https://studio.bupulse.com).",
    env: [],
    optionalEnv: ["STUDIO_URL"],
    features: ["Open Video Studio (one-click sign-in)", "Making new studio videos"],
    killable: true,
    defaultOff: true,
    whenOff: "Clients see \"Video Studio: coming soon\" instead of the button, and nobody new can sign in to the studio. Their Videos library, scheduled videos and credits stay as they are.",
  },
];

export const serviceInfo = (id: ServiceId) => SERVICES.find((s) => s.id === id)!;

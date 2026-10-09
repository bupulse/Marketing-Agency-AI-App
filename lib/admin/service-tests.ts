import "server-only";
import { prisma } from "@/lib/db";
import { paddleApi } from "@/lib/billing/paddle";
import { serviceInfo, type ServiceId } from "./service-catalog";
import { scrubSecrets } from "./scrub";

// One cheap "Test now" per service. Each is a free (or almost free) call that proves the key works; OAuth-only services
// check that their configuration is present. Messages are scrubbed before they are stored or shown.

export type ProbeResult = { ok: boolean; message: string };
const TIMEOUT_MS = 8_000;
const env = (name: string) => process.env[name] || "";

const missing = (id: ServiceId) => serviceInfo(id).env.filter((n) => !env(n));

async function get(url: string, headers: Record<string, string> = {}, init: RequestInit = {}) {
  return fetch(url, { ...init, headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
}

const configOnly = (id: ServiceId): Probe => async () => {
  const names = serviceInfo(id).env;
  if (names.length === 0) return { ok: true, message: "Nothing to test here: each client connects with their own keys." };
  const gone = missing(id);
  return gone.length ? { ok: false, message: `Missing in the environment: ${gone.join(", ")}` } : { ok: true, message: "Configured. Sign-in with this service is only exercised by a client connecting." };
};

type Probe = () => Promise<ProbeResult>;

const PROBES: Partial<Record<ServiceId, Probe>> = {
  gemini: async () => {
    const res = await get("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", { "x-goog-api-key": env("GEMINI_API_KEY") });
    return res.ok ? { ok: true, message: "Gemini answered (models list)." } : { ok: false, message: `Gemini returned ${res.status}.` };
  },
  claude: async () => {
    if ((env("AI_TEXT_PROVIDER") || "gemini").toLowerCase() !== "claude" && !env("ANTHROPIC_API_KEY")) return { ok: true, message: "Not in use (AI_TEXT_PROVIDER is not claude)." };
    const res = await get("https://api.anthropic.com/v1/models?limit=1", { "x-api-key": env("ANTHROPIC_API_KEY"), "anthropic-version": "2023-06-01" });
    return res.ok ? { ok: true, message: "Anthropic answered (models list)." } : { ok: false, message: `Anthropic returned ${res.status}.` };
  },
  resend: async () => {
    const res = await get("https://api.resend.com/domains", { authorization: `Bearer ${env("RESEND_API_KEY")}` });
    if (res.ok) return { ok: true, message: "Resend answered (domains list)." };
    const body = (await res.text().catch(() => "")).slice(0, 300);
    // A key limited to sending is rejected here but is valid for sending, which is all BuPulse needs.
    if (res.status === 401 && /restricted_api_key/.test(body)) return { ok: true, message: "Key is valid (limited to sending emails)." };
    return { ok: false, message: `Resend returned ${res.status}.` };
  },
  paddle: async () => {
    const events = await paddleApi<unknown[]>("/event-types");
    return { ok: true, message: `Paddle answered (${Array.isArray(events) ? events.length : "?"} event types, ${env("PADDLE_ENVIRONMENT") === "production" ? "production" : "sandbox"}).` };
  },
  supabase: async () => {
    await prisma.$queryRaw`SELECT 1`;
    const res = await get(`${env("NEXT_PUBLIC_SUPABASE_URL")}/auth/v1/health`, { apikey: env("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY") });
    return res.ok ? { ok: true, message: "Database and sign-in both answered." } : { ok: false, message: `Database answered, sign-in returned ${res.status}.` };
  },
  turnstile: async () => {
    const res = await get("https://challenges.cloudflare.com/turnstile/v0/siteverify", { "content-type": "application/x-www-form-urlencoded" }, { method: "POST", body: new URLSearchParams({ secret: env("TURNSTILE_SECRET_KEY"), response: "bupulse-health-check" }) });
    const json = (await res.json().catch(() => null)) as { "error-codes"?: string[] } | null;
    const codes = json?.["error-codes"] ?? [];
    if (codes.includes("invalid-input-secret") || codes.includes("missing-input-secret")) return { ok: false, message: "Turnstile rejected the secret key." };
    return { ok: true, message: "Turnstile accepted the secret key." };
  },
  meta: async () => {
    const id = env("FACEBOOK_APP_ID");
    const res = await get(`https://graph.facebook.com/${encodeURIComponent(id)}?fields=name&access_token=${encodeURIComponent(`${id}|${env("FACEBOOK_APP_SECRET")}`)}`);
    return res.ok ? { ok: true, message: "Meta accepted the app id and secret." } : { ok: false, message: `Meta returned ${res.status}.` };
  },
  youtube: async () => {
    // A made-up code: "invalid_grant" means Google accepted the client id and secret; "invalid_client" means it did not.
    const res = await get("https://oauth2.googleapis.com/token", { "content-type": "application/x-www-form-urlencoded" }, {
      method: "POST",
      body: new URLSearchParams({ grant_type: "authorization_code", code: "bupulse-health-check", client_id: env("GOOGLE_YOUTUBE_CLIENT_ID"), client_secret: env("GOOGLE_YOUTUBE_CLIENT_SECRET"), redirect_uri: "https://bupulse.com/health" }),
    });
    const json = (await res.json().catch(() => null)) as { error?: string } | null;
    if (json?.error === "invalid_client") return { ok: false, message: "Google rejected the client id or secret." };
    return { ok: true, message: "Google accepted the client id and secret." };
  },
  cloudflare: async () => {
    const res = await get("https://api.cloudflare.com/client/v4/ips");
    return res.ok ? { ok: true, message: "Cloudflare's API is reachable (each client uses their own token)." } : { ok: false, message: `Cloudflare's API returned ${res.status}.` };
  },
};

/** Runs the probe for one service and returns a scrubbed result with how long it took. Never throws. */
export async function runProbe(id: ServiceId): Promise<ProbeResult & { latencyMs: number }> {
  const started = Date.now();
  const info = serviceInfo(id);
  const absent = missing(id);
  const inUse = id !== "claude" || (env("AI_TEXT_PROVIDER") || "gemini").toLowerCase() === "claude" || Boolean(env("ANTHROPIC_API_KEY"));
  let result: ProbeResult;
  try {
    if (absent.length && inUse && info.env.length) {
      result = { ok: false, message: `Missing in the environment: ${absent.join(", ")}` };
    } else {
      result = await (PROBES[id] ?? configOnly(id))();
    }
  } catch (error) {
    result = { ok: false, message: error instanceof Error ? error.message : "The test failed." };
  }
  return { ok: result.ok, message: scrubSecrets(result.message, 240), latencyMs: Date.now() - started };
}

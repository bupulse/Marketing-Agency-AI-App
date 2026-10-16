import { SERVICES, type ServiceId } from "./service-catalog";

// Rules for the keys an admin saves in Admin -> Services (lib/admin/service-keys.ts stores them). Pure, so the page,
// the scrubber and tests share them.
//
// - A service's own keys (its `env` and `optionalEnv` names) can be saved for every service except Supabase (BuPulse
//   needs it to start, before it can read anything saved) and Paddle (its keys have their own form in Admin ->
//   Settings -> Card payments, which checks their format and environment).
// - A custom key is any other outside service the owner wants to keep a key for: a name, what it is for, an optional
//   website and the value, kept under an environment-variable style name of the owner's choosing. It never replaces a
//   variable the hosting environment already sets, nor one of BuPulse's own settings.

/** Where a service's keys are entered. */
export type KeysWhere = "here" | "settings" | "host" | "none";

export function keysWhere(id: ServiceId): KeysWhere {
  const info = SERVICES.find((s) => s.id === id);
  if (!info || (info.env.length === 0 && !(info.optionalEnv ?? []).length)) return "none";
  if (id === "supabase") return "host";
  if (id === "paddle") return "settings";
  return "here";
}

/** Every variable that can be saved on a service card, mapped to its service. */
export const SAVABLE_KEYS: ReadonlyMap<string, ServiceId> = new Map(
  SERVICES.filter((s) => keysWhere(s.id) === "here").flatMap((s) => [...s.env, ...(s.optionalEnv ?? [])].map((name) => [name, s.id] as const)),
);

export const isSavableKey = (name: string) => SAVABLE_KEYS.has(name);

/** Names that look secret: shown only by their last 4 characters. Others (a model name, an API version) are shown in full. */
export const SECRET_NAME = /KEY|SECRET|TOKEN|PASSWORD|DATABASE_URL|DIRECT_URL|SIGNING/i;
export const isSecretName = (name: string) => SECRET_NAME.test(name);

/** Every name a service in the catalog uses, saved here or not (a custom key may not take one). */
const CATALOG_NAMES = new Set(SERVICES.flatMap((s) => [...s.env, ...(s.optionalEnv ?? [])]));

/** BuPulse's own settings and the platforms' variables: never a custom key. */
const RESERVED_PREFIX = /^(NEXT_|NODE_|SUPABASE_|PADDLE_|ENCRYPTION_KEY|DATABASE_|DIRECT_|VERCEL|NETLIFY|CF_|CLOUDFLARE_|OPEN_NEXT|AWS_|LAMBDA_|GITHUB_|CI$|__)/;
const RESERVED = new Set([
  "API_KEY_PEPPER", "CRON_SECRET", "VIDEO_ROBOT_SECRET", "BILLING_SIGNING_SECRET", "AUTH_EXTRA_ORIGINS", "PUBLIC_LINK_URL", "SITE_URL",
  "PLATFORM", "DEPLOY_TARGET", "AI_TEXT_PROVIDER", "PATH", "HOME", "USER", "SHELL", "TZ", "PORT", "HOSTNAME", "LANG", "PWD",
  "VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT", "REGION_OVERRIDE", "DEPLOYMENT_ID",
]);

export const CUSTOM_NAME = /^[A-Z][A-Z0-9_]{2,63}$/;

/**
 * Why `envName` cannot be a custom key, or null. `hostSet`: the hosting environment already sets it (outside anything
 * saved here), so a custom key would silently replace it.
 */
export function customNameProblem(envName: string, opts: { hostSet?: boolean; taken?: boolean } = {}): string | null {
  if (!CUSTOM_NAME.test(envName)) return "The variable name uses capital letters, digits and _ only, starts with a letter and is 3 to 64 characters, for example SEEDREAM_API_KEY.";
  if (CATALOG_NAMES.has(envName)) return `${envName} belongs to a service on this page: enter it on that service's card instead.`;
  if (RESERVED.has(envName) || RESERVED_PREFIX.test(envName)) return `${envName} is one of BuPulse's own settings, so it cannot be a custom key. Pick another name.`;
  if (opts.taken) return `There is already a custom key called ${envName}.`;
  if (opts.hostSet) return `${envName} is already set in the hosting environment. Pick another name so that value is not replaced.`;
  return null;
}

/** Why `value` cannot be saved for `name`, or null. Keys have no spaces; a setting such as a model name is one line. */
export function keyValueProblem(name: string, value: string): string | null {
  if (!value) return "Paste the value first.";
  if (value.length > 4000) return "That value is too long (at most 4,000 characters).";
  if (/[\u0000-\u001f\u007f]/.test(value)) return "Paste the value on one line, without line breaks.";
  if (isSecretName(name) && /\s/.test(value)) return "A key has no spaces. Copy it again from the service's dashboard.";
  if (isSecretName(name) && value.length < 8) return "That key looks too short. Copy the whole key from the service's dashboard.";
  return null;
}

/** What the page shows instead of a value: the last 4 characters of a secret, the whole of a plain setting. */
export function shownValue(name: string, value: string): string {
  return isSecretName(name) ? value.slice(-4) : value.slice(0, 80);
}

/**
 * Names of the custom keys in use (the loader fills it), so the scrubber can remove their values from messages too.
 * Holds names only, never values.
 */
export const customKeyNames = new Set<string>();

import "server-only";
import { serviceInfo, type ServiceId } from "@/lib/admin/service-catalog";
import { featuresNotSetUp, type FeatureKey } from "@/lib/features";

// Which features can be sold right now (lib/features.ts featuresNotSetUp): a feature is "Coming soon" while none of the
// services it runs on has BuPulse's keys. Only whether variables are SET is read, never their values.

type Env = Record<string, string | undefined>;

/**
 * BuPulse's own keys for a service are set. A service that needs none (WooCommerce: each client pastes their own) is
 * always set up, and so is a core one (Gemini): without it BuPulse is broken, which Health reports, not a reason to stop
 * selling the features that run on it.
 */
export function serviceSetUp(id: ServiceId, env: Env = process.env): boolean {
  const info = serviceInfo(id);
  if (!info) return false;
  if (info.core === "always") return true;
  if (!info.env.every((name) => Boolean(env[name]))) return false;
  // The Drive picker also needs an OAuth client (lib/media/importers.ts googlePickerConfig).
  if (id === "google-drive") return Boolean(env.GOOGLE_CLIENT_ID || env.GOOGLE_YOUTUBE_CLIENT_ID);
  return true;
}

/** The built features that cannot be used yet because none of their services is set up. */
export const notSetUpFeatures = (env: Env = process.env): FeatureKey[] => featuresNotSetUp((id) => serviceSetUp(id, env));

import { SocialError, type NetworkRules, type SocialProvider } from "../types";

// Placeholder until the TikTok provider is built: not configured, so its Connect button stays hidden.
const rules: NetworkRules = { network: "tiktok", label: "TikTok", maxText: 2200, requiresMedia: true, maxImages: 35, formats: ["SCRIPT"], videoOnly: true };

export const tiktokProvider: SocialProvider = {
  network: "tiktok",
  rules,
  isConfigured: () => false,
  authorizeUrl: () => {
    throw new SocialError("TikTok is not set up yet", "invalid", "tiktok");
  },
  finishOAuth: async () => {
    throw new SocialError("TikTok is not set up yet", "invalid", "tiktok");
  },
  publish: async () => {
    throw new SocialError("TikTok is not set up yet", "invalid", "tiktok");
  },
};

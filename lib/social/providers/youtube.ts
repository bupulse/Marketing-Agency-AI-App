import { SocialError, type NetworkRules, type SocialProvider } from "../types";

// Placeholder until the YouTube provider is built: not configured, so its Connect button stays hidden.
const rules: NetworkRules = { network: "youtube", label: "YouTube", maxText: 5000, requiresMedia: true, maxImages: 0, formats: ["SCRIPT"], videoOnly: true };

export const youtubeProvider: SocialProvider = {
  network: "youtube",
  rules,
  isConfigured: () => false,
  authorizeUrl: () => {
    throw new SocialError("YouTube is not set up yet", "invalid", "youtube");
  },
  finishOAuth: async () => {
    throw new SocialError("YouTube is not set up yet", "invalid", "youtube");
  },
  publish: async () => {
    throw new SocialError("YouTube is not set up yet", "invalid", "youtube");
  },
};

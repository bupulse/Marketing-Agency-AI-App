import { SocialError, type NetworkRules, type SocialProvider } from "../types";

// Placeholder until the Facebook provider is built: not configured, so its Connect button stays hidden.
const rules: NetworkRules = { network: "facebook", label: "Facebook", maxText: 63206, requiresMedia: false, maxImages: 10, formats: ["POST", "CAROUSEL"], videoOnly: false };

export const facebookProvider: SocialProvider = {
  network: "facebook",
  rules,
  isConfigured: () => false,
  authorizeUrl: () => {
    throw new SocialError("Facebook is not set up yet", "invalid", "facebook");
  },
  finishOAuth: async () => {
    throw new SocialError("Facebook is not set up yet", "invalid", "facebook");
  },
  publish: async () => {
    throw new SocialError("Facebook is not set up yet", "invalid", "facebook");
  },
};

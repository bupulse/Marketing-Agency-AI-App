import { SocialError, type NetworkRules, type SocialProvider } from "../types";

// Placeholder until the LinkedIn provider is built: not configured, so its Connect button stays hidden.
const rules: NetworkRules = { network: "linkedin", label: "LinkedIn", maxText: 3000, requiresMedia: false, maxImages: 9, formats: ["POST", "CAROUSEL", "ARTICLE"], videoOnly: false };

export const linkedinProvider: SocialProvider = {
  network: "linkedin",
  rules,
  isConfigured: () => false,
  authorizeUrl: () => {
    throw new SocialError("LinkedIn is not set up yet", "invalid", "linkedin");
  },
  finishOAuth: async () => {
    throw new SocialError("LinkedIn is not set up yet", "invalid", "linkedin");
  },
  publish: async () => {
    throw new SocialError("LinkedIn is not set up yet", "invalid", "linkedin");
  },
};

// The platform layer: one place for everything that differs between Cloudflare Workers and Netlify Functions.
// PLATFORM=netlify|cloudflare|node selects the host; without it the host is detected (lib/platform/detect.ts).
// docs/DEPLOY_NETLIFY.md explains each part.
export { currentPlatform, type Platform } from "./detect";
export { clientIp, cleanCountry, countryFromNetlifyGeo, trustedClientIp, visitorCountry } from "./headers";
export { waitUntil } from "./background";
export { sharedCache } from "./cache";
export { poolMax, requestDatabase, type RequestDatabase } from "./database";
export { hasShortRequestLimit, NETLIFY_FUNCTION_LIMIT_MS, timeBudget } from "./limits";

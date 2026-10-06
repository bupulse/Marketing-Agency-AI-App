import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// No incremental cache: the app is dynamic and signed-in. Add R2 caching later
// if public pages need ISR (https://opennext.js.org/cloudflare/caching).
export default defineCloudflareConfig();

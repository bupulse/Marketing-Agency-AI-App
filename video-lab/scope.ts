// What a client may see and do (docs/STUDIO_DEPLOY.md, item 3). Pure rules, used by video-lab/server.ts and tested in
// tests/video-lab/scope.test.ts. A client's requests are scoped to the business in their session; the owner is not.

/**
 * Every route of video-lab/server.ts and who may use it (tests/video-lab/routes.test.ts fails when a route is added
 * without an entry here, and scripts/video-lab/qa-routes.mjs walks them all as a visitor and as a client):
 * - "public": answered before anyone is signed in (sign-in, sign-out, the stylesheet).
 * - "any": a signed-in client (scoped to their business, see the other rules) or the owner.
 * - "owner": the owner only; a client gets the studio's 404.
 * `path` is the literal path or the regex the server matches; `sample` is a real path of it (for the walkers).
 * `page` marks HTML the owner's door serves (a client gets the 404 page, not JSON).
 */
export type RouteWho = "public" | "any" | "owner";
export type RoutePolicy = { method: string; path: string | RegExp; who: RouteWho; sample: string; page?: boolean };
export const ROUTES: RoutePolicy[] = [
  { method: "GET", path: "/logout", who: "public", sample: "/logout" },
  { method: "GET", path: "/auth/bupulse", who: "public", sample: "/auth/bupulse?ticket=nothing" },
  { method: "GET", path: "/site.css", who: "public", sample: "/site.css" },
  { method: "GET", path: "/healthz", who: "public", sample: "/healthz" },
  { method: "GET", path: "/login", who: "public", sample: "/login" },
  { method: "POST", path: "/login", who: "public", sample: "/login" },
  { method: "GET", path: /^\/static\/([a-z0-9-]{1,60})\.(png|jpg|webp)$/, who: "any", sample: "/static/step-1.jpg" },
  { method: "GET", path: "/lab", who: "owner", sample: "/lab", page: true },
  { method: "GET", path: "/app.js", who: "owner", sample: "/app.js", page: true },
  { method: "GET", path: /^\/js\/([a-z]+)\.js$/, who: "any", sample: "/js/site.js" },
  { method: "GET", path: "/api/session", who: "any", sample: "/api/session" },
  { method: "GET", path: "/api/wallet", who: "any", sample: "/api/wallet" },
  { method: "POST", path: "/api/wallet/topup", who: "owner", sample: "/api/wallet/topup" },
  { method: "GET", path: "/api/pricing", who: "any", sample: "/api/pricing" },
  { method: "POST", path: "/api/quote", who: "any", sample: "/api/quote" },
  { method: "GET", path: "/api/viral", who: "owner", sample: "/api/viral" },
  { method: "GET", path: /^\/viral\/frames\/([^/]+)\/([^/]+)\/([^/]+)$/, who: "owner", sample: "/viral/frames/tiktok/vt-tt-001/f1.jpg" },
  { method: "GET", path: "/api/showcase", who: "any", sample: "/api/showcase" },
  { method: "POST", path: "/api/media", who: "any", sample: "/api/media" },
  { method: "GET", path: /^\/api\/voice\/([0-9a-f]{40})\.mp3$/, who: "owner", sample: "/api/voice/0123456789012345678901234567890123456789.mp3" },
  { method: "GET", path: /^\/api\/media\/(um-[0-9a-f]{12})$/, who: "any", sample: "/api/media/um-0123456789ab" },
  { method: "POST", path: "/api/seedance/prompt", who: "any", sample: "/api/seedance/prompt" },
  { method: "POST", path: "/api/seedance/plan", who: "any", sample: "/api/seedance/plan" },
  { method: "POST", path: "/api/seedance/check", who: "any", sample: "/api/seedance/check" },
  { method: "GET", path: "/api/seedance/examples", who: "any", sample: "/api/seedance/examples" },
  { method: "GET", path: "/api/seedance/characters", who: "any", sample: "/api/seedance/characters" },
  { method: "GET", path: /^\/api\/seedance\/characters\/(preview-[a-z]+)\/portrait\.png$/, who: "any", sample: "/api/seedance/characters/preview-amina/portrait.png" },
  { method: "GET", path: "/api/seedance/status", who: "any", sample: "/api/seedance/status" },
  { method: "POST", path: "/api/seedance/submit", who: "any", sample: "/api/seedance/submit" },
  { method: "GET", path: "/api/seedance/jobs", who: "any", sample: "/api/seedance/jobs" },
  { method: "GET", path: /^\/api\/seedance\/jobs\/(sd-[0-9a-f]{12})\/overlay(\/video)?$/, who: "any", sample: "/api/seedance/jobs/sd-0123456789ab/overlay" },
  { method: "GET", path: /^\/videos\/seedance\/(sd-[0-9a-f]{12})-text\.mp4$/, who: "any", sample: "/videos/seedance/sd-0123456789ab-text.mp4" },
  { method: "GET", path: /^\/api\/seedance\/jobs\/(sd-[0-9a-f]{12})(\/cancel|\/preview)?$/, who: "any", sample: "/api/seedance/jobs/sd-0123456789ab" },
  { method: "GET", path: /^\/videos\/seedance\/(sd-[0-9a-f]{12})\.mp4$/, who: "any", sample: "/videos/seedance/sd-0123456789ab.mp4" },
  { method: "GET", path: "/fonts/video/", who: "any", sample: "/fonts/video/none.woff2" },
  { method: "GET", path: "/api/options", who: "any", sample: "/api/options" },
  { method: "GET", path: "/api/businesses", who: "owner", sample: "/api/businesses" },
  { method: "GET", path: "/api/products", who: "any", sample: "/api/products" },
  { method: "GET", path: "/api/cutouts", who: "any", sample: "/api/cutouts" },
  { method: "GET", path: /^\/api\/photo\/([A-Za-z0-9-]{8,40})$/, who: "any", sample: "/api/photo/00000000-0000-0000-0000-000000000000" },
  { method: "GET", path: "/api/influencers", who: "any", sample: "/api/influencers" },
  { method: "GET", path: /^\/api\/influencers\/([a-z-]{2,20})\/(portrait|shot)$/, who: "any", sample: "/api/influencers/amina/portrait" },
  { method: "POST", path: /^\/api\/influencers\/([a-z-]+)\/portrait$/, who: "owner", sample: "/api/influencers/amina/portrait" },
  { method: "GET", path: "/api/blender/status", who: "any", sample: "/api/blender/status" },
  { method: "GET", path: "/api/blender/look", who: "any", sample: "/api/blender/look" },
  { method: "POST", path: "/api/blender/render", who: "any", sample: "/api/blender/render" },
  { method: "GET", path: "/api/blender/jobs", who: "any", sample: "/api/blender/jobs" },
  { method: "POST", path: /^\/api\/blender\/jobs\/(bl-[0-9a-f]{12})\/rerender$/, who: "any", sample: "/api/blender/jobs/bl-0123456789ab/rerender" },
  { method: "GET", path: /^\/api\/blender\/jobs\/(bl-[0-9a-f]{12})$/, who: "any", sample: "/api/blender/jobs/bl-0123456789ab" },
  { method: "GET", path: /^\/videos\/blender\/(bl-[0-9a-f]{12})\.mp4$/, who: "any", sample: "/videos/blender/bl-0123456789ab.mp4" },
  { method: "GET", path: "/api/hooks", who: "any", sample: "/api/hooks" },
  { method: "GET", path: "/api/first-comment", who: "any", sample: "/api/first-comment" },
  { method: "GET", path: "/api/plan", who: "any", sample: "/api/plan" },
  { method: "GET", path: "/api/images", who: "any", sample: "/api/images" },
  { method: "POST", path: "/api/image", who: "any", sample: "/api/image" },
  { method: "GET", path: "/api/template-previews", who: "any", sample: "/api/template-previews" },
  { method: "POST", path: "/api/template-previews", who: "owner", sample: "/api/template-previews" },
  { method: "POST", path: "/api/upload", who: "any", sample: "/api/upload" },
  { method: "GET", path: "/api/music", who: "any", sample: "/api/music" },
  { method: "GET", path: /^\/api\/music\/([A-Za-z0-9_-]{6,60})$/, who: "any", sample: "/api/music/nothing-here" },
  { method: "POST", path: "/api/design", who: "any", sample: "/api/design" },
  { method: "POST", path: "/api/sample", who: "owner", sample: "/api/sample" },
  { method: "GET", path: "/api/jobs", who: "any", sample: "/api/jobs" },
  { method: "GET", path: /^\/api\/jobs\/([a-z0-9]{20,32})(\/video|\/spec|\/voice|\/reshape|\/poster)?$/, who: "any", sample: "/api/jobs/cnothingnothingnothing1" },
  { method: "GET", path: /^\/api\/jobs\/([0-9]{8}-[0-9a-f]{8})(\/video|\/spec|\/voice|\/reshape)?$/, who: "any", sample: "/api/jobs/20261019-0123abcd" },
  { method: "GET", path: /^\/videos\/(c[a-z0-9]{20,30})\.mp4$/, who: "any", sample: "/videos/cnothingnothingnothing1.mp4" },
  { method: "GET", path: /^\/videos\/([0-9]{8}-[0-9a-f]{8})\.mp4$/, who: "any", sample: "/videos/20261019-0123abcd.mp4" },
];
/** Where a path is the owner's: the JSON routes a client gets a 404 for before anything else runs (pages answer with the 404 page). */
export const isOwnerOnly = (method: string, path: string) =>
  ROUTES.some((r) => r.who === "owner" && !r.page && r.method === method && (typeof r.path === "string" ? r.path === path : r.path.test(path)));

/** Pages that are the owner's only (research and developer pages): a client gets the studio's 404. */
export const OWNER_PAGES = new Set(["/viral", "/api-docs"]);

/** True when something of `businessId` may be seen: always for the owner (`scope` null), only the client's own otherwise. */
export const owns = (scope: string | null, businessId: string | null | undefined): boolean => !scope || (!!businessId && businessId === scope);

/** Provider costs and the test budget are the owner's: these fields never go to a client. */
export const OWNER_FIELDS = new Set(["costUsd", "estimateUsd", "apiEquivalentUsd", "billedTo", "usage", "spentUsd", "capUsd"]);
export const withoutOwnerFields = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(withoutOwnerFields) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).filter(([k]) => !OWNER_FIELDS.has(k)).map(([k, x]) => [k, withoutOwnerFields(x)])) : v;

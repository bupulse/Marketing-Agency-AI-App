// What a client may see and do (docs/STUDIO_DEPLOY.md, item 3). Pure rules, used by video-lab/server.ts and tested in
// tests/video-lab/scope.test.ts. A client's requests are scoped to the business in their session; the owner is not.

/** Routes that are the owner's only: the business list, the shared test wallet, test tools and the shared presenter portraits. */
export const OWNER_ONLY: [string, RegExp][] = [
  ["GET", /^\/api\/businesses$/],
  ["POST", /^\/api\/wallet\/topup$/],
  ["POST", /^\/api\/sample$/],
  ["POST", /^\/api\/template-previews$/],
  ["POST", /^\/api\/influencers\/[a-z-]+\/portrait$/],
];
export const isOwnerOnly = (method: string, path: string) => OWNER_ONLY.some(([m, re]) => m === method && re.test(path));

/** Pages that are the owner's only (research and developer pages): a client gets the studio's 404. */
export const OWNER_PAGES = new Set(["/viral", "/api-docs"]);

/** True when something of `businessId` may be seen: always for the owner (`scope` null), only the client's own otherwise. */
export const owns = (scope: string | null, businessId: string | null | undefined): boolean => !scope || (!!businessId && businessId === scope);

/** Provider costs and the test budget are the owner's: these fields never go to a client. */
export const OWNER_FIELDS = new Set(["costUsd", "estimateUsd", "apiEquivalentUsd", "billedTo", "usage", "spentUsd", "capUsd"]);
export const withoutOwnerFields = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(withoutOwnerFields) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).filter(([k]) => !OWNER_FIELDS.has(k)).map(([k, x]) => [k, withoutOwnerFields(x)])) : v;

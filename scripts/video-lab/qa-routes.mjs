// Walks every route of the studio (video-lab/scope.ts ROUTES) as a visitor with no session, as a signed-in client and as
// the owner, and checks who gets through: docs/STUDIO_DEPLOY.md, item 10. Needs a studio started with STUDIO_SESSION_SECRET
// and STUDIO_DEV_TICKETS=1 and the TEST database (it signs in with a test ticket for one business).
// Run: node --env-file=.env scripts/video-lab/qa-routes.mjs   (STUDIO_URL=http://localhost:3199 by default)
// Needs Node 22.18 or later (it reads the TypeScript route list directly).
import pg from "pg";
import { ROUTES } from "../../video-lab/scope.ts";

const base = process.env.STUDIO_URL || "http://localhost:3199";
let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) pass++;
  else fail++;
  if (!ok) console.log(`FAIL  ${name}${detail ? `  (${detail})` : ""}`);
};

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const { rows } = await pool.query(`select p."businessId" b from "Product" p where p.status = 'ACTIVE' group by p."businessId" order by p."businessId" limit 1`);
await pool.end();
const signIn = await fetch(`${base}/auth/bupulse?ticket=dev-${rows[0].b}&next=/create`, { redirect: "manual", headers: { "x-forwarded-for": "9.9.9.9" } });
const cookie = /bp_studio_session=([^;]+)/.exec(signIn.headers.get("set-cookie") ?? "")?.[1];
if (!cookie) {
  console.log("Could not sign in with a test ticket: start the studio with STUDIO_SESSION_SECRET and STUDIO_DEV_TICKETS=1.");
  process.exit(2);
}

/** Things a response must never show a client: stack traces, file paths, keys. */
const LEAKS = [/\bat\s+\S+\s+\(\/(Users|private|home)\//, /\/Users\/macbook1/, /sk-ant-/, /service_role/, /SUPABASE_SECRET/, /ENCRYPTION_KEY/, /"costUsd"/, /"capUsd"/, /"spentUsd"/];
const send = (route, who) => {
  const headers = { "x-forwarded-for": "9.9.9.9", ...(route.method === "POST" ? { "content-type": "application/json" } : {}) };
  if (who === "client") headers.cookie = `bp_studio_session=${cookie}`;
  // The owner is this computer: no forwarded address, no cookie.
  if (who === "owner") delete headers["x-forwarded-for"];
  return fetch(`${base}${route.sample}`, { method: route.method, headers, body: route.method === "POST" ? "{}" : undefined, redirect: "manual" });
};

for (const route of ROUTES) {
  const label = `${route.method} ${route.sample.split("?")[0]}`;
  // No session.
  if (route.who !== "public") {
    const r = await send(route, "visitor");
    check(`${label}: a visitor with no session is turned away`, r.status === 302 || r.status === 401, String(r.status));
  } else if (route.sample !== "/logout") {
    const r = await send(route, "visitor");
    check(`${label}: answers a visitor without an error`, r.status < 500, String(r.status));
  }
  // A signed-in client (not /logout, which would end the session).
  if (route.sample !== "/logout" && !(route.method === "POST" && route.path === "/login")) {
    const r = await send(route, "client");
    const body = await r.clone().text();
    if (route.who === "owner") check(`${label}: a client gets 404 (owner only)`, r.status === 404, String(r.status));
    else check(`${label}: works for a client (no 401, no server error)`, r.status !== 401 && r.status !== 500 && r.status !== 502, String(r.status));
    check(`${label}: nothing private in the answer to a client`, !LEAKS.some((re) => re.test(body)), (LEAKS.find((re) => re.test(body)) ?? "").toString());
    if (r.status < 400 && /json/.test(r.headers.get("content-type") ?? "") && route.path !== "/api/session") check(`${label}: a client's answer is not cached`, /no-store|private/.test(r.headers.get("cache-control") ?? ""), r.headers.get("cache-control") ?? "none");
  }
  // The owner (this computer): everything works, nothing errors.
  if (route.sample !== "/logout") {
    const r = await send(route, "owner");
    check(`${label}: the owner is not turned away or broken`, r.status !== 401 && r.status !== 500 && r.status !== 502, String(r.status));
  }
}

console.log(`${pass} of ${pass + fail} checks passed (${ROUTES.length} routes, as a visitor, a client and the owner).`);
process.exit(fail ? 1 : 0);

// QA for the studio's client scoping (docs/STUDIO_DEPLOY.md, item 3): a client signed in as business A must never see
// business B. Needs a studio started with STUDIO_SESSION_SECRET and STUDIO_DEV_TICKETS=1 (test tickets), and the TEST
// database. Run: node --env-file=.env scripts/video-lab/qa-scope.mjs   (STUDIO_URL=http://localhost:3199 by default)
// The owner side is this computer (local requests); the client side carries the cookie a test ticket gave.
import pg from "pg";

const base = process.env.STUDIO_URL || "http://localhost:3199";
let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const { rows } = await pool.query(
  `select p."businessId" as b, min(a.id) as photo, min(p.id) as product from "Product" p
   join "ProductPhoto" pp on pp."productId" = p.id join "MediaAsset" a on a.id = pp."assetId" and a.kind = 'photo'
   where p.status = 'ACTIVE' group by p."businessId" order by p."businessId" limit 2`,
);
// A photo of B that is not in the template examples (those are shown to every client on purpose).
const examples = JSON.stringify(await (await fetch(`${process.env.STUDIO_URL || "http://localhost:3199"}/api/template-previews`)).json());
if (rows[1]) {
  const own = await pool.query(`select a.id from "ProductPhoto" pp join "Product" p on p.id = pp."productId" join "MediaAsset" a on a.id = pp."assetId" and a.kind = 'photo' where p."businessId" = $1`, [rows[1].b]);
  rows[1].photo = own.rows.map((r) => r.id).find((id) => !examples.includes(id)) ?? rows[1].photo;
}
await pool.end();
if (rows.length < 2) {
  console.log("Needs two businesses with a product photo in the test database.");
  process.exit(2);
}
const [A, B] = rows;

const get = (path, cookie, init = {}) => fetch(`${base}${path}`, { ...init, headers: { ...(cookie ? { cookie: `bp_studio_session=${cookie}` } : {}), ...(init.headers ?? {}) }, redirect: "manual" });
const signIn = async (business) => {
  const r = await fetch(`${base}/auth/bupulse?ticket=dev-${business}&next=/create`, { redirect: "manual", headers: { "x-forwarded-for": "9.9.9.9" } });
  return /bp_studio_session=([^;]+)/.exec(r.headers.get("set-cookie") ?? "")?.[1] ?? null;
};
const post = (path, cookie, body) => get(path, cookie, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

const ca = await signIn(A.b);
check("a test ticket signs the client in", !!ca);
if (!ca) process.exit(1);

const session = await (await get("/api/session", ca)).json();
check("/api/session says client of business A", session.kind === "client" && session.businessId === A.b);
check("the business list is not served to a client", (await get("/api/businesses", ca)).status === 404);
check("the owner still gets the business list", (await get("/api/businesses")).status === 200);

const asOwnerA = await (await get(`/api/products?business=${A.b}`)).json();
const asClient = await (await get(`/api/products?business=${B.b}`, ca)).json();
check("asking for business B's products gives the client A's", asClient.length === asOwnerA.length && asClient.every((p) => asOwnerA.some((o) => o.id === p.id)));

// Warm the disk cache as the owner, then ask as the client: the cache must not hand B's photo to A.
await get(`/api/photo/${B.photo}?size=thumb`);
check("the owner can read B's photo", (await get(`/api/photo/${B.photo}?size=thumb`)).status === 200);
check("a client cannot read B's photo (cached or not)", (await get(`/api/photo/${B.photo}?size=thumb`, ca)).status === 404);
check("a client can read their own photo", (await get(`/api/photo/${A.photo}?size=thumb`, ca)).status === 200);
check("a client cannot read B's cut-out", (await get(`/api/photo/${B.photo}?cutout=1`, ca)).status === 404);
const cut = await (await get("/api/cutouts", ca)).json();
check("the cut-out list names only the client's photos", [...cut.ok, ...cut.refused].every((id) => id !== B.photo));

// A design for B's product, asked by A: the business is forced to A, so B's product is not found.
const design = await post("/api/design", ca, { businessId: B.b, productId: B.product, templateId: "product-hero" });
check("a design for another business's product is refused", design.status === 404);

// Jobs: a free sample for each business; each client sees only their own.
const jobA = await (await post("/api/sample", undefined, { businessId: A.b, productId: A.product })).json();
const jobB = await (await post("/api/sample", undefined, { businessId: B.b, productId: B.product })).json();
check("the owner can make test samples", !!jobA.id && !!jobB.id);
const list = (await (await get("/api/jobs", ca)).json()).jobs ?? [];
check("the client's job list holds only business A", list.length > 0 && list.every((j) => j.businessId === A.b));
check("the client can open their own job", (await get(`/api/jobs/${jobA.id}`, ca)).status === 200);
check("the client cannot open B's job", (await get(`/api/jobs/${jobB.id}`, ca)).status === 404);
check("the client cannot edit B's job spec", (await get(`/api/jobs/${jobB.id}/spec`, ca, { method: "PUT", body: "{}" })).status === 404);
check("the client cannot read B's video file", (await get(`/videos/${jobB.id}.mp4`, ca)).status === 404);
const showcase = (await (await get("/api/showcase", ca)).json()).items ?? [];
check("the showcase holds nothing of B", showcase.every((i) => i.id !== jobB.id));
const jobsBody = await (await get("/api/jobs", ca)).json();
check("a client is sent no spend or cap", !("spentUsd" in jobsBody) && !("capUsd" in jobsBody) && !JSON.stringify(jobsBody).includes("costUsd"));

// Owner-only things.
for (const [label, res] of [
  ["the viral library API", await get("/api/viral", ca)],
  ["the viral library page", await get("/viral", ca)],
  ["the developer lab", await get("/lab", ca)],
  ["the API page", await get("/api-docs", ca)],
  ["the test top-up", await post("/api/wallet/topup", ca, { pack: "small" })],
  ["the test sample tool", await post("/api/sample", ca, { productId: A.product })],
  ["the template previews", await post("/api/template-previews", ca, {})],
]) check(`${label} is not open to a client`, res.status === 404, String(res.status));
check("the owner still has the viral library", (await get("/api/viral")).status === 200);

const options = await (await get("/api/options", ca)).json();
check("a client is not told the Claude mode, model or budget", !("claudeMode" in options) && !("model" in options) && !("capUsd" in options) && !("spentUsd" in options) && !("estimateUsd" in options));
check("uploads wait for the Gallery move (503 for a client)", (await post("/api/upload", ca, {})).status === 503);
check("a forged cookie is refused", (await get("/api/session", `${ca.slice(0, -3)}abc`, { headers: { "x-forwarded-for": "9.9.9.9" } })).status === 401);

console.log(`\n${pass} of ${pass + fail} checks passed.`);
process.exit(fail ? 1 : 0);

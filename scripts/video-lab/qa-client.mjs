// QA crawl of the studio as a signed-in CLIENT (docs/STUDIO_DEPLOY.md, item 14), at 1440 px and 390 px wide:
//  1. every client page loads with no errors, no owner links and no sideways scroll;
//  2. a Motion video is designed through the page (the plan's credits go down by the price, a VideoJob row is made) and a
//     second business cannot see it;
//  3. a finished design is turned into an MP4 in the browser and saved to the Gallery, the VideoJob row is "ready" with what
//     BuPulse's Videos library reads, the client can play it and a second business cannot;
//  4. the phone's drawer fits. Test data is removed and the test credits and video given back at the end.
// Two test businesses are used because one plan has the credits (QA_BUSINESS, default "E2E Starter Test": 100 video
// credits, 0 videos) and another has the monthly videos (QA_VIDEO_BUSINESS, default "Nova Phones Kigali": 120 videos, 0
// credits); for the MP4 the design is copied to the second one as a designed job, the same row a design makes.
// Needs a studio started with STUDIO_SESSION_SECRET and STUDIO_DEV_TICKETS=1 (test tickets) and the TEST database.
// Run: node --env-file=.env scripts/video-lab/qa-client.mjs   (STUDIO_URL=http://localhost:3199 by default; --headed to watch)
// It uses the installed Google Chrome in its own temporary profile (the browser needs H.264 to make the MP4). It makes
// one Claude design (the subscription on a test studio, or the API key) and needs about 35 test credits.
import pg from "pg";
import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const base = process.env.STUDIO_URL || "http://localhost:3199";
const MAIN = process.env.QA_BUSINESS || "cmv88f85d0003dt457mcthoms"; // E2E Starter Test
const VIDEO = process.env.QA_VIDEO_BUSINESS || "c35fd99f1d618d7d30feaafd4"; // Nova Phones Kigali
const DESIGN_CREDITS = 35;
let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const q = async (sql, args = []) => (await pool.query(sql, args)).rows;
const ticket = async (business) => {
  const r = await fetch(`${base}/auth/bupulse?ticket=dev-${business}&next=/create`, { redirect: "manual", headers: { "x-forwarded-for": "9.9.9.9" } });
  return /bp_studio_session=([^;]+)/.exec(r.headers.get("set-cookie") ?? "")?.[1] ?? null;
};
const api = async (path, cookie, init = {}) => {
  const r = await fetch(`${base}${path}`, { ...init, headers: { cookie: `bp_studio_session=${cookie}`, ...(init.headers ?? {}) }, redirect: "manual" });
  return { status: r.status, body: await r.json().catch(() => null), headers: r.headers };
};

const mainCookie = await ticket(MAIN);
const videoCookie = await ticket(VIDEO);
if (!mainCookie || !videoCookie) {
  console.log("Could not sign in with test tickets: start the studio with STUDIO_SESSION_SECRET and STUDIO_DEV_TICKETS=1.");
  process.exit(2);
}
const [mainBiz] = await q(`select "userId" from "Business" where id = $1`, [MAIN]);
const [videoBiz] = await q(`select "userId" from "Business" where id = $1`, [VIDEO]);
const wallet = async () => (await api("/api/wallet", mainCookie)).body;
const walletBefore = await wallet();
check("the test client has enough plan credits for one design", walletBefore.balance >= DESIGN_CREDITS, `${walletBefore.balance} credits${walletBefore.blocked ? `, ${walletBefore.blocked}` : ""}`);
if (walletBefore.balance < DESIGN_CREDITS) process.exit(1);

const browser = await chromium.launch({ channel: "chrome", headless: !process.argv.includes("--headed"), args: ["--autoplay-policy=no-user-gesture-required"] });
const open = async (width, height, cookie = mainCookie) => {
  const ctx = await browser.newContext({ viewport: { width, height } });
  await ctx.addCookies([{ name: "bp_studio_session", value: cookie, url: base }]);
  const page = await ctx.newPage();
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  // A refused cut-out (404) is normal for some photos; anything else that fails is an error.
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource.*404/.test(m.text()) && page.errors.push(m.text()));
  return page;
};
/** The page streams its example videos for a long time, so "network idle" never comes: wait for its own data instead. */
const ready = async (page, path) => {
  await Promise.all([page.waitForResponse((x) => /\/api\/showcase/.test(x.url())), page.goto(`${base}${path}`, { waitUntil: "domcontentloaded" })]);
  await page.waitForTimeout(2500);
};
const voiceOff = async (page) => {
  await page.click("#pMore");
  await page.waitForTimeout(300);
  const voice = page.locator("#popMore label.toggle", { hasText: "Voice-over" }).locator("input");
  if (await voice.count()) await voice.uncheck();
  await page.mouse.click(5, 400);
  await page.waitForTimeout(300);
};
const cleanup = [];

try {
  // ---- 1. Pages, at both widths -------------------------------------------------------------------------------------
  const PAGES = ["/", "/create", "/app/video/motion", "/app/video/seedance-2-0", "/app/image/nano-banana", "/showcase", "/videos", "/pricing", "/guide"];
  for (const [label, width, height] of [["desktop 1440", 1440, 900], ["phone 390", 390, 800]]) {
    const page = await open(width, height);
    for (const path of PAGES) {
      const res = await page.goto(`${base}${path}`, { waitUntil: "load" });
      await page.waitForTimeout(3000);
      check(`${label}: ${path} loads`, res?.status() === 200, String(res?.status()));
      const seen = await page.evaluate(() => ({
        kind: document.body.dataset.kind,
        owner: [...document.querySelectorAll("[data-owner]")].some((e) => e.offsetParent !== null),
        mode: !!document.getElementById("modeBar") && !document.getElementById("modeBar").hidden,
        wide: document.documentElement.scrollWidth > window.innerWidth + 1,
      }));
      check(`${label}: ${path} shows the client studio (no owner links, no test banner, no sideways scroll)`, seen.kind === "client" && !seen.owner && !seen.mode && !seen.wide, JSON.stringify(seen));
      check(`${label}: ${path} has no script errors`, page.errors.length === 0, page.errors.slice(0, 2).join(" | ").slice(0, 160));
      page.errors.length = 0;
    }
    const viral = await page.goto(`${base}/viral`, { waitUntil: "load" });
    check(`${label}: the viral library is a 404 for a client`, viral?.status() === 404);
    await page.context().close();
  }

  // ---- 2. A Motion design through the page (desktop) ----------------------------------------------------------------
  const page = await open(1440, 1000);
  await ready(page, "/app/video/motion");
  await page.click("#tProduct");
  await page.waitForSelector("#pickGrid .pk");
  check("a client's product picker has no business choice", (await page.locator("#pickTop select").count()) === 0);
  await page.locator("#pickGrid .pk").first().click();
  await page.waitForTimeout(600);
  await voiceOff(page);
  const designed = page.waitForResponse((x) => x.url().endsWith("/api/design") && x.request().method() === "POST", { timeout: 300000 });
  await page.click("#go");
  console.log("designing with Claude (about a minute)...");
  const resp = await designed;
  const made = await resp.json();
  const job = made.jobs?.[0];
  if (job?.id) cleanup.push({ id: job.id });
  check("the design is a VideoJob with its design", resp.status() === 200 && !!job?.id && !!job?.spec && /^c[a-z0-9]{20,}$/.test(job.id), `${resp.status()} ${job?.id ?? ""} ${made.error ?? ""}`);
  await page.waitForTimeout(2500);
  const walletAfter = await wallet();
  check(`the plan's credits went down by ${DESIGN_CREDITS}`, walletBefore.balance - walletAfter.balance === DESIGN_CREDITS, `${walletBefore.balance} to ${walletAfter.balance}`);
  const [row] = await q(`select status, credits from "VideoJob" where id = $1`, [job?.id ?? ""]);
  check("its VideoJob row is designed and records the credits", row?.status === "designed" && row.credits === DESIGN_CREDITS, JSON.stringify(row));
  check("a second business cannot open the job", (await api(`/api/jobs/${job?.id}`, videoCookie)).status === 404);
  check("a second business's job list does not show it", !((await api("/api/jobs", videoCookie)).body?.jobs ?? []).some((j) => j.id === job?.id));
  check("no script errors while designing", page.errors.length === 0, page.errors.slice(0, 2).join(" | ").slice(0, 200));
  await page.context().close();

  // ---- 3. The MP4, made in the browser, into the Gallery -------------------------------------------------------------
  // The design is copied to the business whose plan has monthly videos, as a designed job (what a design makes).
  const vjobId = `cqa${Math.random().toString(16).slice(2).padEnd(21, "0").slice(0, 21)}`;
  const [vProduct] = await q(`select id from "Product" where "businessId" = $1 and status = 'ACTIVE' order by "createdAt" desc limit 1`, [VIDEO]);
  await q(
    `insert into "VideoJob"(id,"businessId","productId",engine,mode,status,"templateId","hookId",ratio,seconds,brief,spec,caption,hashtags,credits,"updatedAt")
     select $1,$2,$3,engine,mode,status,"templateId","hookId",ratio,seconds,brief,spec,caption,hashtags,0,now() from "VideoJob" where id = $4`,
    [vjobId, VIDEO, vProduct.id, job.id],
  );
  cleanup.push({ id: vjobId, business: VIDEO, video: true });
  const vpage = await open(1440, 1000, videoCookie);
  // The Motion page has the voice-over switch (this account has no credits for a voice-over, and a voice is not what is tested).
  await ready(vpage, "/app/video/motion");
  await voiceOff(vpage);
  await vpage.locator("#genGrid .genCard").first().click();
  await vpage.waitForTimeout(1500);
  const makeMp4 = vpage.locator("#dActions button", { hasText: "Make MP4" }).first();
  const label = await makeMp4.innerText();
  check("the Make MP4 button is there", /Make MP4/.test(label), label);
  const saved = vpage.waitForResponse((x) => /\/api\/jobs\/[a-z0-9]+\/video/.test(x.url()) && x.request().method() === "POST", { timeout: 280000 });
  await makeMp4.click();
  console.log("making the MP4 in the browser...");
  const savedResp = await saved.catch(() => null);
  check("the MP4 was made in the browser and saved", savedResp?.status() === 200, savedResp ? String(savedResp.status()) : "no save within 280 s (the browser could not encode)");
  if (savedResp?.status() === 200) {
    await vpage.waitForTimeout(2000);
    const [done] = await q(
      `select j.status, j."videoPath" is not null as video, j."posterPath" is not null as poster, j.bytes, j."durationMs", j.ratio, j."productId" is not null as product, length(j.caption) > 0 as caption,
              coalesce(array_length(j.hashtags, 1), 0) as tags, f.name as folder, a.kind
         from "VideoJob" j left join "MediaAsset" a on a.path = j."videoPath" left join "MediaFolder" f on f.id = a."folderId" where j.id = $1`,
      [vjobId],
    );
    check("BuPulse's library would see it: ready, with video, poster, size, length, ratio, product, caption and hashtags", done?.status === "ready" && done.video && done.poster && done.bytes > 1000 && done.durationMs > 0 && done.ratio && done.product && done.caption && done.tags > 0, JSON.stringify(done));
    check("the MP4 is a video in the Gallery's Video Studio folder", done?.kind === "video" && done.folder === "Video Studio", `${done?.kind} / ${done?.folder}`);
    const link = await fetch(`${base}/videos/${vjobId}.mp4`, { headers: { cookie: `bp_studio_session=${videoCookie}`, range: "bytes=0-99" } });
    check("the client can play it (the studio sends them to Storage, Range works)", link.status === 206 && /video\/mp4/.test(link.headers.get("content-type") ?? ""), `${link.status} ${link.headers.get("content-type")}`);
    check("a second business cannot play it", (await fetch(`${base}/videos/${vjobId}.mp4`, { headers: { cookie: `bp_studio_session=${mainCookie}` }, redirect: "manual" })).status === 404);
    const [lib] = await q(`select count(*)::int as n from "VideoJob" where "businessId" = $1 and status = 'ready' and "videoPath" is not null and id = $2`, [VIDEO, vjobId]);
    check("exactly this job is in the library's query for its business", lib.n === 1);
    const [usage] = await q(`select videos from "UsageRecord" where "userId" = $1 order by "periodStart" desc limit 1`, [videoBiz.userId]);
    check("the plan's videos used went up by one", usage.videos >= 1, `${usage.videos} used`);
  }
  check("no script errors while making the MP4", vpage.errors.length === 0, vpage.errors.slice(0, 2).join(" | ").slice(0, 200));
  await vpage.screenshot({ path: process.env.QA_SHOT || "/tmp/qa-client.png" });
  await vpage.context().close();

  // ---- 4. The phone, with the finished video's drawer -----------------------------------------------------------------
  const phone = await open(390, 800, videoCookie);
  await ready(phone, "/create");
  await phone.locator("#genGrid .genCard").first().click();
  await phone.waitForTimeout(1500);
  check("phone 390: the video's drawer fits (no sideways scroll)", !(await phone.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1 || document.querySelector("#drawer").scrollWidth > window.innerWidth + 1)));
  check("phone 390: no script errors on the Create page with a video", phone.errors.length === 0, phone.errors.slice(0, 2).join(" | ").slice(0, 160));
  await phone.context().close();
} finally {
  await browser.close();
  // ---- 5. Clean up: the test jobs and files, and the test credits and video given back -------------------------------------
  if (process.env.QA_KEEP !== "1") {
    for (const c of cleanup) {
      const [j] = await q(`select "videoPath", "posterPath", status, credits, "businessId" from "VideoJob" where id = $1`, [c.id]);
      if (!j) continue;
      const paths = [j.videoPath, j.posterPath].filter(Boolean);
      if (paths.length) await createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY).storage.from("gallery-videos").remove(paths);
      await q(`delete from "VideoJob" where id = $1`, [c.id]);
      if (paths.length) await q(`delete from "MediaAsset" where path = any($1)`, [paths]);
      const user = j.businessId === VIDEO ? videoBiz.userId : mainBiz.userId;
      const [rec] = await q(`select "periodStart" from "UsageRecord" where "userId" = $1 order by "periodStart" desc limit 1`, [user]);
      await q(`update "UsageRecord" set "videoCredits" = greatest(0, "videoCredits" - $3), videos = greatest(0, videos - $4) where "userId" = $1 and "periodStart" = $2`, [user, rec.periodStart, j.credits, c.video && j.status === "ready" ? 1 : 0]);
      if (c.video && j.status === "ready") await q(`update "VideoDayUsage" set videos = greatest(0, videos - 1) where "userId" = $1 and day = to_char(now() at time zone 'Africa/Kigali', 'YYYY-MM-DD')`, [user]);
    }
    const after = await wallet();
    check("the test videos are removed and the test credits are given back", after.balance === walletBefore.balance, `${walletBefore.balance} to ${after.balance}`);
  }
  await pool.end();
  console.log(`\n${pass} of ${pass + fail} checks passed.`);
  process.exitCode = fail ? 1 : 0;
}

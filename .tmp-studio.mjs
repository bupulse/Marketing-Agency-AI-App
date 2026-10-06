import pg from "pg"; import fs from "fs"; import { chromium } from "playwright"; import { createClient } from "@supabase/supabase-js";
const env = Object.fromEntries(fs.readFileSync(".env","utf8").split("\n").filter(l=>l.includes("=")&&!l.startsWith("#")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i).trim(), l.slice(i+1).trim().replace(/^"|"$/g,"")]}));
const S="/private/tmp/claude-502/-Users-macbook1-Jarvis/4fdf9aa4-1141-4649-96f8-1cf4ec435d1a/scratchpad", U="http://localhost:3100";
const db = new pg.Client({connectionString: env.DIRECT_URL}); await db.connect();
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const { data } = await admin.auth.admin.createUser({ email: "delivered@resend.dev", password: "Flowtest123", email_confirm: true,
  user_metadata: { organisation_name: "Sunrise Bakery", ceo_name: "Ana Silva", industry: "Restaurants & cafés", country: "Rwanda" } });
const id = data.user.id;
try {
  for (let i=0;i<30;i++){ try{ await fetch(U+"/login"); break;}catch{ await new Promise(r=>setTimeout(r,1000)); } }
  const b = await chromium.launch({channel:"chrome"}); const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errs=[]; p.on("pageerror", e=>errs.push(e.message));
  await p.goto(U+"/login"); await p.locator('input[name=email]').fill("delivered@resend.dev"); await p.locator('input[name=password]').fill("Flowtest123");
  await p.getByRole("button", {name: "Sign in", exact: true}).click(); await p.waitForURL(/onboarding/);
  await db.query(`update "Business" set description='Fresh bread and pastries', audience='Families nearby', tone='friendly', "brandColors"='{#E85D2C,#F2A516}', "onboardedAt"=now() where "userId"=$1`, [id]);
  await p.goto(U+"/dashboard/projects/new"); await p.waitForTimeout(1200); await p.screenshot({path:`${S}/st-new.png`, fullPage: true});
  await p.getByLabel(/name|title/i).first().fill("Fresh sourdough every morning");
  await p.locator('input[type=file]').setInputFiles("public/brand/icon.png"); await p.waitForTimeout(3000);
  await p.getByRole("button", {name: /Save as draft/}).click(); await p.waitForURL(/projects\/[a-z0-9]+$/, {timeout: 20000});
  await p.waitForTimeout(1500); await p.screenshot({path:`${S}/st-project.png`, fullPage: true});
  // Generate without key → friendly error + credit refunded
  await p.getByRole("button", {name: /Write content/}).first().click();
  const tw=Date.now(); await p.getByText(/could not write/i).first().waitFor({timeout: 30000}); console.log("error shown after", Math.round((Date.now()-tw)/1000), "s");
  await p.waitForTimeout(2500);
  console.log("progress box still visible after error:", await p.getByText("Writing your content").isVisible());
  console.log("write without AI key ->", (await p.locator("[role=alert],[role=status]").allInnerTexts()).filter(Boolean).join(" | ").slice(0,200));
  console.log("credits used after failed write:", (await db.query(`select "textGenerations" from "UsageRecord" where "userId"=$1`, [id])).rows[0]?.textGenerations ?? 0);
  console.log("ledger rows:", JSON.stringify((await db.query(`select feature, provider, model, success, left(error,60) err from "AiCall" where "businessId" in (select id from "Business" where "userId"=$1)`, [id])).rows));
  // Template design
  await p.getByRole("button", {name: /^Create( design)?$/}).first().click().catch(()=>console.log("no create button"));
  const td=Date.now();
  for (let i=0;i<45;i++){ const n=(await db.query(`select count(*)::int n from "Design" where "businessId" in (select id from "Business" where "userId"=$1)`,[id])).rows[0].n; if(n) break; await p.waitForTimeout(1000); }
  console.log("design created after", Math.round((Date.now()-td)/1000), "s");
  await p.waitForTimeout(1500); await p.screenshot({path:`${S}/st-design.png`});
  console.log("designs saved:", (await db.query(`select kind, template, "aspectRatio" from "Design" where "businessId" in (select id from "Business" where "userId"=$1)`, [id])).rows);
  console.log("errors:", errs);
  await b.close();
} finally { 
  for (const bucket of ["media","designs","brand"]) {
    const walk = async (prefix) => { const { data } = await admin.storage.from(bucket).list(prefix, { limit: 1000 }); let out=[]; for (const o of data ?? []) { const path = `${prefix}/${o.name}`; out = o.id ? [...out, path] : [...out, ...(await walk(path))]; } return out; };
    const files = await walk(id); if (files.length) await admin.storage.from(bucket).remove(files);
  }
  await db.query(`delete from auth.users where id=$1`, [id]);
  await db.end(); }

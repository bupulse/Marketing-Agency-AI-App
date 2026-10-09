// Puts demo+onboard@bupulse.com back to "brand onboarding not started" so the wizard can be captured again.
import { createClient } from "@supabase/supabase-js";
import { pool, q } from "./db.mjs";
import { ACCOUNTS } from "./accounts.mjs";
const [b] = await q(`select b.id, b."userId", b."logoUrl" from "Business" b join "User" u on u.id = b."userId" where u.email = $1`, [ACCOUNTS.onboard.email]);
if (b.logoUrl) await createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } }).storage.from("brand").remove([b.logoUrl]);
await q(`update "Business" set description = null, audience = null, tone = null, "logoUrl" = null, "brandColors" = '{}', knowledge = null, "onboardedAt" = null where id = $1`, [b.id]);
console.log("reset", b.id);
await pool.end();

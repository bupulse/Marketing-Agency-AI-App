// Deletes the newest design of a project (row and PNG) so designs.mjs can make it again. Usage: node redo-design.mjs <projectTitle>
import { createClient } from "@supabase/supabase-js";
import { pool, q } from "./db.mjs";
const a = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const [r] = await q(`select d.id, d.path from "Design" d join "Project" p on p.id = d."projectId" join "Business" b on b.id = p."businessId" join "User" u on u.id = b."userId"
  where p.title = $1 and u.email like 'demo+%' order by d."createdAt" desc limit 1`, [process.argv[2]]);
await a.storage.from("designs").remove([r.path]);
await q(`delete from "Design" where id = $1`, [r.id]);
console.log("deleted", r.id);
await pool.end();

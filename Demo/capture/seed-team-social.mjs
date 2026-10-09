// Seeds what cannot be done without real outside services:
//  - Urugo Homes team: Claudine joined as Admin (same rows acceptInvite() writes), Jean Bosco invited as Member (pending).
//  - "Connected" Facebook Page + Instagram accounts. Fake external ids, NO tokens and no expiry, so the publisher and the
//    token-refresh job can never call Meta with them.
import crypto from "node:crypto";
import { pool, q } from "./db.mjs";
import { ACCOUNTS } from "./accounts.mjs";
import { ensureAuthUser } from "./create-users.mjs";

const bizOf = async (email) => (await q(`select b.id, b."userId" from "Business" b join "User" u on u.id = b."userId" where u.email = $1`, [email]))[0];
const cuid = () => "demo" + crypto.randomBytes(10).toString("hex");

// Team (Urugo)
const urugo = await bizOf(ACCOUNTS.urugo.email);
const [claudine, jean] = ACCOUNTS.urugo.team;
const claudineId = await ensureAuthUser(claudine.email, { full_name: claudine.name, invited_to: urugo.id });
await q(`insert into "User"(id, email, name, "signUpMethod") values ($1, $2, $3, 'PASSWORD') on conflict (id) do nothing`, [claudineId, claudine.email, claudine.name]);
await q(`insert into "Membership"(id, "businessId", "userId", role, "invitedBy", "createdAt") values ($1, $2, $3, 'ADMIN', $4, now() - interval '6 days') on conflict ("userId") do nothing`, [cuid(), urugo.id, claudineId, urugo.userId]);
await q(`insert into "Invite"(id, "businessId", email, role, "tokenHash", "invitedBy", "expiresAt", "acceptedAt", "createdAt")
         select $1, $2, $3, 'ADMIN', $4, $5, now() + interval '1 day', now() - interval '6 days', now() - interval '7 days'
         where not exists (select 1 from "Invite" where "businessId" = $2 and email = $3)`,
  [cuid(), urugo.id, claudine.email, crypto.randomBytes(32).toString("hex"), urugo.userId]);
await q(`insert into "Invite"(id, "businessId", email, role, "tokenHash", "invitedBy", "expiresAt", "createdAt")
         select $1, $2, $3, 'MEMBER', $4, $5, now() + interval '6 days', now() - interval '1 day'
         where not exists (select 1 from "Invite" where "businessId" = $2 and email = $3)`,
  [cuid(), urugo.id, jean.email, crypto.randomBytes(32).toString("hex"), urugo.userId]);

// Social accounts
const SOCIAL = {
  inzu: [["instagram", "@inzufashion.rw", "business"], ["facebook", "Inzu Fashion", "page"]],
  urugo: [["facebook", "Urugo Homes", "page"], ["instagram", "@urugohomes", "business"]],
  nova: [["instagram", "@novaphones.kigali", "business"], ["facebook", "Nova Phones Kigali", "page"]],
};
for (const [slug, list] of Object.entries(SOCIAL)) {
  const b = await bizOf(ACCOUNTS[slug].email);
  for (const [provider, name, type] of list) {
    await q(
      `insert into "Connection"(id, "businessId", kind, provider, method, "externalAccountId", "displayName", scopes, status, "postingMode", "accountType", "lastCheckedAt", "createdAt", "updatedAt")
       values ($1, $2, 'SOCIAL', $3, 'DIRECT', $4, $5, $6, 'ACTIVE', 'AUTO', $7, now(), now() - interval '20 days', now())
       on conflict ("businessId", provider, "externalAccountId") do nothing`,
      [cuid(), b.id, provider, `demo-fake-${slug}-${provider}`, name, provider === "facebook" ? ["pages_manage_posts", "pages_read_engagement"] : ["instagram_business_content_publish", "instagram_business_basic"], type],
    );
  }
}
console.log(await q(`select c.provider, c."displayName", b.name from "Connection" c join "Business" b on b.id = c."businessId" where c."externalAccountId" like 'demo-fake-%'`));
await pool.end();

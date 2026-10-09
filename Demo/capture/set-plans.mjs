// Puts the demo accounts on their paid plans (no real payment: fake "demo_" subscription ids, no customer id,
// so the billing page never calls Paddle) and sets the Kigali time zone.
import { pool, q } from "./db.mjs";
import { ACCOUNTS } from "./accounts.mjs";

const priceEnv = { STANDARD: process.env.PADDLE_PRICE_STANDARD_MONTH, PRO: process.env.PADDLE_PRICE_PRO_MONTH };
for (const [slug, a] of Object.entries(ACCOUNTS)) {
  const [u] = await q(`select id from "User" where email = $1`, [a.email]);
  if (!u) continue;
  await q(`update "Business" set timezone = 'Africa/Kigali', country = 'Rwanda' where "userId" = $1`, [u.id]);
  if (!a.plan) continue;
  await q(
    `update "Subscription" set plan = $2, status = 'ACTIVE', provider = 'PADDLE', "providerSubscriptionId" = $3, "providerPriceId" = $4,
       "providerCustomerId" = null, interval = 'MONTH', "trialEndsAt" = null, "cancelAtPeriodEnd" = false,
       "currentPeriodStart" = now() - interval '9 days', "currentPeriodEnd" = now() + interval '21 days', "updatedAt" = now()
     where "userId" = $1`,
    [u.id, a.plan, `demo_sub_${slug}`, priceEnv[a.plan] ?? null],
  );
  console.log(slug, a.plan);
}
await pool.end();

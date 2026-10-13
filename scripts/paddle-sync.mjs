// Shared by scripts/paddle-setup.mjs (the command line) and Admin -> Settings -> Card payments -> "Set up prices"
// (lib/billing/paddle-setup.ts). `api(path, method, body)` is the Paddle API and returns its `data`.

// Keep in sync with lib/billing/paddle-map.ts SUBSCRIPTION_EVENTS. A completed card payment may pay an open invoice
// (docs/INVOICES.md); refunds (adjustment.*) are checked before an admin marks a flagged invoice paid.
export const PADDLE_EVENTS = [
  "subscription.created",
  "subscription.updated",
  "subscription.activated",
  "subscription.canceled",
  "subscription.past_due",
  "subscription.paused",
  "subscription.resumed",
  "transaction.payment_failed",
  "transaction.completed",
  "adjustment.created",
  "adjustment.updated",
];

/**
 * The notification destination for `url` with PADDLE_EVENTS: reused (missing events added) or created. Returns its
 * secret when Paddle gives it (always on creation), whether it was created, and which events were added.
 */
export async function ensureNotificationSetting(api, url) {
  const settings = await api("/notification-settings?per_page=200", "GET");
  const found = settings.find((s) => s.destination === url && s.type === "url");
  if (found) {
    const missing = PADDLE_EVENTS.filter((e) => !(found.subscribed_events ?? []).some((s) => (s.name ?? s) === e));
    if (missing.length) await api(`/notification-settings/${found.id}`, "PATCH", { subscribed_events: PADDLE_EVENTS });
    return { secret: found.endpoint_secret_key ?? null, created: false, updated: missing };
  }
  const created = await api("/notification-settings", "POST", {
    description: "BuPulse billing webhooks",
    type: "url",
    destination: url,
    subscribed_events: PADDLE_EVENTS,
    api_version: 1,
    include_sensitive_fields: false,
  });
  return { secret: created.endpoint_secret_key ?? null, created: true, updated: [] };
}

// Card prices of the regions other than GLOBAL (Rwanda's RWF plans charged in USD, the East Africa USD prices) as
// Paddle prices, written to PlanRegionPrice.paddleMonthlyPriceId / paddleYearlyPriceId. Used by
// `npm run paddle:setup -- --regions` (docs/BILLING.md, "Card for Rwanda and the other regions"). Until a row has its
// ids, card checkout is not offered for that plan in that region ("Card payments coming soon").
//
// GLOBAL is not touched: its prices are the plans' own (Admin -> Plans syncs them with Paddle).

/** The USD cents a row is charged by card, per interval: the derived card price of a local-currency row, or the row's own USD price. */
export function cardCents(row, interval) {
  const usd = String(row.currency).toUpperCase() === "USD";
  if (interval === "MONTH") return usd ? row.monthlyMinor : row.cardMonthlyUsdCents;
  return usd ? row.yearlyMinor : row.cardYearlyUsdCents;
}

/** What is missing in Paddle for one row: one job per interval without a price id and with a card amount. */
export function regionPriceJobs(row) {
  const jobs = [];
  for (const interval of ["MONTH", "YEAR"]) {
    const id = interval === "MONTH" ? row.paddleMonthlyPriceId : row.paddleYearlyPriceId;
    const cents = cardCents(row, interval);
    if (!id && Number.isInteger(cents) && cents > 0) jobs.push({ interval, cents });
  }
  return jobs;
}

/**
 * Creates (or reuses) the Paddle prices of every region row that lacks them and stores the ids.
 * `api(path, method, body)` is the Paddle API (returns `data`); `db.rows()` lists the rows of regions that take card
 * and have countries (not GLOBAL), joined with the plan's name and Paddle product; `db.save(row, interval, priceId)`
 * stores one id only while it is still empty. Returns what it wrote.
 */
export async function syncRegionPrices({ api, db, log = () => {} }) {
  const written = [];
  const products = new Map();
  for (const row of await db.rows()) {
    const jobs = regionPriceJobs(row);
    if (jobs.length === 0) continue;
    let productId = row.paddleProductId ?? products.get(row.planKey) ?? null;
    if (!productId) {
      const name = `BuPulse ${row.planName}`;
      const existing = (await api("/products?status=active&per_page=200", "GET")).find((p) => p.name === name);
      productId = existing?.id ?? (await api("/products", "POST", { name, tax_category: "saas", description: `${name} subscription`, custom_data: { planKey: row.planKey } })).id;
    }
    products.set(row.planKey, productId);
    for (const { interval, cents } of jobs) {
      const unit = interval === "MONTH" ? "month" : "year";
      const prices = await api(`/prices?product_id=${encodeURIComponent(productId)}&status=active&per_page=200`, "GET");
      const found = prices.find(
        (p) =>
          p.unit_price?.amount === String(cents) &&
          p.unit_price?.currency_code === "USD" &&
          p.billing_cycle?.interval === unit &&
          p.billing_cycle?.frequency === 1 &&
          p.custom_data?.regionKey === row.regionKey,
      );
      const priceId =
        found?.id ??
        (
          await api("/prices", "POST", {
            product_id: productId,
            description: `${row.planName} ${row.regionKey} (${unit}ly, card)`,
            unit_price: { amount: String(cents), currency_code: "USD" },
            billing_cycle: { interval: unit, frequency: 1 },
            trial_period: null,
            quantity: { minimum: 1, maximum: 1 },
            custom_data: { planKey: row.planKey, regionKey: row.regionKey },
          })
        ).id;
      await db.save(row, interval, priceId);
      written.push({ planKey: row.planKey, regionKey: row.regionKey, interval, cents, priceId, reused: Boolean(found) });
      log(`  ${row.regionKey} ${row.planKey} ${interval}: $${(cents / 100).toFixed(2)} -> ${priceId}${found ? " (existing)" : ""}`);
    }
  }
  return written;
}

/** The rows and the writer, over a `pg` client (the script's own connection, DIRECT_URL or DATABASE_URL). */
export function pgRegionStore(client) {
  return {
    async rows() {
      const { rows } = await client.query(
        `SELECT r."planKey", r."regionKey", r."currency", r."monthlyMinor", r."yearlyMinor", r."cardMonthlyUsdCents", r."cardYearlyUsdCents",
                r."paddleMonthlyPriceId", r."paddleYearlyPriceId", p."name" AS "planName", p."paddleProductId"
           FROM "PlanRegionPrice" r
           JOIN "PlanDefinition" p ON p."key" = r."planKey"
           JOIN "PricingRegion" g ON g."key" = r."regionKey"
          WHERE cardinality(g."countries") > 0 AND 'card' = ANY(g."paymentMethods")
          ORDER BY r."regionKey", r."planKey"`,
      );
      return rows;
    },
    async save(row, interval, priceId) {
      const column = interval === "MONTH" ? "paddleMonthlyPriceId" : "paddleYearlyPriceId";
      await client.query(`UPDATE "PlanRegionPrice" SET "${column}" = $1 WHERE "planKey" = $2 AND "regionKey" = $3 AND "${column}" IS NULL`, [priceId, row.planKey, row.regionKey]);
    },
  };
}

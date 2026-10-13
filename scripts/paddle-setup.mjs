// Creates BuPulse's Paddle products, prices and (optionally) the webhook endpoint, then writes the
// ids into .env. Safe to run again: existing products, prices and endpoints are reused.
//
//   npm run paddle:setup -- [--webhook-url https://bupulse.com/api/billing/webhooks/paddle] [--print-secret] [--regions]
//
// --regions also creates the card prices of the regions other than GLOBAL (Rwanda's RWF plans charged in USD, the East
// Africa prices) and writes their ids into PlanRegionPrice (needs DIRECT_URL or DATABASE_URL). Without them card
// checkout shows "Card payments coming soon" for those plans (docs/BILLING.md). Run it again after a regional price or
// the USD rate changes (the ids are cleared then).
//
// Reads PADDLE_API_KEY and PADDLE_ENVIRONMENT (sandbox | production, default sandbox) from the
// environment or .env. Prices must match lib/billing/catalog.ts PRICES.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { ensureNotificationSetting, pgRegionStore, syncRegionPrices } from "./paddle-sync.mjs";

const ENV_FILE = ".env";

function loadEnvFile() {
  if (!existsSync(ENV_FILE)) return;
  for (const line of readFileSync(ENV_FILE, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^(["'])(.*)\1$/, "$2");
  }
}

const PLANS = {
  STANDARD: { name: "BuPulse Standard", MONTH: 49, YEAR: 490 },
  PRO: { name: "BuPulse Pro", MONTH: 99, YEAR: 990 },
};

loadEnvFile();
const args = process.argv.slice(2);
const printSecret = args.includes("--print-secret");
const regions = args.includes("--regions");
const urlIndex = args.indexOf("--webhook-url");
const webhookUrl = urlIndex >= 0 ? args[urlIndex + 1] : null;
if (urlIndex >= 0 && !webhookUrl) {
  console.error("--webhook-url needs a URL");
  process.exit(1);
}
if (!process.env.PADDLE_API_KEY) {
  console.error("PADDLE_API_KEY is not set (add it to .env or the environment).");
  process.exit(1);
}
const environment = process.env.PADDLE_ENVIRONMENT === "production" ? "production" : "sandbox";
const base = environment === "production" ? "https://api.paddle.com" : "https://sandbox-api.paddle.com";

async function api(path, method = "GET", body) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { Authorization: `Bearer ${process.env.PADDLE_API_KEY}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`Paddle ${method} ${path} failed (${response.status}): ${json?.error?.code ?? "unknown"} ${json?.error?.detail ?? ""}`);
  }
  return json.data;
}

async function ensureProduct(name) {
  const products = await api("/products?status=active&per_page=200");
  const found = products.find((p) => p.name === name);
  if (found) return found.id;
  return (await api("/products", "POST", { name, tax_category: "saas", description: `${name} subscription` })).id;
}

async function ensurePrice(productId, label, interval, dollars) {
  const amount = String(dollars * 100);
  const unit = interval === "MONTH" ? "month" : "year";
  const prices = await api(`/prices?product_id=${productId}&status=active&per_page=200`);
  const found = prices.find(
    (p) =>
      p.unit_price?.amount === amount &&
      p.unit_price?.currency_code === "USD" &&
      p.billing_cycle?.interval === unit &&
      p.billing_cycle?.frequency === 1,
  );
  if (found) return found.id;
  return (
    await api("/prices", "POST", {
      product_id: productId,
      description: `${label} (${unit}ly)`,
      unit_price: { amount, currency_code: "USD" },
      billing_cycle: { interval: unit, frequency: 1 },
      trial_period: null,
      quantity: { minimum: 1, maximum: 1 }, // one plan per account: hides the quantity picker
    })
  ).id;
}

// Sets KEY="value" lines in .env (replacing existing ones, appending new ones).
function writeEnv(values) {
  const lines = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf8").split("\n") : [];
  for (const [key, value] of Object.entries(values)) {
    const line = `${key}="${value}"`;
    const index = lines.findIndex((l) => l.startsWith(`${key}=`));
    if (index >= 0) lines[index] = line;
    else {
      if (lines.length && lines[lines.length - 1] === "") lines.pop();
      lines.push(line, "");
    }
  }
  writeFileSync(ENV_FILE, lines.join("\n"));
}

const written = {};
for (const [plan, config] of Object.entries(PLANS)) {
  const productId = await ensureProduct(config.name);
  for (const interval of ["MONTH", "YEAR"]) {
    written[`PADDLE_PRICE_${plan}_${interval}`] = await ensurePrice(productId, config.name, interval, config[interval]);
  }
}

let secretNote = "";
if (webhookUrl) {
  const { secret, created, updated } = await ensureNotificationSetting((path, method = "GET", body) => api(path, method, body), webhookUrl);
  if (updated.length) console.log(`Updated the webhook's events (added ${updated.join(", ")}).`);
  if (secret) {
    written.PADDLE_WEBHOOK_SECRET = secret;
    secretNote = printSecret ? `\nWebhook secret (${created ? "new" : "existing"}): ${secret}` : "";
  } else {
    secretNote = "\nThe webhook endpoint already exists and Paddle did not return its secret; copy it from Paddle > Developer tools > Notifications.";
  }
}

writeEnv(written);
console.log(`Paddle ${environment} set up. Wrote to ${ENV_FILE}:`);
for (const key of Object.keys(written)) {
  console.log(key === "PADDLE_WEBHOOK_SECRET" ? `  ${key}=(hidden${printSecret ? ", printed below" : ", use --print-secret to show"})` : `  ${key}=${written[key]}`);
}
if (secretNote) console.log(secretNote);
if (!webhookUrl) console.log("\nNo --webhook-url given: webhook endpoint not created.");
console.log("\nStill to add yourself: PADDLE_API_KEY, PADDLE_CLIENT_TOKEN (Paddle > Developer tools > Authentication), PADDLE_ENVIRONMENT.");

if (regions) {
  const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error("\n--regions needs DIRECT_URL or DATABASE_URL (the database the app uses) to write the regional price ids.");
    process.exit(1);
  }
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    console.log(`\nRegional card prices (Paddle ${environment}):`);
    const written = await syncRegionPrices({ api: (path, method = "GET", body) => api(path, method, body), db: pgRegionStore(client), log: console.log });
    console.log(written.length ? `Wrote ${written.length} regional price ids. Card checkout opens for those plans within a minute (cache).` : "Every regional price already has its Paddle ids.");
  } finally {
    await client.end();
  }
}

import "server-only";
import { prisma } from "@/lib/db";
import { siteUrl } from "@/lib/auth/site-url";
import { writeAudit } from "@/lib/admin/audit";
import { isServiceEnabled } from "@/lib/admin/switch";
import { AdminError, type AdminContext } from "@/lib/admin/types";
import { syncPlanToPaddle } from "@/lib/admin/plans-service";
import { clearPlanCache, getPlans } from "@/lib/plan-catalog";
import { getRegions } from "@/lib/region";
import { clearRegionPriceCache, getRegionPlans } from "@/lib/region-prices";
import { ensureNotificationSetting, syncRegionPrices } from "../../scripts/paddle-sync.mjs";
import { cardPricedPlans } from "./card-ready";
import { paddleApi } from "./paddle";
import { getPaddleConfig, missingPaddleValues, paddleValueProblem, storePaddleWebhookSecret, type PaddleConfig, type PaddleEnvironment } from "./paddle-config";

// Admin -> Settings -> Card payments (Paddle): "Test connection", "Set up prices" and the status line
// (docs/BILLING.md, "Connecting Paddle"). The same steps as `npm run paddle:setup -- --regions --webhook-url ...`,
// without editing any environment variable.

type Api = (path: string, method?: string, body?: unknown) => Promise<unknown>;
const api: Api = (path, method = "GET", body) => paddleApi(path, { method, body });

export const PADDLE_WEBHOOK_PATH = "/api/billing/webhooks/paddle";

/**
 * Read-only: lists Paddle's event types with the saved key, or with a key being typed (`apiKey`, `environment`).
 * Never throws; the message is safe to show (Paddle's error code, never the key).
 */
export async function testPaddleConnection(input: { apiKey?: string; environment?: PaddleEnvironment } = {}): Promise<{ ok: boolean; message: string }> {
  const typed = input.apiKey?.trim();
  const config = await getPaddleConfig({ force: true });
  const environment = typed ? (input.environment ?? "sandbox") : config.environment;
  if (typed) {
    const problem = paddleValueProblem("apiKey", typed, environment);
    if (problem) return { ok: false, message: problem };
  } else if (!config.apiKey) {
    return { ok: false, message: "No API key yet. Paste the API key from Paddle > Developer tools > Authentication." };
  }
  try {
    const events = await paddleApi<unknown[]>("/event-types", typed ? { credentials: { apiKey: typed, environment } } : {});
    return { ok: true, message: `Paddle ${environment === "production" ? "live" : "sandbox"} answered (${Array.isArray(events) ? events.length : "?"} event types). The key works.` };
  } catch (error) {
    const text = error instanceof Error ? error.message : "no details";
    return { ok: false, message: /\b401\b|authentication|forbidden|403/i.test(text) ? `Paddle refused the key (${environment === "production" ? "live" : "sandbox"}): check it is an API key of that account. ${text}` : `Paddle did not answer: ${text}` };
  }
}

/** PlanRegionPrice rows of the regions that take card and are not the catch-all (GLOBAL prices are the plans' own). */
function prismaRegionStore() {
  return {
    async rows() {
      const [regions, rows, plans] = await Promise.all([getRegions({ force: true }), prisma.planRegionPrice.findMany(), getPlans({ force: true })]);
      const keys = new Set(regions.filter((r) => r.countries.length > 0 && r.paymentMethods.includes("card")).map((r) => r.key));
      return rows
        .filter((r) => keys.has(r.regionKey))
        .map((r) => {
          const plan = plans.find((p) => p.key === r.planKey);
          return { ...r, planName: plan?.name ?? r.planKey, paddleProductId: plan?.paddleProductId ?? null };
        });
    },
    async save(row: { planKey: string; regionKey: string }, interval: "MONTH" | "YEAR", priceId: string) {
      await prisma.planRegionPrice.updateMany({
        where: { planKey: row.planKey, regionKey: row.regionKey, ...(interval === "MONTH" ? { paddleMonthlyPriceId: null } : { paddleYearlyPriceId: null }) },
        data: interval === "MONTH" ? { paddleMonthlyPriceId: priceId } : { paddleYearlyPriceId: priceId },
      });
    },
  };
}

export type SetUpResult = { plans: string[]; regionPrices: number; webhook: "created" | "updated" | "existing"; secretStored: boolean; problems: string[] };

/**
 * "Set up prices": (1) every plan on sale (or hidden) gets its Paddle product and monthly and yearly prices (the plan
 * builder's own sync, which only creates what is missing); (2) every regional card price (Rwanda, East Africa) gets its
 * USD Paddle prices, ids written to PlanRegionPrice; (3) the notification destination for this site's webhook URL is
 * created or updated with every event BuPulse handles (transaction.completed and adjustment.* included), and the secret
 * Paddle returns is stored encrypted. Idempotent: running it again reuses what exists. Console only, audited.
 */
export async function setUpPaddle(ctx: AdminContext): Promise<SetUpResult> {
  if (ctx.viaApi) throw new AdminError("forbidden", "Paddle is set up in the admin console only.");
  const config = await getPaddleConfig({ force: true });
  if (!config.apiKey) throw new AdminError("invalid", "Save the Paddle API key first.");
  const problems: string[] = [];

  const plans: string[] = [];
  for (const plan of await getPlans({ force: true })) {
    if (plan.isTrial || plan.isCustom || plan.status === "retired" || (plan.paddleProductId && plan.paddleMonthlyPriceId && plan.paddleYearlyPriceId)) continue;
    try {
      const done = await syncPlanToPaddle(ctx, plan.key);
      if (done.created.length) plans.push(plan.key);
    } catch (error) {
      problems.push(`${plan.name}: ${error instanceof Error ? error.message : "sync failed"}`);
    }
  }
  clearPlanCache();

  let regionPrices = 0;
  try {
    regionPrices = (await syncRegionPrices({ api, db: prismaRegionStore() })).length;
  } catch (error) {
    problems.push(`Regional prices: ${error instanceof Error ? error.message : "failed"}`);
  }
  clearRegionPriceCache();

  let webhook: SetUpResult["webhook"] = "existing";
  let secretStored = false;
  const url = `${siteUrl()}${PADDLE_WEBHOOK_PATH}`;
  try {
    const n = (await ensureNotificationSetting(api, url)) as { secret: string | null; created: boolean; updated: string[] };
    webhook = n.created ? "created" : n.updated.length ? "updated" : "existing";
    if (n.secret) {
      await storePaddleWebhookSecret(ctx, n.secret);
      secretStored = true;
    } else if (!config.webhookSecret) {
      problems.push("Paddle did not return the webhook secret: copy it from Paddle > Developer tools > Notifications and save it here.");
    }
  } catch (error) {
    problems.push(`Webhook (${url}): ${error instanceof Error ? error.message : "failed"}`);
  }

  const result = { plans, regionPrices, webhook, secretStored, problems };
  await writeAudit(prisma, ctx, "paddle_set_up", "setting:billing.paddle", null, { environment: config.environment, ...result, webhookUrl: url });
  return result;
}

export type RegionCardStatus = { key: string; name: string; priced: number; total: number };
export type PaddleStatus = {
  ready: boolean;
  /** "Card payments: ready" or "Card payments: not set up — <reason>". */
  line: string;
  environment: PaddleEnvironment;
  config: Pick<PaddleConfig, "source" | "last4">;
  regions: RegionCardStatus[];
};

/** Pure: the status line from what is known. Exported for the tests. */
export function paddleStatusLine(input: { missing: string | null; switchedOn: boolean; regions: RegionCardStatus[] }): { ready: boolean; line: string } {
  if (input.missing) return { ready: false, line: `Card payments: not set up — missing ${input.missing}.` };
  if (!input.switchedOn) return { ready: false, line: "Card payments: not set up — Paddle is switched off in Admin → Services." };
  const priced = input.regions.filter((r) => r.priced > 0);
  if (priced.length === 0) return { ready: false, line: "Card payments: not set up — no plan has a Paddle price yet. Click Set up prices." };
  const partial = input.regions.filter((r) => r.priced < r.total);
  if (partial.length) return { ready: true, line: `Card payments: ready — but not for every plan in ${partial.map((r) => r.name).join(", ")} yet (shown as "coming soon" there). Click Set up prices.` };
  return { ready: true, line: "Card payments: ready." };
}

/** What the settings page shows: where each value comes from, its last 4 characters, and card readiness per region. */
export async function paddleStatus(): Promise<PaddleStatus> {
  const config = await getPaddleConfig({ force: true });
  const [switchedOn, regionsAll] = await Promise.all([isServiceEnabled("paddle"), getRegions()]);
  const regions: RegionCardStatus[] = [];
  for (const region of regionsAll.filter((r) => r.active && r.paymentMethods.includes("card"))) {
    const plans = await getRegionPlans(region.key);
    const priced = await cardPricedPlans(region.key, plans.map((p) => p.key));
    regions.push({ key: region.key, name: region.name, priced: plans.filter((p) => priced[p.key]?.MONTH || priced[p.key]?.YEAR).length, total: plans.length });
  }
  const { ready, line } = paddleStatusLine({ missing: missingPaddleValues(config), switchedOn, regions });
  return { ready, line, environment: config.environment, config: { source: config.source, last4: config.last4 }, regions };
}

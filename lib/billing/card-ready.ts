import "server-only";
import { isServiceEnabled } from "@/lib/admin/switch";
import { regionPriceIdFor } from "@/lib/region-prices";
import { activeProvider, billingAdapter } from "./index";
import { payMethods, type CardPriced, type PayMethods } from "./pay-methods";

// Whether card checkout can open for a company, checked before the pay screens render (docs/BILLING.md, "Choosing how
// to pay"), so a client is never offered a card button that can only fail.

/** The card provider (BILLING_PROVIDER, default Paddle) has its keys and is switched on in Admin -> Services. */
export async function cardCheckoutConfigured(): Promise<boolean> {
  try {
    return (await billingAdapter(activeProvider()).isConfigured()) && (await isServiceEnabled("paddle"));
  } catch {
    return false;
  }
}

/** For each plan: is there a card price for the company's region, monthly and yearly. */
export async function cardPricedPlans(regionKey: string, planKeys: string[]): Promise<CardPriced> {
  const provider = activeProvider();
  const out: CardPriced = {};
  await Promise.all(
    planKeys.map(async (key) => {
      const [month, year] = await Promise.all([regionPriceIdFor(provider, key, regionKey, "MONTH"), regionPriceIdFor(provider, key, regionKey, "YEAR")]).catch(() => [null, null]);
      out[key] = { MONTH: Boolean(month), YEAR: Boolean(year) };
    }),
  );
  return out;
}

/**
 * How an invoice can be paid: Mobile Money where the region takes it, card where the region takes it and the
 * invoice's plan and interval has a card price there. A custom plan's invoice is never paid through card checkout
 * (docs/OFFERS.md, "Card"), so card is off for it.
 */
export async function invoicePayMethods(input: { region: { key: string; paymentMethods: readonly string[] }; planKey: string | null; interval: "MONTH" | "YEAR" | null; custom: boolean; momoConfigured: boolean }): Promise<PayMethods> {
  const regionMethods = input.custom ? input.region.paymentMethods.filter((m) => m !== "card") : input.region.paymentMethods;
  const priced = input.planKey && input.interval && regionMethods.includes("card") ? Boolean((await cardPricedPlans(input.region.key, [input.planKey]))[input.planKey]?.[input.interval]) : false;
  const configured = regionMethods.includes("card") ? await cardCheckoutConfigured() : false;
  return payMethods({ regionMethods, momoConfigured: input.momoConfigured, cardConfigured: configured, cardPriced: priced });
}

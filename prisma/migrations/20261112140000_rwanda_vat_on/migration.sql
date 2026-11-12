-- Rwanda's VAT is on: BuPulse is VAT-registered with RRA (owner, 12 November 2026). 18% is added on top of Rwandan
-- (RWF) prices, which are typed before VAT, and rounded to 100 RWF (lib/billing/vat.ts). The region's rate
-- (PricingRegion.vatRateBps, Admin -> Regions) is the one source of the rate; every other region stays at 0%.
-- Data only, additive and safe in both deploy orders: a build from before this migration has no VAT code and ignores
-- the column. Payments and invoices already made keep the rate they were made with (ManualPayment.vatRateBps,
-- Invoice.taxRatePercent). An admin who set Rwanda to another rate by hand keeps it (only 0 is turned on).
-- The old AdminSetting rows "billing.vat.enabled" / "billing.vat.ratePercent", if any, are no longer read; the TIN
-- ("billing.vat.tin") still is. Nothing is deleted.
UPDATE "PricingRegion" SET "vatRateBps" = 1800, "updatedAt" = CURRENT_TIMESTAMP WHERE "key" = 'RW' AND "vatRateBps" = 0;

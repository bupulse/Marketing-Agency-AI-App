-- Rwanda's VAT stays off (0%) until BuPulse is VAT-registered (owner, 12 November 2026). The owner switches it on in
-- Admin -> Regions (VAT %: 18). Only the rate changes; the label stays "VAT". Prices and payments are as before the
-- VAT feature: with 0% nothing is added and no VAT line is shown. Payments and invoices keep the rate they were made with.
UPDATE "PricingRegion" SET "vatRateBps" = 0, "vatLabel" = 'VAT', "updatedAt" = CURRENT_TIMESTAMP WHERE "key" = 'RW' AND "vatRateBps" <> 0;

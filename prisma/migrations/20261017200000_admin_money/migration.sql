-- Admin money accuracy (docs/ADMIN.md, docs/AI_COSTS.md): recurring costs, the providers' real monthly bills, and a
-- flag on AI calls whose usage is our estimate (a call that timed out on our side but was still billed).

-- AlterTable
ALTER TABLE "AiCall" ADD COLUMN "estimated" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "RecurringCost" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "period" TEXT NOT NULL,
    "startMonth" TEXT NOT NULL,
    "endMonth" TEXT,
    "note" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecurringCost_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "RecurringCost_period_check" CHECK ("period" IN ('month', 'year')),
    CONSTRAINT "RecurringCost_amount_check" CHECK ("amountMinor" >= 0),
    CONSTRAINT "RecurringCost_months_check" CHECK ("endMonth" IS NULL OR "endMonth" >= "startMonth")
);

-- CreateTable
CREATE TABLE "ProviderBill" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "usdCents" INTEGER NOT NULL,
    "usdRate" DOUBLE PRECISION,
    "note" TEXT,
    "enteredBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderBill_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ProviderBill_amount_check" CHECK ("amountMinor" >= 0 AND "usdCents" >= 0)
);

-- CreateIndex
CREATE INDEX "RecurringCost_startMonth_idx" ON "RecurringCost"("startMonth");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderBill_provider_month_key" ON "ProviderBill"("provider", "month");

-- Admin-only tables: the app reads and writes them with the database owner role after its own checks (requireAdmin,
-- AAL2). No policy, and no grants for the API roles.
ALTER TABLE "RecurringCost" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProviderBill" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "RecurringCost", "ProviderBill" FROM PUBLIC, anon, authenticated, service_role;

-- Plain invoices marked paid by hand (bank, cash, a MoMo payment made outside the pay screen) never wrote a revenue
-- event, so revenue missed them. From this build markInvoicePaid writes one ("invoice.paid_manual"); this back-fills
-- the ones already paid, at the RWF rate in Admin -> Settings (or the default 1450).
INSERT INTO "BillingEvent" ("id", "provider", "eventId", "type", "userId", "payload", "processedAt", "createdAt")
SELECT
  'inv_' || i."id",
  'MANUAL_MOMO',
  'invoice:' || i."id",
  'invoice.paid_manual',
  b."userId",
  jsonb_build_object(
    'event_type', 'invoice.paid_manual',
    'occurred_at', to_char(i."paidAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'backfilled', true,
    'data', jsonb_build_object(
      'id', i."number",
      'invoice_id', i."id",
      'amount_minor', i."totalMinor",
      'currency', i."currency",
      'method', split_part(i."paidBy", ':', 2),
      'usd_cents', CASE
        WHEN upper(i."currency") = 'USD' THEN i."totalMinor"
        WHEN upper(i."currency") = 'RWF' THEN round(i."totalMinor" * 100.0 / COALESCE(
          (SELECT ("value" #>> '{}')::numeric FROM "AdminSetting"
           WHERE "key" = 'pricing.usdToRwf' AND ("value" #>> '{}') ~ '^[0-9]{3,6}(\.[0-9]+)?$'), 1450))::int
        ELSE 0 END,
      'plan', i."planKey"
    )
  ),
  i."paidAt",
  i."paidAt"
FROM "Invoice" i JOIN "Business" b ON b."id" = i."businessId"
WHERE i."status" = 'paid' AND i."paidAt" IS NOT NULL AND i."paidBy" LIKE 'manual:%'
ON CONFLICT ("provider", "eventId") DO NOTHING;

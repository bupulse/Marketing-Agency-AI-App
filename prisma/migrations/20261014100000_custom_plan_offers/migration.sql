-- Custom plans and offers (R3) and custom plan requests (R5), docs/OFFERS.md. New tables, new nullable or defaulted
-- columns and seed rows only: nothing is rewritten, no existing plan, payment or subscription changes.

-- A company's private plan: PlanDefinition rows with isCustom = true and the company they belong to.
ALTER TABLE "PlanDefinition" ADD COLUMN IF NOT EXISTS "isCustom" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PlanDefinition" ADD COLUMN IF NOT EXISTS "businessId" TEXT;
ALTER TABLE "PlanDefinition" ADD CONSTRAINT "PlanDefinition_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "PlanDefinition_businessId_idx" ON "PlanDefinition"("businessId");

-- Add-on prices per region (Admin -> Add-on prices).
CREATE TABLE "AddonPrice" (
    "id" TEXT NOT NULL,
    "addonKey" TEXT NOT NULL,
    "regionKey" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "monthlyMinor" INTEGER NOT NULL,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AddonPrice_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AddonPrice_amount_check" CHECK ("monthlyMinor" >= 0)
);
CREATE UNIQUE INDEX "AddonPrice_addonKey_regionKey_key" ON "AddonPrice"("addonKey", "regionKey");
CREATE INDEX "AddonPrice_regionKey_idx" ON "AddonPrice"("regionKey");

-- Requests for a custom plan.
CREATE TABLE "CustomPlanRequest" (
    "id" TEXT NOT NULL,
    "businessId" TEXT,
    "userId" UUID,
    "demoBookingId" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "companyName" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "goals" TEXT NOT NULL,
    "featureKeys" JSONB NOT NULL,
    "budget" TEXT,
    "source" TEXT NOT NULL DEFAULT 'billing',
    "status" TEXT NOT NULL DEFAULT 'new',
    "handledBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CustomPlanRequest_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CustomPlanRequest_status_check" CHECK ("status" IN ('new', 'contacted', 'offered', 'closed'))
);
CREATE INDEX "CustomPlanRequest_status_createdAt_idx" ON "CustomPlanRequest"("status", "createdAt");
CREATE INDEX "CustomPlanRequest_businessId_createdAt_idx" ON "CustomPlanRequest"("businessId", "createdAt");
-- A deleted company takes its requests (contact details) with it.
ALTER TABLE "CustomPlanRequest" ADD CONSTRAINT "CustomPlanRequest_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Offers.
CREATE TABLE "PlanOffer" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "requestId" TEXT,
    "basePlanKey" TEXT,
    "featureKeys" JSONB NOT NULL,
    "limits" JSONB NOT NULL,
    "options" JSONB NOT NULL DEFAULT '{}',
    "currency" TEXT NOT NULL,
    "interval" "BillingInterval" NOT NULL,
    "lines" JSONB NOT NULL,
    "computedMinor" INTEGER NOT NULL,
    "adjustedMinor" INTEGER NOT NULL,
    "adjustReason" TEXT,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "validUntil" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "payMethod" TEXT,
    "customPlanKey" TEXT,
    "invoiceId" TEXT,
    "paidAt" TIMESTAMP(3),
    "paidBy" TEXT,
    "withdrawnAt" TIMESTAMP(3),
    "withdrawReason" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PlanOffer_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PlanOffer_status_check" CHECK ("status" IN ('draft', 'sent', 'accepted', 'paid', 'expired', 'withdrawn')),
    CONSTRAINT "PlanOffer_amounts_check" CHECK ("computedMinor" >= 0 AND "adjustedMinor" > 0),
    CONSTRAINT "PlanOffer_pay_method_check" CHECK ("payMethod" IS NULL OR "payMethod" IN ('momo', 'invoice'))
);
CREATE INDEX "PlanOffer_businessId_createdAt_idx" ON "PlanOffer"("businessId", "createdAt");
CREATE INDEX "PlanOffer_status_validUntil_idx" ON "PlanOffer"("status", "validUntil");
CREATE INDEX "PlanOffer_invoiceId_idx" ON "PlanOffer"("invoiceId");
-- At most one offer in front of a client at a time: sending a new one withdraws a sent one in the same transaction, and
-- an accepted one (the client may be paying) has to be withdrawn by hand first.
CREATE UNIQUE INDEX "PlanOffer_one_open_per_business" ON "PlanOffer"("businessId") WHERE "status" IN ('sent', 'accepted');
-- One prepared custom plan per offer.
CREATE UNIQUE INDEX "PlanOffer_customPlanKey_key" ON "PlanOffer"("customPlanKey") WHERE "customPlanKey" IS NOT NULL;
ALTER TABLE "PlanOffer" ADD CONSTRAINT "PlanOffer_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlanOffer" ADD CONSTRAINT "PlanOffer_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "CustomPlanRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A Mobile Money payment can pay an offer.
ALTER TABLE "ManualPayment" ADD COLUMN IF NOT EXISTS "offerId" TEXT;
ALTER TABLE "ManualPayment" ADD CONSTRAINT "ManualPayment_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "PlanOffer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "ManualPayment_offerId_idx" ON "ManualPayment"("offerId");
-- An offer is paid once: at most one pending or confirmed payment per offer.
CREATE UNIQUE INDEX "ManualPayment_offer_live_key" ON "ManualPayment"("offerId") WHERE "status" IN ('pending', 'confirmed') AND "offerId" IS NOT NULL;

-- Same rules as the other internal tables: RLS on with no policies, no grants for the API roles (Prisma connects as postgres).
ALTER TABLE "AddonPrice" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PlanOffer" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CustomPlanRequest" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "AddonPrice", "PlanOffer", "CustomPlanRequest" FROM PUBLIC, anon, authenticated, service_role;

-- Rwanda's add-on prices from docs/RWANDA_LAUNCH_PLAN.md section 4 (RWF a month). EAC and GLOBAL have no add-on
-- prices in the plan: the admin adds them in Admin -> Add-on prices before making offers there.
INSERT INTO "AddonPrice" ("id", "addonKey", "regionKey", "currency", "monthlyMinor", "updatedBy", "updatedAt") VALUES
    ('addon_rw_block_text',    'block:text',    'RW', 'RWF',   3000, 'migration', CURRENT_TIMESTAMP),
    ('addon_rw_block_image',   'block:image',   'RW', 'RWF',   5000, 'migration', CURRENT_TIMESTAMP),
    ('addon_rw_block_chat',    'block:chat',    'RW', 'RWF',   3000, 'migration', CURRENT_TIMESTAMP),
    ('addon_rw_seat',          'seat',          'RW', 'RWF',   3000, 'migration', CURRENT_TIMESTAMP),
    ('addon_rw_aiphotos',      'aiPhotos',      'RW', 'RWF',   8000, 'migration', CURRENT_TIMESTAMP),
    ('addon_rw_websitechat',   'websiteChat',   'RW', 'RWF',  10000, 'migration', CURRENT_TIMESTAMP),
    ('addon_rw_autopilot',     'autopilot',     'RW', 'RWF',  20000, 'migration', CURRENT_TIMESTAMP),
    ('addon_rw_analytics',     'analytics',     'RW', 'RWF',   5000, 'migration', CURRENT_TIMESTAMP),
    ('addon_rw_canva',         'canva',         'RW', 'RWF',   5000, 'migration', CURRENT_TIMESTAMP),
    ('addon_rw_storeimport',   'storeImport',   'RW', 'RWF',  10000, 'migration', CURRENT_TIMESTAMP),
    ('addon_rw_driveimport',   'driveImport',   'RW', 'RWF',   3000, 'migration', CURRENT_TIMESTAMP),
    ('addon_rw_webhooks',      'webhooks',      'RW', 'RWF',   5000, 'migration', CURRENT_TIMESTAMP),
    ('addon_rw_apiaccess',     'apiAccess',     'RW', 'RWF',  15000, 'migration', CURRENT_TIMESTAMP),
    ('addon_rw_managed_light', 'managed:light', 'RW', 'RWF', 100000, 'migration', CURRENT_TIMESTAMP),
    ('addon_rw_managed_full',  'managed:full',  'RW', 'RWF', 180000, 'migration', CURRENT_TIMESTAMP)
ON CONFLICT ("addonKey", "regionKey") DO NOTHING;

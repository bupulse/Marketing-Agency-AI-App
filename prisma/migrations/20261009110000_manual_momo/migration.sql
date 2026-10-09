-- Manual Mobile Money payments (docs/MOMO.md): a client pays by hand, submits the transaction id, and the owner confirms
-- it in the admin console. The new provider value is only used by application code, never in this migration, so adding
-- it inside the migration's transaction is safe.
ALTER TYPE "BillingProvider" ADD VALUE 'MANUAL_MOMO';

CREATE TABLE "ManualPayment" (
    "id" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "planKey" TEXT NOT NULL,
    "interval" "BillingInterval" NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'RWF',
    "reference" TEXT NOT NULL,
    "payerPhone" TEXT,
    "network" TEXT,
    "transactionId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "rejectReason" TEXT,
    "submittedAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "decidedBy" TEXT,
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ManualPayment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ManualPayment_reference_key" ON "ManualPayment"("reference");
CREATE INDEX "ManualPayment_status_createdAt_idx" ON "ManualPayment"("status", "createdAt");
CREATE INDEX "ManualPayment_userId_createdAt_idx" ON "ManualPayment"("userId", "createdAt");
ALTER TABLE "ManualPayment" ADD CONSTRAINT "ManualPayment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ManualPayment" ADD CONSTRAINT "ManualPayment_planKey_fkey" FOREIGN KEY ("planKey") REFERENCES "PlanDefinition"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Renewal reminders of Mobile Money subscriptions: the unique key is the claim, so an email is never sent twice.
CREATE TABLE "RenewalNotice" (
    "id" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "kind" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RenewalNotice_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RenewalNotice_userId_periodEnd_kind_key" ON "RenewalNotice"("userId", "periodEnd", "kind");

-- Same rules as the other internal tables: RLS on, no access for anon, authenticated or service_role (Prisma connects as postgres).
ALTER TABLE "ManualPayment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RenewalNotice" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "ManualPayment", "RenewalNotice" FROM PUBLIC, anon, authenticated, service_role;

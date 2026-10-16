-- Card renewals of Mobile Money plans (docs/BILLING.md, "Renewing"): the first card charge is moved by the days already
-- paid. One row per card subscription, written before Paddle is asked, so a failed request is retried by the daily
-- renewals job and the admins are alerted. Server only: RLS on, no grants.
CREATE TABLE "CardCarryOver" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerSubscriptionId" TEXT NOT NULL,
    "userId" UUID,
    "nextBilledAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "alertedAt" TIMESTAMP(3),
    "doneAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CardCarryOver_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CardCarryOver_status_check" CHECK ("status" IN ('pending', 'done', 'failed')),
    CONSTRAINT "CardCarryOver_attempts_check" CHECK ("attempts" >= 0)
);
CREATE UNIQUE INDEX "CardCarryOver_providerSubscriptionId_key" ON "CardCarryOver"("providerSubscriptionId");
CREATE INDEX "CardCarryOver_status_createdAt_idx" ON "CardCarryOver"("status", "createdAt");

ALTER TABLE "CardCarryOver" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "CardCarryOver" FROM PUBLIC, anon, authenticated, service_role;

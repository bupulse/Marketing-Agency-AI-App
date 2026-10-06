-- Phase 3: provider-neutral billing (Paddle first), yearly plans, webhook log.
CREATE TYPE "BillingProvider" AS ENUM ('PADDLE', 'STRIPE', 'PAYPAL');
CREATE TYPE "BillingInterval" AS ENUM ('MONTH', 'YEAR');

ALTER TABLE "Subscription" RENAME COLUMN "stripeCustomerId" TO "providerCustomerId";
ALTER TABLE "Subscription" RENAME COLUMN "stripeSubscriptionId" TO "providerSubscriptionId";
ALTER TABLE "Subscription" RENAME COLUMN "stripePriceId" TO "providerPriceId";
ALTER INDEX "Subscription_stripeCustomerId_key" RENAME TO "Subscription_providerCustomerId_key";
DROP INDEX "Subscription_providerCustomerId_key"; -- one customer may in theory hold several subscriptions
ALTER INDEX "Subscription_stripeSubscriptionId_key" RENAME TO "Subscription_providerSubscriptionId_key";
ALTER TABLE "Subscription" ADD COLUMN "provider" "BillingProvider";
ALTER TABLE "Subscription" ADD COLUMN "interval" "BillingInterval" NOT NULL DEFAULT 'MONTH';
ALTER TABLE "Subscription" ADD COLUMN "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "BillingEvent" (
    "id" TEXT NOT NULL,
    "provider" "BillingProvider" NOT NULL,
    "eventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "userId" UUID,
    "payload" JSONB NOT NULL,
    "processedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BillingEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BillingEvent_provider_eventId_key" ON "BillingEvent"("provider", "eventId");
CREATE INDEX "BillingEvent_userId_idx" ON "BillingEvent"("userId");
-- Like every public table: RLS on, no policies (only the server, as postgres, reads it).
ALTER TABLE "BillingEvent" ENABLE ROW LEVEL SECURITY;

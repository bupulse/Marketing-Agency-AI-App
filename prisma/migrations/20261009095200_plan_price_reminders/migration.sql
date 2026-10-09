-- Price changes: a second reminder email for notices sent far ahead (yearly clients), and a count of failed notice attempts.
ALTER TABLE "PlanPriceChangeItem" ADD COLUMN "reminderSentAt" TIMESTAMP(3), ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;

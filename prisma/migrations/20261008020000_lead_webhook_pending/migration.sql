-- A lead.created webhook that failed all its attempts; the hourly leads cron retries it for 24 hours.
ALTER TABLE "Lead" ADD COLUMN "webhookPendingAt" TIMESTAMP(3);
CREATE INDEX "Lead_webhookPendingAt_idx" ON "Lead"("webhookPendingAt");

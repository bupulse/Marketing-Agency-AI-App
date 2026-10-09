-- Admin console: support can pause a client's webhook; it stays paused (the owner cannot turn it back on) until support resumes it.
-- No new table, so no new RLS.
ALTER TABLE "WebhookEndpoint" ADD COLUMN "pausedByAdminAt" TIMESTAMP(3), ADD COLUMN "pausedByAdminReason" TEXT;

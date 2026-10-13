-- The sales room TV (/screen/<token>) asks every 10 s for money events newer than the last one it saw, and sums this
-- month's: both read BillingEvent by time, which had no index.
CREATE INDEX IF NOT EXISTS "BillingEvent_createdAt_idx" ON "BillingEvent"("createdAt");

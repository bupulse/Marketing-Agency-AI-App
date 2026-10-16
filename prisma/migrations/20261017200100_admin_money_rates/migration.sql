-- Admin money, part 2 (docs/ADMIN.md, "Money"), and two indexes the new admin pages read on every load:
-- 1. An RWF recurring cost keeps the RWF-per-USD rate of the day it was saved, so a later change of the rate in
--    Settings does not restate past months. Existing RWF rows take the current rate (or the default 1450).
-- 2. Client health reads each company's latest product event: index it like AiCall and Post.

-- AlterTable
ALTER TABLE "RecurringCost" ADD COLUMN "usdRate" DOUBLE PRECISION;

UPDATE "RecurringCost" SET "usdRate" = COALESCE(
  (SELECT ("value" #>> '{}')::double precision FROM "AdminSetting"
   WHERE "key" = 'pricing.usdToRwf' AND ("value" #>> '{}') ~ '^[0-9]{3,6}(\.[0-9]+)?$'), 1450)
WHERE "currency" = 'RWF' AND "usdRate" IS NULL;

-- CreateIndex
CREATE INDEX "AnalyticsEvent_businessId_createdAt_idx" ON "AnalyticsEvent"("businessId", "createdAt");

-- 3. The back-fill of plain invoices paid by hand (20261017200000_admin_money) counts only USD and RWF invoices: an
--    invoice in any other currency has no rate here, so its event (worth 0) is removed rather than kept at a wrong
--    value. The back-filled RWF ones used the rate in Settings when the migration ran: no rate history exists for
--    the day each invoice was paid.
DELETE FROM "BillingEvent"
WHERE "type" = 'invoice.paid_manual' AND ("payload" ->> 'backfilled') = 'true'
  AND upper("payload" #>> '{data,currency}') NOT IN ('USD', 'RWF');

-- 4. Admin -> Inbox counts contest posts still waiting for the client's confirmation on every console page: a small
--    partial index keeps that a lookup instead of a scan of every post. SQL only (Prisma cannot describe it).
CREATE INDEX "Post_contest_waiting_idx" ON "Post"("businessId", "createdAt")
  WHERE "contest" IS NOT NULL AND NOT ("contest" ? 'confirmedAt') AND "status" NOT IN ('PUBLISHED', 'FAILED', 'CANCELLED');

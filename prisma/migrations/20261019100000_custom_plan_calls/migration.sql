-- Custom plan calls (lib/demo/plan-calls.ts): right after a custom plan request, an existing client may book a short
-- call on the demo slots. The call is a DemoBooking of kind 'custom_plan', linked to its request. Existing rows are
-- demos. New columns with a constant default or nullable only: no rewrite; DemoBooking keeps its RLS and grants.
ALTER TABLE "DemoBooking" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'demo';
ALTER TABLE "DemoBooking" ADD CONSTRAINT "DemoBooking_kind_check" CHECK ("kind" IN ('demo', 'custom_plan'));
ALTER TABLE "DemoBooking" ADD COLUMN "requestId" TEXT;
-- A deleted request leaves its call in place (Admin -> Demos still shows it), unlinked.
ALTER TABLE "DemoBooking" ADD CONSTRAINT "DemoBooking_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "CustomPlanRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "DemoBooking_requestId_idx" ON "DemoBooking"("requestId");

-- One live booking per company and kind (was: per company), so a company may have its demo and a custom plan call, but
-- never two of either. One live booking per start time stays as it is: both kinds share the owner's calendar.
DROP INDEX "DemoBooking_live_business_key";
CREATE UNIQUE INDEX "DemoBooking_live_business_key" ON "DemoBooking"("businessId", "kind") WHERE "status" = 'booked';

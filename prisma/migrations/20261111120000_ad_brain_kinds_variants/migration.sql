-- The Ad Brain makes normal content videos too, and variants of an ad (other hooks or CTAs on the same body).
ALTER TABLE "AdJob" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'ad';
ALTER TABLE "AdJob" ADD COLUMN "variantOf" TEXT;
ALTER TABLE "AdJob" ADD COLUMN "variantLabel" TEXT;
CREATE INDEX "AdJob_variantOf_idx" ON "AdJob"("variantOf");

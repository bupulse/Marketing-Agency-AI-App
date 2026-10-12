-- Soft region check (docs/REGIONS.md): the IP country seen at sign-up or a payment start that maps to a dearer region
-- than Business.pricingRegion. Never blocks a payment; the admin sees it and can change the region (audited).

-- AlterTable
ALTER TABLE "Business" ADD COLUMN     "regionMismatch" JSONB,
ADD COLUMN     "regionMismatchAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Business_regionMismatchAt_idx" ON "Business"("regionMismatchAt");

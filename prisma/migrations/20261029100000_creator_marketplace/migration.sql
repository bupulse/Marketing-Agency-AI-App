-- Creator marketplace (docs/CREATOR_MARKETPLACE.md, owner decisions of 21 October 2026): the public list of campaigns
-- at /creators, creator accounts with a profile made once, companies finding creators who opted in and inviting them,
-- admin hiding and blocking, and reports. New: the campaign's marketplace switch and admin hide, the creator profile's
-- fields, where an application came from and the OFFERED status, and the CreatorReport table (locked like the others).

-- AlterTable
ALTER TABLE "CreatorCampaign" ADD COLUMN     "hiddenAt" TIMESTAMP(3),
ADD COLUMN     "hiddenReason" TEXT,
ADD COLUMN     "listed" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "CreatorProfile" ADD COLUMN     "bio" TEXT,
ADD COLUMN     "blockedAt" TIMESTAMP(3),
ADD COLUMN     "blockedReason" TEXT,
ADD COLUMN     "discoverable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "handles" JSONB,
ADD COLUMN     "location" TEXT,
ADD COLUMN     "samples" TEXT[];

-- AlterTable
ALTER TABLE "CampaignCreator" ADD COLUMN     "offeredAt" TIMESTAMP(3),
ADD COLUMN     "offeredBy" UUID,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'LINK';

-- CreateTable
CREATE TABLE "CreatorReport" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "campaignId" TEXT,
    "profileId" TEXT,
    "reporterUserId" UUID NOT NULL,
    "businessId" TEXT,
    "reason" TEXT NOT NULL,
    "details" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "resolution" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CreatorReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CreatorReport_status_createdAt_idx" ON "CreatorReport"("status", "createdAt");

-- CreateIndex
CREATE INDEX "CreatorProfile_discoverable_idx" ON "CreatorProfile"("discoverable");

-- AddForeignKey
ALTER TABLE "CreatorReport" ADD CONSTRAINT "CreatorReport_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "CreatorCampaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorReport" ADD CONSTRAINT "CreatorReport_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "CreatorProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- OFFERED: a company invited a marketplace creator to a campaign and waits for their answer.
ALTER TABLE "CampaignCreator" DROP CONSTRAINT "CampaignCreator_status_check";
ALTER TABLE "CampaignCreator" ADD CONSTRAINT "CampaignCreator_status_check" CHECK ("status" IN ('APPLIED', 'SELECTED', 'JOINED', 'DECLINED', 'REMOVED', 'OFFERED'));
ALTER TABLE "CampaignCreator" ADD CONSTRAINT "CampaignCreator_source_check" CHECK ("source" IN ('LINK', 'MARKETPLACE', 'OFFER'));
ALTER TABLE "CreatorReport" ADD CONSTRAINT "CreatorReport_values_check" CHECK ("kind" IN ('CAMPAIGN', 'CREATOR') AND "status" IN ('OPEN', 'RESOLVED') AND "reason" IN ('SCAM', 'NOT_PAID', 'FAKE_VIEWS', 'SPAM', 'OFFENSIVE', 'OTHER'));

-- The app reaches this table through Prisma only; the Data API roles get nothing (tests/security/rls-coverage.test.ts).
ALTER TABLE "CreatorReport" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "CreatorReport" FROM PUBLIC, anon, authenticated, service_role;

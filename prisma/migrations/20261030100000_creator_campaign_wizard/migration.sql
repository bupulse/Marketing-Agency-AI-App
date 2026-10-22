-- Creator campaign wizard (docs/CREATOR_CAMPAIGN_WIZARD.md, owner decisions of 22 October 2026): campaigns are made in
-- 12 steps with AI suggestions, saved as a draft after each step. New: the wizard's answers on CreatorCampaign (idea,
-- kind, goal, the Business info campaign and products it promotes, creator requirements, formats, do's and don'ts, the
-- application form, the campaign's files and the application page's cover) and the follower count read from a
-- creator's connected account. Campaigns made before keep setupStep null (done) and their `questions`.

-- AlterTable
ALTER TABLE "CreatorCampaign" ADD COLUMN     "applicationForm" JSONB,
ADD COLUMN     "briefEvery" TEXT,
ADD COLUMN     "donts" TEXT[],
ADD COLUMN     "dos" TEXT[],
ADD COLUMN     "files" JSONB,
ADD COLUMN     "formats" TEXT[],
ADD COLUMN     "goal" TEXT,
ADD COLUMN     "idea" TEXT,
ADD COLUMN     "kind" TEXT,
ADD COLUMN     "knowledgeCampaignId" TEXT,
ADD COLUMN     "look" JSONB,
ADD COLUMN     "platformMode" TEXT NOT NULL DEFAULT 'ANY',
ADD COLUMN     "productIds" TEXT[],
ADD COLUMN     "requirements" JSONB,
ADD COLUMN     "setupStep" INTEGER;

-- AlterTable
ALTER TABLE "CreatorConnection" ADD COLUMN     "followers" INTEGER,
ADD COLUMN     "followersAt" TIMESTAMP(3);

-- AddForeignKey
ALTER TABLE "CreatorCampaign" ADD CONSTRAINT "CreatorCampaign_knowledgeCampaignId_fkey" FOREIGN KEY ("knowledgeCampaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;


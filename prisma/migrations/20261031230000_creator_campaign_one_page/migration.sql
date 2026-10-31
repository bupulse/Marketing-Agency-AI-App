-- The one-page creator campaign form (docs/CREATOR_CAMPAIGN_WIZARD.md, "One page"): the language the campaign's texts
-- and its AI are written in, and how many creators can join (null: unlimited, up to the plan's creatorsPerCampaign).
-- Additive: every campaign already saved is English with no limit of its own, as before.
ALTER TABLE "CreatorCampaign" ADD COLUMN "language" TEXT NOT NULL DEFAULT 'en';
ALTER TABLE "CreatorCampaign" ADD COLUMN "maxCreators" INTEGER;

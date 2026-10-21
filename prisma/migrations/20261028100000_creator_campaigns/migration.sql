-- Creator campaigns (docs/CREATOR_CAMPAIGNS.md, owner decisions of 21 October 2026): a company runs a campaign for
-- content creators, who post its daily tasks on their own accounts and are paid by the company for the views. New
-- tables: the campaign, its tasks and 30-day pay periods, the creators (application to membership), their profiles and
-- BuPulse-Socials connections, what they hand in, each post link with its view snapshots, and the payouts. Locked like
-- every other table (row level security on, no Data API grants). The feature key "creators" is added to the BUSINESS
-- plan and to every custom plan, each change written to the audit log like an edit in Admin -> Plans.

-- CreateTable
CREATE TABLE "CreatorCampaign" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brief" TEXT NOT NULL,
    "rules" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "acceptingApplications" BOOLEAN NOT NULL DEFAULT true,
    "startsOn" DATE NOT NULL,
    "endsOn" DATE NOT NULL,
    "platforms" TEXT[],
    "mentions" TEXT[],
    "currency" TEXT NOT NULL DEFAULT 'RWF',
    "payRules" JSONB NOT NULL,
    "viewTargetPerCreator" INTEGER,
    "viewTargetCampaign" INTEGER,
    "questions" JSONB,
    "createdBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreatorCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreatorTask" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "instructions" TEXT NOT NULL,
    "startsOn" DATE NOT NULL,
    "endsOn" DATE NOT NULL,
    "postsPerDay" INTEGER NOT NULL DEFAULT 1,
    "platforms" TEXT[],
    "platformMode" TEXT NOT NULL DEFAULT 'ANY',
    "mediaKind" TEXT NOT NULL DEFAULT 'ANY',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreatorTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreatorProfile" (
    "id" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreatorProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignCreator" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "profileId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'APPLIED',
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "handles" JSONB NOT NULL,
    "samples" TEXT[],
    "answers" JSONB,
    "inviteTokenHash" TEXT,
    "inviteExpiresAt" TIMESTAMP(3),
    "selectedAt" TIMESTAMP(3),
    "joinedAt" TIMESTAMP(3),
    "removedAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignCreator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreatorConnection" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "composioConnectedAccountId" TEXT NOT NULL,
    "externalAccountId" TEXT NOT NULL,
    "username" TEXT,
    "displayName" TEXT,
    "accountType" TEXT,
    "avatarUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "lastError" TEXT,
    "lastCheckedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreatorConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreatorSubmission" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "campaignCreatorId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "title" TEXT NOT NULL,
    "caption" TEXT NOT NULL,
    "mediaPaths" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'ACCEPTED',
    "rejectedAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreatorSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreatorPost" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "campaignCreatorId" TEXT NOT NULL,
    "connectionId" TEXT,
    "network" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "externalId" TEXT,
    "postedAt" TIMESTAMP(3),
    "networkCaption" TEXT,
    "checks" JSONB,
    "status" TEXT NOT NULL DEFAULT 'CHECKING',
    "statusReason" TEXT,
    "removedAt" TIMESTAMP(3),
    "views" INTEGER NOT NULL DEFAULT 0,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "likes" INTEGER NOT NULL DEFAULT 0,
    "comments" INTEGER NOT NULL DEFAULT 0,
    "shares" INTEGER NOT NULL DEFAULT 0,
    "lastReadAt" TIMESTAMP(3),
    "nextReadAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreatorPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreatorPostSnapshot" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "views" INTEGER NOT NULL,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "likes" INTEGER NOT NULL DEFAULT 0,
    "comments" INTEGER NOT NULL DEFAULT 0,
    "shares" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CreatorPostSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreatorPeriod" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "viewTargetPerCreator" INTEGER,
    "viewTargetCampaign" INTEGER,
    "budget" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreatorPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreatorPayout" (
    "id" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "campaignCreatorId" TEXT NOT NULL,
    "countedViews" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "deductions" INTEGER NOT NULL DEFAULT 0,
    "breakdown" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DUE',
    "paidAt" TIMESTAMP(3),
    "paidBy" UUID,
    "reference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreatorPayout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CreatorCampaign_slug_key" ON "CreatorCampaign"("slug");

-- CreateIndex
CREATE INDEX "CreatorCampaign_businessId_status_idx" ON "CreatorCampaign"("businessId", "status");

-- CreateIndex
CREATE INDEX "CreatorTask_campaignId_startsOn_endsOn_idx" ON "CreatorTask"("campaignId", "startsOn", "endsOn");

-- CreateIndex
CREATE UNIQUE INDEX "CreatorProfile_userId_key" ON "CreatorProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignCreator_inviteTokenHash_key" ON "CampaignCreator"("inviteTokenHash");

-- CreateIndex
CREATE INDEX "CampaignCreator_campaignId_status_idx" ON "CampaignCreator"("campaignId", "status");

-- CreateIndex
CREATE INDEX "CampaignCreator_profileId_idx" ON "CampaignCreator"("profileId");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignCreator_campaignId_email_key" ON "CampaignCreator"("campaignId", "email");

-- CreateIndex
CREATE INDEX "CreatorConnection_status_idx" ON "CreatorConnection"("status");

-- CreateIndex
CREATE UNIQUE INDEX "CreatorConnection_profileId_network_externalAccountId_key" ON "CreatorConnection"("profileId", "network", "externalAccountId");

-- CreateIndex
CREATE INDEX "CreatorSubmission_campaignId_day_idx" ON "CreatorSubmission"("campaignId", "day");

-- CreateIndex
CREATE INDEX "CreatorSubmission_campaignCreatorId_day_idx" ON "CreatorSubmission"("campaignCreatorId", "day");

-- CreateIndex
CREATE INDEX "CreatorPost_campaignId_status_idx" ON "CreatorPost"("campaignId", "status");

-- CreateIndex
CREATE INDEX "CreatorPost_campaignCreatorId_idx" ON "CreatorPost"("campaignCreatorId");

-- CreateIndex
CREATE INDEX "CreatorPost_status_nextReadAt_idx" ON "CreatorPost"("status", "nextReadAt");

-- CreateIndex
CREATE UNIQUE INDEX "CreatorPost_network_externalId_key" ON "CreatorPost"("network", "externalId");

-- CreateIndex
CREATE INDEX "CreatorPostSnapshot_postId_capturedAt_idx" ON "CreatorPostSnapshot"("postId", "capturedAt");

-- CreateIndex
CREATE INDEX "CreatorPeriod_status_endsAt_idx" ON "CreatorPeriod"("status", "endsAt");

-- CreateIndex
CREATE UNIQUE INDEX "CreatorPeriod_campaignId_index_key" ON "CreatorPeriod"("campaignId", "index");

-- CreateIndex
CREATE INDEX "CreatorPayout_campaignCreatorId_status_idx" ON "CreatorPayout"("campaignCreatorId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CreatorPayout_periodId_campaignCreatorId_key" ON "CreatorPayout"("periodId", "campaignCreatorId");

-- AddForeignKey
ALTER TABLE "CreatorCampaign" ADD CONSTRAINT "CreatorCampaign_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorTask" ADD CONSTRAINT "CreatorTask_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "CreatorCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorProfile" ADD CONSTRAINT "CreatorProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignCreator" ADD CONSTRAINT "CampaignCreator_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "CreatorCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignCreator" ADD CONSTRAINT "CampaignCreator_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "CreatorProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorConnection" ADD CONSTRAINT "CreatorConnection_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "CreatorProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorSubmission" ADD CONSTRAINT "CreatorSubmission_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "CreatorCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorSubmission" ADD CONSTRAINT "CreatorSubmission_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "CreatorTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorSubmission" ADD CONSTRAINT "CreatorSubmission_campaignCreatorId_fkey" FOREIGN KEY ("campaignCreatorId") REFERENCES "CampaignCreator"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorPost" ADD CONSTRAINT "CreatorPost_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "CreatorSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorPost" ADD CONSTRAINT "CreatorPost_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "CreatorCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorPost" ADD CONSTRAINT "CreatorPost_campaignCreatorId_fkey" FOREIGN KEY ("campaignCreatorId") REFERENCES "CampaignCreator"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorPost" ADD CONSTRAINT "CreatorPost_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "CreatorConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorPostSnapshot" ADD CONSTRAINT "CreatorPostSnapshot_postId_fkey" FOREIGN KEY ("postId") REFERENCES "CreatorPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorPeriod" ADD CONSTRAINT "CreatorPeriod_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "CreatorCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorPayout" ADD CONSTRAINT "CreatorPayout_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "CreatorPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorPayout" ADD CONSTRAINT "CreatorPayout_campaignCreatorId_fkey" FOREIGN KEY ("campaignCreatorId") REFERENCES "CampaignCreator"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The few values the code relies on.
ALTER TABLE "CreatorCampaign" ADD CONSTRAINT "CreatorCampaign_status_check" CHECK ("status" IN ('DRAFT', 'LIVE', 'PAUSED', 'ENDED'));
ALTER TABLE "CreatorCampaign" ADD CONSTRAINT "CreatorCampaign_dates_check" CHECK ("endsOn" >= "startsOn");
ALTER TABLE "CreatorTask" ADD CONSTRAINT "CreatorTask_dates_check" CHECK ("endsOn" >= "startsOn" AND "postsPerDay" BETWEEN 1 AND 10);
ALTER TABLE "CreatorTask" ADD CONSTRAINT "CreatorTask_modes_check" CHECK ("platformMode" IN ('ALL', 'ANY') AND "mediaKind" IN ('VIDEO', 'IMAGE', 'ANY'));
ALTER TABLE "CampaignCreator" ADD CONSTRAINT "CampaignCreator_status_check" CHECK ("status" IN ('APPLIED', 'SELECTED', 'JOINED', 'DECLINED', 'REMOVED'));
ALTER TABLE "CreatorConnection" ADD CONSTRAINT "CreatorConnection_status_check" CHECK ("status" IN ('ACTIVE', 'EXPIRED', 'REVOKED'));
ALTER TABLE "CreatorSubmission" ADD CONSTRAINT "CreatorSubmission_status_check" CHECK ("status" IN ('ACCEPTED', 'REJECTED'));
ALTER TABLE "CreatorPost" ADD CONSTRAINT "CreatorPost_status_check" CHECK ("status" IN ('CHECKING', 'TRACKING', 'INVALID', 'REMOVED', 'REJECTED', 'FINAL'));
ALTER TABLE "CreatorPeriod" ADD CONSTRAINT "CreatorPeriod_status_check" CHECK ("status" IN ('OPEN', 'CLOSED') AND "endsAt" > "startsAt");
ALTER TABLE "CreatorPayout" ADD CONSTRAINT "CreatorPayout_status_check" CHECK ("status" IN ('DUE', 'PAID') AND "amount" >= 0 AND "deductions" >= 0);

-- The app reaches these tables through Prisma only; the Data API roles get nothing (tests/security/rls-coverage.test.ts).
ALTER TABLE "CreatorCampaign" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "CreatorCampaign" FROM PUBLIC, anon, authenticated, service_role;
ALTER TABLE "CreatorTask" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "CreatorTask" FROM PUBLIC, anon, authenticated, service_role;
ALTER TABLE "CreatorProfile" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "CreatorProfile" FROM PUBLIC, anon, authenticated, service_role;
ALTER TABLE "CampaignCreator" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "CampaignCreator" FROM PUBLIC, anon, authenticated, service_role;
ALTER TABLE "CreatorConnection" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "CreatorConnection" FROM PUBLIC, anon, authenticated, service_role;
ALTER TABLE "CreatorSubmission" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "CreatorSubmission" FROM PUBLIC, anon, authenticated, service_role;
ALTER TABLE "CreatorPost" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "CreatorPost" FROM PUBLIC, anon, authenticated, service_role;
ALTER TABLE "CreatorPostSnapshot" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "CreatorPostSnapshot" FROM PUBLIC, anon, authenticated, service_role;
ALTER TABLE "CreatorPeriod" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "CreatorPeriod" FROM PUBLIC, anon, authenticated, service_role;
ALTER TABLE "CreatorPayout" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "CreatorPayout" FROM PUBLIC, anon, authenticated, service_role;

-- The Business plan and custom plans include creator campaigns (owner decision, 21 October 2026). Other plans get it
-- when an admin ticks it in Admin -> Plans.
WITH before AS (
  SELECT * FROM "PlanDefinition"
  WHERE ("key" = 'BUSINESS' OR "isCustom")
    AND jsonb_typeof("featureKeys") = 'array'
    AND NOT "featureKeys" @> '["creators"]'::jsonb
),
changed AS (
  UPDATE "PlanDefinition" p
  SET "featureKeys" = p."featureKeys" || '["creators"]'::jsonb, "updatedAt" = CURRENT_TIMESTAMP
  FROM before b
  WHERE p."id" = b."id"
  RETURNING p.*
)
INSERT INTO "AuditLog" ("id", "actor", "action", "target", "before", "after", "createdAt")
SELECT 'aud_' || replace(gen_random_uuid()::text, '-', ''), 'migration:20261028100000_creator_campaigns', 'update_plan', 'plan:' || c."key",
  jsonb_build_object('featureKeys', b."featureKeys"),
  jsonb_build_object('featureKeys', c."featureKeys"),
  CURRENT_TIMESTAMP
FROM before b JOIN changed c ON c."id" = b."id";

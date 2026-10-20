-- Daily posts made for you (docs/CONTENT.md "Daily posts", docs/guide/features/36-daily-posts.md): every night BuPulse
-- makes the day's posts for companies on the Business plan or a custom plan, without anyone pressing "Create today's
-- content". New: the post source DAILY, Business.dailyPostSettings (null = the defaults, on), and the DailyPostRun
-- table (one row per company and local day: the cron's claim, what it made or why it skipped). Locked like every other
-- table (row level security on, no Data API grants). The feature key "dailyPosts" is added to the BUSINESS plan and
-- to every custom plan that has its prerequisites, each change written to the audit log like an edit in Admin -> Plans.

-- AlterEnum
ALTER TYPE "PostSource" ADD VALUE IF NOT EXISTS 'DAILY';

-- AlterTable
ALTER TABLE "Business" ADD COLUMN "dailyPostSettings" JSONB;

-- CreateTable
CREATE TABLE "DailyPostRun" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "posts" INTEGER NOT NULL DEFAULT 0,
    "subjectKind" TEXT,
    "subjectId" TEXT,
    "angles" TEXT[],
    "reason" TEXT,
    "note" TEXT,
    "notifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyPostRun_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "DailyPostRun_status_check" CHECK ("status" IN ('RUNNING', 'DONE', 'SKIPPED', 'FAILED')),
    CONSTRAINT "DailyPostRun_counts_check" CHECK ("posts" >= 0 AND "attempts" >= 1)
);

-- CreateIndex
CREATE UNIQUE INDEX "DailyPostRun_businessId_day_key" ON "DailyPostRun"("businessId", "day");

-- CreateIndex
CREATE INDEX "DailyPostRun_day_status_idx" ON "DailyPostRun"("day", "status");

-- AddForeignKey
ALTER TABLE "DailyPostRun" ADD CONSTRAINT "DailyPostRun_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The app reaches this table through Prisma only; the Data API roles get nothing (tests/security/rls-coverage.test.ts).
ALTER TABLE "DailyPostRun" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "DailyPostRun" FROM PUBLIC, anon, authenticated, service_role;

-- The Business plan and custom plans include daily posts (owner decision, 20 October 2026). Only rows that have the
-- prerequisites (content, designs, calendar, gallery) and not the key yet; other plans get it when an admin ticks it.
WITH before AS (
  SELECT * FROM "PlanDefinition"
  WHERE ("key" = 'BUSINESS' OR "isCustom")
    AND jsonb_typeof("featureKeys") = 'array'
    AND "featureKeys" @> '["content", "designs", "calendar", "gallery"]'::jsonb
    AND NOT "featureKeys" @> '["dailyPosts"]'::jsonb
),
changed AS (
  UPDATE "PlanDefinition" p
  SET "featureKeys" = p."featureKeys" || '["dailyPosts"]'::jsonb, "updatedAt" = CURRENT_TIMESTAMP
  FROM before b
  WHERE p."id" = b."id"
  RETURNING p.*
)
INSERT INTO "AuditLog" ("id", "actor", "action", "target", "before", "after", "createdAt")
SELECT 'aud_' || replace(gen_random_uuid()::text, '-', ''), 'migration:20261027100000_daily_posts', 'update_plan', 'plan:' || c."key",
  jsonb_build_object('featureKeys', b."featureKeys"),
  jsonb_build_object('featureKeys', c."featureKeys"),
  CURRENT_TIMESTAMP
FROM before b JOIN changed c ON c."id" = b."id";

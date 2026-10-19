-- The free first-post preview (docs/guide/features/29-first-post-preview.md): one AI post a company may make while it
-- waits for its demo. One new table only: nothing existing is changed. Locked like every other table (row level
-- security on, no Data API grants). Off until the owner switches it on in Admin -> Settings.

-- CreateTable
CREATE TABLE "FirstPostPreview" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'making',
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "caption" TEXT,
    "hashtags" TEXT[],
    "headline" TEXT,
    "provider" TEXT,
    "model" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FirstPostPreview_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "FirstPostPreview_status_check" CHECK ("status" IN ('making', 'ready', 'failed'))
);

-- CreateIndex
CREATE UNIQUE INDEX "FirstPostPreview_businessId_key" ON "FirstPostPreview"("businessId");

-- CreateIndex
CREATE INDEX "FirstPostPreview_userId_idx" ON "FirstPostPreview"("userId");

-- The app reaches this table through Prisma only; the Data API roles get nothing (tests/security/rls-coverage.test.ts).
ALTER TABLE "FirstPostPreview" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "FirstPostPreview" FROM PUBLIC, anon, authenticated, service_role;

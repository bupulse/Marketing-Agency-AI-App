-- The temporary reel engine (docs/REEL_ENGINE.md, owner decision 23 October 2026): 30-second AI reels from 4 Google Veo
-- clips with the company's own AI presenter, until the Video Studio's Seedance engine is ready. Locked like every other
-- table (row level security on, no Data API grants).

-- CreateTable
CREATE TABLE "ReelPresenter" (
    "businessId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReelPresenter_pkey" PRIMARY KEY ("businessId")
);

-- CreateTable
CREATE TABLE "ReelJob" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "subjectId" TEXT,
    "language" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'filming',
    "plan" JSONB NOT NULL,
    "path" TEXT,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "stepUntil" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReelJob_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ReelJob_status_check" CHECK ("status" IN ('filming', 'assembling', 'done', 'failed')),
    CONSTRAINT "ReelJob_tier_check" CHECK ("tier" IN ('lite', 'fast')),
    CONSTRAINT "ReelJob_cost_check" CHECK ("costUsd" >= 0)
);

-- CreateIndex
CREATE INDEX "ReelJob_businessId_createdAt_idx" ON "ReelJob"("businessId", "createdAt");

-- AddForeignKey
ALTER TABLE "ReelPresenter" ADD CONSTRAINT "ReelPresenter_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReelJob" ADD CONSTRAINT "ReelJob_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The app reaches these tables through Prisma only; the Data API roles get nothing (tests/security/rls-coverage.test.ts).
ALTER TABLE "ReelPresenter" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "ReelPresenter" FROM PUBLIC, anon, authenticated, service_role;
ALTER TABLE "ReelJob" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "ReelJob" FROM PUBLIC, anon, authenticated, service_role;

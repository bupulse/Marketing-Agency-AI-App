-- The image engine's memory (docs/IMAGE_ENGINE.md, owner request 23 October 2026: every AI picture unique). One row per
-- picture idea: its ad pattern, shot, light, layout, words, the Prompter's image prompt, the Painter's tier (lite or
-- pro) and credits, and the finished design. Locked like every other table (row level security on, no Data API grants).

-- CreateTable
CREATE TABLE "ImageConcept" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "subjectId" TEXT,
    "pattern" TEXT NOT NULL,
    "shot" TEXT NOT NULL,
    "light" TEXT NOT NULL,
    "layout" TEXT NOT NULL,
    "treatment" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "scene" TEXT NOT NULL,
    "headline" TEXT NOT NULL,
    "subline" TEXT NOT NULL,
    "cta" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "planner" TEXT NOT NULL,
    "photoPath" TEXT,
    "tier" TEXT NOT NULL,
    "aspectRatio" TEXT NOT NULL,
    "credits" INTEGER NOT NULL,
    "creditPeriod" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'planned',
    "paintingUntil" TIMESTAMP(3),
    "designId" TEXT,
    "path" TEXT,
    "caption" TEXT,
    "check" JSONB,
    "fixed" BOOLEAN NOT NULL DEFAULT false,
    "rating" INTEGER,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImageConcept_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ImageConcept_status_check" CHECK ("status" IN ('planned', 'painting', 'done', 'failed')),
    CONSTRAINT "ImageConcept_tier_check" CHECK ("tier" IN ('lite', 'pro')),
    CONSTRAINT "ImageConcept_credits_check" CHECK ("credits" >= 0),
    CONSTRAINT "ImageConcept_rating_check" CHECK ("rating" IS NULL OR "rating" IN (-1, 1))
);

-- CreateIndex
CREATE INDEX "ImageConcept_businessId_createdAt_idx" ON "ImageConcept"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "ImageConcept_batchId_idx" ON "ImageConcept"("batchId");

-- AddForeignKey
ALTER TABLE "ImageConcept" ADD CONSTRAINT "ImageConcept_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The app reaches this table through Prisma only; the Data API roles get nothing (tests/security/rls-coverage.test.ts).
ALTER TABLE "ImageConcept" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "ImageConcept" FROM PUBLIC, anon, authenticated, service_role;

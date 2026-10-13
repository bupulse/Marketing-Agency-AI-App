-- Content flow v3 (docs/CONTENT.md): a day's content per product, campaign or General, written from a rotating angle.

-- One GeneratedContent row per post of a day's run. Columns only: the table keeps its RLS and revoked grants.
ALTER TABLE "GeneratedContent" ADD COLUMN "forDate" DATE;
ALTER TABLE "GeneratedContent" ADD COLUMN "angle" TEXT;
ALTER TABLE "GeneratedContent" ADD COLUMN "network" TEXT;
ALTER TABLE "GeneratedContent" ADD COLUMN "runId" TEXT;
ALTER TABLE "GeneratedContent" ADD COLUMN "mode" TEXT;
ALTER TABLE "GeneratedContent" ADD COLUMN "brief" TEXT;
ALTER TABLE "GeneratedContent" ADD CONSTRAINT "GeneratedContent_mode_check" CHECK ("mode" IS NULL OR "mode" IN ('ai', 'describe', 'own'));
CREATE INDEX "GeneratedContent_businessId_forDate_idx" ON "GeneratedContent"("businessId", "forDate");

-- The angle each subject used on each day, so the next day takes another one.
CREATE TABLE "ContentAngle" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "subjectKey" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "angle" TEXT NOT NULL,
    "hook" TEXT NOT NULL,
    "structure" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentAngle_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ContentAngle_source_check" CHECK ("source" IN ('studio', 'autopilot'))
);

CREATE UNIQUE INDEX "ContentAngle_businessId_subjectKey_day_source_key" ON "ContentAngle"("businessId", "subjectKey", "day", "source");
CREATE INDEX "ContentAngle_businessId_subjectKey_day_idx" ON "ContentAngle"("businessId", "subjectKey", "day");
ALTER TABLE "ContentAngle" ADD CONSTRAINT "ContentAngle_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Same rules as every other table: RLS on, no access through the Data API (Prisma connects as postgres).
ALTER TABLE "ContentAngle" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "ContentAngle" FROM PUBLIC, anon, authenticated, service_role;

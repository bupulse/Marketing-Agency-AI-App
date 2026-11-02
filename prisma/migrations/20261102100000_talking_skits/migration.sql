-- Talking skits (lib/skits, owner decision 31 October 2026): short videos of people talking on camera, made on the
-- plan's skit days from the client's own recorded voice. Business (50,000 RWF) gets 2 a week, Business Pro (80,000 RWF)
-- 3 a week (the new limit `skitsPerWeek` in PlanDefinition.limits); extra skits are 5,000 RWF each. Locked like every
-- other table (row level security on, no Data API grants).

-- CreateTable
CREATE TABLE "Skit" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "slot" INTEGER NOT NULL DEFAULT 0,
    "extra" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'WRITING',
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "plannedDay" DATE NOT NULL,
    "carryCount" INTEGER NOT NULL DEFAULT 0,
    "language" TEXT NOT NULL DEFAULT 'English',
    "title" TEXT NOT NULL DEFAULT '',
    "scene" TEXT NOT NULL DEFAULT '',
    "lines" JSONB NOT NULL DEFAULT '[]',
    "speakers" JSONB NOT NULL DEFAULT '[]',
    "caption" TEXT NOT NULL DEFAULT '',
    "hashtags" TEXT[],
    "subjectKind" TEXT,
    "subjectId" TEXT,
    "voicePaths" TEXT[],
    "voiceAt" TIMESTAMP(3),
    "taskId" TEXT,
    "taskStartedAt" TIMESTAMP(3),
    "videoPath" TEXT,
    "postGroupId" TEXT,
    "error" TEXT,
    "notifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Skit_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Skit_status_check" CHECK ("status" IN ('ORDERED', 'WRITING', 'WRITE_FAILED', 'WAITING_VOICE', 'VOICE_RECEIVED', 'MAKING', 'READY', 'FAILED', 'EXPIRED')),
    CONSTRAINT "Skit_slot_check" CHECK ("slot" >= 0),
    CONSTRAINT "Skit_carry_check" CHECK ("carryCount" >= 0)
);

-- CreateIndex
CREATE UNIQUE INDEX "Skit_businessId_day_slot_key" ON "Skit"("businessId", "day", "slot");

-- CreateIndex
CREATE INDEX "Skit_status_plannedDay_idx" ON "Skit"("status", "plannedDay");

-- CreateIndex
CREATE INDEX "Skit_businessId_plannedDay_idx" ON "Skit"("businessId", "plannedDay");

-- AddForeignKey
ALTER TABLE "Skit" ADD CONSTRAINT "Skit_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The app reaches this table through Prisma only; the Data API roles get nothing (tests/security/rls-coverage.test.ts).
ALTER TABLE "Skit" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "Skit" FROM PUBLIC, anon, authenticated, service_role;

-- The client's voice notes go to the "media" bucket (written by the server only, in the owner's folder): the browser
-- sends WAV, or the file as it is when it cannot convert it (a WhatsApp .ogg/.opus, an iPhone .m4a, an .mp3). Added to
-- the types the bucket already takes, so nothing it takes now is lost.
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NULL THEN
    RAISE NOTICE 'storage schema not found, skipping';
    RETURN;
  END IF;
  UPDATE storage.buckets
  SET allowed_mime_types = (
    SELECT array_agg(DISTINCT t ORDER BY t)
    FROM unnest(coalesce(allowed_mime_types, ARRAY[]::text[]) || ARRAY['audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/opus', 'audio/webm', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/mpeg']) AS t
  )
  WHERE id = 'media';
END
$$;

-- Skits a week: Business 2, Business Pro 3 (only when no admin set the limit yet). Written to the audit log like an edit
-- in Admin -> Plans.
WITH before AS (
  SELECT * FROM "PlanDefinition"
  WHERE "key" IN ('BUSINESS', 'BUSINESS_PRO') AND jsonb_typeof("limits") = 'object' AND NOT ("limits" ? 'skitsPerWeek')
),
changed AS (
  UPDATE "PlanDefinition" p
  SET "limits" = p."limits" || jsonb_build_object('skitsPerWeek', CASE WHEN p."key" = 'BUSINESS_PRO' THEN 3 ELSE 2 END), "updatedAt" = CURRENT_TIMESTAMP
  FROM before b
  WHERE p."id" = b."id"
  RETURNING p.*
)
INSERT INTO "AuditLog" ("id", "actor", "action", "target", "before", "after", "createdAt")
SELECT 'aud_' || replace(gen_random_uuid()::text, '-', ''), 'migration:20261102100000_talking_skits', 'update_plan_limits', 'plan:' || c."key",
  b."limits", c."limits", CURRENT_TIMESTAMP
FROM before b JOIN changed c ON c."id" = b."id";

-- Voiceover and music for content videos (docs/VOICE_AND_MUSIC.md). New tables, a public music bucket, and the
-- voiceover feature in the plans (owner decision, 13 October 2026). Additive.

CREATE TABLE "VoiceClip" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "voiceId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "characters" INTEGER NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "timings" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VoiceClip_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "VoiceClip_sizes_check" CHECK ("bytes" >= 0 AND "characters" >= 0 AND "durationMs" >= 0)
);
CREATE UNIQUE INDEX "VoiceClip_businessId_hash_key" ON "VoiceClip"("businessId", "hash");
ALTER TABLE "VoiceClip" ADD CONSTRAINT "VoiceClip_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "MusicTrack" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "moods" TEXT[],
    "bpm" INTEGER,
    "licence" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "attribution" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "durationMs" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MusicTrack_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MusicTrack_bytes_check" CHECK ("bytes" > 0 AND "bytes" <= 6291456),
    CONSTRAINT "MusicTrack_bpm_check" CHECK ("bpm" IS NULL OR ("bpm" >= 30 AND "bpm" <= 300))
);
CREATE UNIQUE INDEX "MusicTrack_path_key" ON "MusicTrack"("path");
CREATE INDEX "MusicTrack_active_idx" ON "MusicTrack"("active");

ALTER TABLE "VoiceClip" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MusicTrack" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "VoiceClip", "MusicTrack" FROM PUBLIC, anon, authenticated, service_role;

-- Storage: voiceovers go to the private media bucket (audio/mpeg added); music to a public-read "music" bucket
-- (royalty-free tracks the admin uploads with the service key; nobody else may write).
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NULL THEN
    RAISE NOTICE 'storage schema not found, skipping';
    RETURN;
  END IF;
  UPDATE storage.buckets
  SET allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm', 'audio/mpeg']
  WHERE id = 'media';
  INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  VALUES ('music', 'music', true, 6291456, ARRAY['audio/mpeg', 'audio/mp4', 'audio/x-m4a'])
  ON CONFLICT (id) DO UPDATE SET public = true, file_size_limit = 6291456, allowed_mime_types = ARRAY['audio/mpeg', 'audio/mp4', 'audio/x-m4a'];
END
$$;

-- Voiceover in the plans: Business and Pro 5,000 characters a month, the trial 600; Starter and Standard none (sold as
-- the "Voiceover" add-on).
UPDATE "PlanDefinition"
SET "featureKeys" = "featureKeys" || '["voice"]'::jsonb
WHERE ("key" IN ('BUSINESS', 'PRO') OR "isTrial" = true)
  AND "featureKeys" IS NOT NULL AND jsonb_typeof("featureKeys") = 'array' AND NOT ("featureKeys" @> '["voice"]'::jsonb);
UPDATE "PlanDefinition" SET "limits" = jsonb_set("limits", '{voiceCharacters}', '5000'::jsonb) WHERE "key" IN ('BUSINESS', 'PRO') AND jsonb_typeof("limits") = 'object';
UPDATE "PlanDefinition" SET "limits" = jsonb_set("limits", '{voiceCharacters}', '600'::jsonb) WHERE "isTrial" = true AND jsonb_typeof("limits") = 'object';
UPDATE "PlanDefinition" SET "limits" = jsonb_set("limits", '{voiceCharacters}', '0'::jsonb) WHERE "key" IN ('STARTER', 'STANDARD') AND jsonb_typeof("limits") = 'object';

-- The voiceover add-on in Rwanda: 5,000 RWF a month (owner decision, 13 October 2026).
INSERT INTO "AddonPrice" ("id", "addonKey", "regionKey", "currency", "monthlyMinor", "updatedBy", "updatedAt") VALUES
    ('addon_rw_voice', 'voice', 'RW', 'RWF', 5000, 'migration', CURRENT_TIMESTAMP)
ON CONFLICT ("addonKey", "regionKey") DO NOTHING;

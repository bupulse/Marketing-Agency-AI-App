-- Video usage counts videos, not seconds (owner decision, 14 October 2026; docs/CONTENT_VISUALS.md): each video is at
-- most 30 seconds, at most 4 a day (Kigali), and plans with video allow 4 x 30 = 120 a month (a plan setting).

-- 1. The monthly counter: seconds become videos (a video was at most 30 s, so each started 30 s is one video).
ALTER TABLE "UsageRecord" RENAME COLUMN "videoSeconds" TO "videos";
UPDATE "UsageRecord" SET "videos" = CEIL("videos" / 30.0)::int WHERE "videos" > 0;

-- 2. Plan limits: videoSeconds -> videos (plans with video: 120 a month, 4 a day; the trial's one sample video: 1).
--    Voiceover characters follow: 600 a video (the longest 30 s voiceover) on the plans with video.
UPDATE "PlanDefinition"
SET "limits" = ("limits" - 'videoSeconds') || jsonb_build_object(
  'videos', CASE WHEN COALESCE(("limits"->>'videoSeconds')::int, 0) <= 0 THEN 0 WHEN COALESCE(("limits"->>'videoSeconds')::int, 0) <= 30 THEN 1 ELSE 120 END,
  'videosPerDay', CASE WHEN COALESCE(("limits"->>'videoSeconds')::int, 0) <= 0 THEN 0 WHEN COALESCE(("limits"->>'videoSeconds')::int, 0) <= 30 THEN 1 ELSE 4 END)
WHERE jsonb_typeof("limits") = 'object';

UPDATE "PlanDefinition"
SET "limits" = jsonb_set("limits", '{voiceCharacters}', to_jsonb(GREATEST(COALESCE(("limits"->>'voiceCharacters')::int, 0), ("limits"->>'videos')::int * 600)))
WHERE jsonb_typeof("limits") = 'object' AND COALESCE(("limits"->>'voiceCharacters')::int, 0) > 0 AND ("limits"->>'videos')::int > 1;

-- 3. Stored offers (their custom plans are PlanDefinition rows, done above): the same rename, for the admin's view.
UPDATE "PlanOffer"
SET "limits" = ("limits" - 'videoSeconds') || jsonb_build_object(
  'videos', CASE WHEN COALESCE(("limits"->>'videoSeconds')::int, 0) <= 0 THEN 0 WHEN COALESCE(("limits"->>'videoSeconds')::int, 0) <= 30 THEN 1 ELSE 120 END)
WHERE jsonb_typeof("limits") = 'object' AND "limits" ? 'videoSeconds';

-- 4. Videos made per day.
CREATE TABLE "VideoDayUsage" (
    "userId" UUID NOT NULL,
    "day" TEXT NOT NULL,
    "videos" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "VideoDayUsage_pkey" PRIMARY KEY ("userId", "day"),
    CONSTRAINT "VideoDayUsage_videos_check" CHECK ("videos" >= 0),
    CONSTRAINT "VideoDayUsage_day_check" CHECK ("day" ~ '^\d{4}-\d{2}-\d{2}$')
);
ALTER TABLE "VideoDayUsage" ADD CONSTRAINT "VideoDayUsage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VideoDayUsage" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "VideoDayUsage" FROM PUBLIC, anon, authenticated, service_role;

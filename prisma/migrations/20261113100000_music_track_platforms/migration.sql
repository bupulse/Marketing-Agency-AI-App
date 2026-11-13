-- Music tracks limited to some apps (Meta Sound Collection: Facebook and Instagram only). Empty = every app (13 Nov 2026).
ALTER TABLE "MusicTrack" ADD COLUMN "platforms" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- The trending Instagram sound attached when a reel was published (lib/social/instagram-audio.ts).
ALTER TABLE "Post" ADD COLUMN "trendingSound" JSONB;

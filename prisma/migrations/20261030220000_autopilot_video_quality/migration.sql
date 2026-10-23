-- Video quality for the videos Autopilot makes (owner decision, 23 October 2026; lib/visuals/video-quality.ts,
-- docs/CONTENT_VISUALS.md "Video quality"): simple (the slideshow, as before), mix (one video in four gets AI clips) or
-- ai (every video gets AI clips, paid in studio credits). Existing rows keep simple videos. Daily posts keep the same
-- choice in Business.dailyPostSettings (JSON), so no column there.

-- AlterTable
ALTER TABLE "AutopilotSettings" ADD COLUMN "videoQuality" TEXT NOT NULL DEFAULT 'simple';

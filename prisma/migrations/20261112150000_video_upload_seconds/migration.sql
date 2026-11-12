-- Uploaded videos (engine 'upload', lib/video-library/upload.ts) may be 1 to 60 seconds long (upload-rules.ts); the
-- Video Studio's own videos stay 4 to 30 seconds. The old check refused every upload longer than 30 s (12 Nov 2026).
ALTER TABLE "VideoJob" DROP CONSTRAINT IF EXISTS "VideoJob_numbers_check";
ALTER TABLE "VideoJob" ADD CONSTRAINT "VideoJob_numbers_check" CHECK (
  "credits" >= 0 AND "bytes" >= 0 AND "attempts" >= 0
  AND (("engine" = 'upload' AND "seconds" BETWEEN 1 AND 60) OR "seconds" BETWEEN 4 AND 30)
);

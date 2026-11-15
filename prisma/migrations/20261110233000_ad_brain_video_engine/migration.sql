-- The Ad Brain's finished ads show in the Videos library as VideoJob rows of engine "adbrain" (lib/ad-brain/deliver.ts).
-- Keeps 'upload' (main's 20261112100000_video_upload_engine): production already has uploaded videos when this runs
-- (15 November 2026), and a check without 'upload' would fail there (23514), as it did once on TEST.
ALTER TABLE "VideoJob" DROP CONSTRAINT IF EXISTS "VideoJob_engine_check";
ALTER TABLE "VideoJob" ADD CONSTRAINT "VideoJob_engine_check" CHECK ("engine" IN ('motion', 'premium3d', 'seedance', 'adbrain', 'upload'));

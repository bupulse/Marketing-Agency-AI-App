-- Videos the company uploads itself (Videos → Upload a video) are VideoJob rows with engine 'upload'. The check from
-- 20261022100000_video_studio only allowed the studio's engines, so every upload failed at the save (23514). Widened,
-- never narrowed: existing rows keep their values.
ALTER TABLE "VideoJob" DROP CONSTRAINT IF EXISTS "VideoJob_engine_check";
ALTER TABLE "VideoJob" ADD CONSTRAINT "VideoJob_engine_check" CHECK ("engine" IN ('motion', 'premium3d', 'seedance', 'upload'));

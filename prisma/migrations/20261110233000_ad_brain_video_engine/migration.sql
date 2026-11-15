-- The Ad Brain's finished ads show in the Videos library as VideoJob rows of engine "adbrain" (lib/ad-brain/deliver.ts).
ALTER TABLE "VideoJob" DROP CONSTRAINT IF EXISTS "VideoJob_engine_check";
ALTER TABLE "VideoJob" ADD CONSTRAINT "VideoJob_engine_check" CHECK ("engine" IN ('motion', 'premium3d', 'seedance', 'adbrain'));

-- Picture or video decided per post (docs/CONTENT.md, "Format: BuPulse decides"): the format of each content row, so
-- the next days vary it per app. Column only: GeneratedContent keeps its RLS and revoked grants.
ALTER TABLE "GeneratedContent" ADD COLUMN "format" TEXT;
ALTER TABLE "GeneratedContent" ADD CONSTRAINT "GeneratedContent_format_check" CHECK ("format" IS NULL OR "format" IN ('image', 'carousel', 'video'));

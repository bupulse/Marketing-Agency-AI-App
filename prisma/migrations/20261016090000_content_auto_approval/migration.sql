-- Content page and auto-approval (docs/CONTENT.md). Columns only, no new table: Business and Post keep their RLS and
-- revoked grants.

-- Posts drafted automatically from Studio content wait for review like Autopilot's.
ALTER TYPE "PostSource" ADD VALUE IF NOT EXISTS 'STUDIO';

-- Content -> Settings: per app, whether new posts wait for approval. Null means approval for every app (the default).
ALTER TABLE "Business" ADD COLUMN "contentSettings" JSONB;
-- The daily "what was auto-scheduled" email: when it last went out, so it goes once a day and lists only new posts.
ALTER TABLE "Business" ADD COLUMN "contentSummarySentAt" TIMESTAMP(3);

-- Why a post still waits for review although its app needs no approval ("Video needs to be made: open to render").
ALTER TABLE "Post" ADD COLUMN "reviewNote" TEXT;
-- Set when auto-approval scheduled the post: the summary email and the in-app notice list these.
ALTER TABLE "Post" ADD COLUMN "autoScheduledAt" TIMESTAMP(3);
-- The kind of post for the Content page's type filter: post, carousel, video or article. A video post on Instagram or
-- Facebook has format POST and a video file, which a Prisma filter cannot see inside the mediaPaths array, so a trigger
-- keeps this column from format and mediaPaths (lib/content-board/kind.ts is the same rule in TypeScript).
ALTER TABLE "Post" ADD COLUMN "mediaKind" TEXT NOT NULL DEFAULT 'post';
ALTER TABLE "Post" ADD CONSTRAINT "Post_mediaKind_check" CHECK ("mediaKind" IN ('post', 'carousel', 'video', 'article'));

CREATE OR REPLACE FUNCTION public.bupulse_post_media_kind()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp
AS $$
BEGIN
  NEW."mediaKind" := CASE
    WHEN NEW."format" = 'ARTICLE' THEN 'article'
    WHEN NEW."format" = 'SCRIPT' THEN 'video'
    WHEN EXISTS (SELECT 1 FROM unnest(NEW."mediaPaths") AS p WHERE p ~* '\.(mp4|webm)$') THEN 'video'
    WHEN NEW."format" = 'CAROUSEL' THEN 'carousel'
    ELSE 'post'
  END;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION public.bupulse_post_media_kind() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER "Post_media_kind"
BEFORE INSERT OR UPDATE OF "format", "mediaPaths" ON "Post"
FOR EACH ROW EXECUTE FUNCTION public.bupulse_post_media_kind();

-- Existing posts: the trigger fires on this update and fills the column.
UPDATE "Post" SET "format" = "format";

-- Content page lists (created today, newest first) and the summary email (auto-scheduled since the last one).
CREATE INDEX "Post_businessId_createdAt_idx" ON "Post"("businessId", "createdAt");
CREATE INDEX "Post_businessId_autoScheduledAt_idx" ON "Post"("businessId", "autoScheduledAt");

-- Video robot (docs/VIDEO_ROBOT.md): a scheduled GitHub Actions job renders pending content videos in headless Chrome.
-- Two columns on ContentVisual and two indexes; nothing existing is rewritten.

-- The robot's current job (a random id, unique while the render lease is held) and how many robot renders failed;
-- after 3 the robot leaves the video to the owner's browser.
ALTER TABLE "ContentVisual" ADD COLUMN "robotJobId" TEXT;
ALTER TABLE "ContentVisual" ADD COLUMN "robotAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ContentVisual" ADD CONSTRAINT "ContentVisual_robotAttempts_check" CHECK ("robotAttempts" >= 0);

CREATE UNIQUE INDEX "ContentVisual_robotJobId_key" ON "ContentVisual"("robotJobId");
-- The robot's queue: pending videos, oldest first.
CREATE INDEX "ContentVisual_kind_status_createdAt_idx" ON "ContentVisual"("kind", "status", "createdAt");

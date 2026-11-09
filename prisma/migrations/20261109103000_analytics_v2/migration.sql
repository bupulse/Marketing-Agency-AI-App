-- Visitor analytics v2 (docs/SUPPORT_DASHBOARD.md, "Visitor analytics"): one visitor = the same IP and the same device
-- (type, screen size, language) on the same UTC day, whatever the browser. City from the host's geo header, time on
-- page from the tracker's beacon, and which counting method each row used. Additive and nullable only.
ALTER TABLE "PageView" ADD COLUMN "city" TEXT;
ALTER TABLE "PageView" ADD COLUMN "screenHeight" INTEGER;
ALTER TABLE "PageView" ADD COLUMN "language" TEXT;
ALTER TABLE "PageView" ADD COLUMN "viewId" TEXT;
ALTER TABLE "PageView" ADD COLUMN "durationMs" INTEGER;
ALTER TABLE "PageView" ADD COLUMN "countMethod" TEXT;

-- The time-on-page beacon finds its view by id.
CREATE INDEX "PageView_viewId_idx" ON "PageView"("viewId");

-- The Video Studio as its own site (docs/VIDEO_STUDIO_SPLIT.md): one-click sign-in tickets from BuPulse, and the
-- "Your video is ready" notice state on each job. New table and new columns only.

-- AlterTable
ALTER TABLE "VideoJob" ADD COLUMN     "readyNoticeAt" TIMESTAMP(3),
ADD COLUMN     "seenAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "StudioTicket" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "businessId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudioTicket_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StudioTicket_tokenHash_key" ON "StudioTicket"("tokenHash");

-- CreateIndex
CREATE INDEX "StudioTicket_expiresAt_idx" ON "StudioTicket"("expiresAt");

-- CreateIndex
CREATE INDEX "VideoJob_status_readyNoticeAt_idx" ON "VideoJob"("status", "readyNoticeAt");

-- AddForeignKey
ALTER TABLE "StudioTicket" ADD CONSTRAINT "StudioTicket_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

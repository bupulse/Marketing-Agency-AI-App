-- AlterTable
ALTER TABLE "User" ADD COLUMN     "trackedLinkId" TEXT;
-- AlterTable
ALTER TABLE "ContactRequest" ADD COLUMN     "trackedLinkId" TEXT;
-- AlterTable
ALTER TABLE "SupportConversation" ADD COLUMN     "trackedLinkId" TEXT;
-- CreateTable
CREATE TABLE "TrackedLink" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" TIMESTAMP(3),
    CONSTRAINT "TrackedLink_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "TrackedLinkClick" (
    "id" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "country" TEXT,
    CONSTRAINT "TrackedLinkClick_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE UNIQUE INDEX "TrackedLink_code_key" ON "TrackedLink"("code");
-- CreateIndex
CREATE INDEX "TrackedLink_createdById_idx" ON "TrackedLink"("createdById");
-- CreateIndex
CREATE INDEX "TrackedLinkClick_linkId_createdAt_idx" ON "TrackedLinkClick"("linkId", "createdAt");
-- AddForeignKey
ALTER TABLE "TrackedLink" ADD CONSTRAINT "TrackedLink_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "SupportAgent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "TrackedLinkClick" ADD CONSTRAINT "TrackedLinkClick_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "TrackedLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Like every table: only the server (the database owner) reads and writes them; the browser's Supabase keys never can.
ALTER TABLE "TrackedLink" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TrackedLinkClick" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "TrackedLink", "TrackedLinkClick" FROM PUBLIC, anon, authenticated, service_role;

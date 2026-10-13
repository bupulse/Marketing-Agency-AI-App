-- Jarvis keys made by staff carry that person's permissions (docs/JARVIS.md, docs/ADMIN.md "Organisation"): each tool
-- checks the permission it needs. Existing keys were made by the owner and stay unscoped.
ALTER TABLE "AdminApiKey" ADD COLUMN "scoped" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "AdminApiKey" ADD COLUMN "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "AdminApiKey" ADD COLUMN "createdByStaffId" TEXT;

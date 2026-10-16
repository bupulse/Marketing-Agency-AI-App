-- Organisation (docs/ADMIN.md, "Organisation"): staff with roles and permissions, custom roles, which sales staff
-- member each company belongs to (with history), referral codes, the sales room screen links and its sounds, and a
-- last-seen time per user for "active now".

-- AlterTable
ALTER TABLE "User" ADD COLUMN "lastSeenAt" TIMESTAMP(3);
ALTER TABLE "Business" ADD COLUMN "salesAgentId" TEXT;

-- CreateTable
CREATE TABLE "StaffMember" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "phone" TEXT,
    "userId" UUID,
    "roleKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'invited',
    "refCode" TEXT,
    "invitedBy" TEXT NOT NULL,
    "lastSignInAt" TIMESTAMP(3),
    "disabledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffMember_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "StaffMember_status_check" CHECK ("status" IN ('invited', 'active', 'disabled')),
    CONSTRAINT "StaffMember_email_lower_check" CHECK ("email" = lower("email")),
    CONSTRAINT "StaffMember_refCode_check" CHECK ("refCode" IS NULL OR "refCode" ~ '^[A-Z2-9]{4,8}$')
);

-- CreateTable
CREATE TABLE "StaffRole" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "permissions" TEXT[],
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientAssignment" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "staffId" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "source" TEXT NOT NULL,
    "reason" TEXT,
    "by" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientAssignment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ClientAssignment_source_check" CHECK ("source" IN ('referral', 'manager', 'script')),
    CONSTRAINT "ClientAssignment_period_check" CHECK ("endsAt" IS NULL OR "endsAt" >= "startsAt")
);

-- CreateTable
CREATE TABLE "ScreenLink" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),

    CONSTRAINT "ScreenLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SoundClip" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "prompt" TEXT,
    "bytes" INTEGER NOT NULL,
    "durationMs" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SoundClip_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SoundClip_source_check" CHECK ("source" IN ('upload', 'generated'))
);

-- CreateIndex
CREATE INDEX "User_lastSeenAt_idx" ON "User"("lastSeenAt");
CREATE INDEX "Business_salesAgentId_idx" ON "Business"("salesAgentId");
CREATE UNIQUE INDEX "StaffMember_email_key" ON "StaffMember"("email");
CREATE UNIQUE INDEX "StaffMember_userId_key" ON "StaffMember"("userId");
CREATE UNIQUE INDEX "StaffMember_refCode_key" ON "StaffMember"("refCode");
CREATE INDEX "StaffMember_status_idx" ON "StaffMember"("status");
CREATE UNIQUE INDEX "StaffRole_key_key" ON "StaffRole"("key");
CREATE INDEX "ClientAssignment_businessId_startsAt_idx" ON "ClientAssignment"("businessId", "startsAt");
CREATE INDEX "ClientAssignment_userId_startsAt_idx" ON "ClientAssignment"("userId", "startsAt");
CREATE INDEX "ClientAssignment_staffId_startsAt_idx" ON "ClientAssignment"("staffId", "startsAt");
CREATE UNIQUE INDEX "ScreenLink_tokenHash_key" ON "ScreenLink"("tokenHash");
CREATE UNIQUE INDEX "SoundClip_path_key" ON "SoundClip"("path");
CREATE INDEX "SoundClip_active_idx" ON "SoundClip"("active");

-- One open assignment per company (the current one has no end).
CREATE UNIQUE INDEX "ClientAssignment_one_open_per_business" ON "ClientAssignment"("businessId") WHERE "endsAt" IS NULL;

-- Admin-only tables: read and written with the database owner role after the app's own checks (permission + AAL2).
ALTER TABLE "StaffMember" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StaffRole" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ClientAssignment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ScreenLink" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SoundClip" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "StaffMember", "StaffRole", "ClientAssignment", "ScreenLink", "SoundClip" FROM PUBLIC, anon, authenticated, service_role;

-- A private bucket for the sales screen's sounds: no policy names it, so only the app (service key) reads and writes;
-- the screen gets short-lived signed URLs.
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NULL THEN
    RAISE NOTICE 'storage schema not found, skipping the sounds bucket';
    RETURN;
  END IF;
  INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  VALUES ('sounds', 'sounds', false, 1048576, ARRAY['audio/mpeg'])
  ON CONFLICT (id) DO NOTHING;
END $$;

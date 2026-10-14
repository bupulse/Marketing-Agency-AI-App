-- Install a version from a signed zip (docs/UPDATES.md, "Install from a zip"): the versions uploaded and installed,
-- and the private "releases" bucket for their zips and the database backups taken before their migrations.

-- CreateTable
CREATE TABLE "ReleaseVersion" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "commit" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "zipPath" TEXT NOT NULL,
    "zipPurgedAt" TIMESTAMP(3),
    "manifest" JSONB NOT NULL,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'verified',
    "uploadedBy" TEXT NOT NULL,
    "installRequestedAt" TIMESTAMP(3),
    "installRequestedBy" TEXT,
    "installedAt" TIMESTAMP(3),
    "cloudflareVersionId" TEXT,
    "backupPath" TEXT,
    "backupPurgedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReleaseVersion_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ReleaseVersion_status_check" CHECK ("status" IN ('verified', 'installing', 'installed', 'failed', 'superseded')),
    CONSTRAINT "ReleaseVersion_sha256_check" CHECK ("sha256" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "ReleaseVersion_commit_check" CHECK ("commit" ~ '^[0-9a-f]{40}$'),
    CONSTRAINT "ReleaseVersion_zipPath_check" CHECK ("zipPath" ~ '^zips/[0-9a-f-]{36}\.zip$')
);

-- CreateIndex
CREATE INDEX "ReleaseVersion_createdAt_idx" ON "ReleaseVersion"("createdAt");
CREATE INDEX "ReleaseVersion_status_installedAt_idx" ON "ReleaseVersion"("status", "installedAt");

-- Admin-only: read and written by the app (owner, AAL2) and the deploy workflow (database owner role).
ALTER TABLE "ReleaseVersion" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "ReleaseVersion" FROM PUBLIC, anon, authenticated, service_role;

-- The private bucket: no policy names it, so only the service key (the app's signed upload URL, the workflow) reaches
-- it. 50 MB per file, the free plan's limit.
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NULL THEN
    RAISE NOTICE 'storage schema not found, skipping the releases bucket';
    RETURN;
  END IF;
  INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  VALUES ('releases', 'releases', false, 52428800, ARRAY['application/zip', 'application/octet-stream'])
  ON CONFLICT (id) DO NOTHING;
END $$;

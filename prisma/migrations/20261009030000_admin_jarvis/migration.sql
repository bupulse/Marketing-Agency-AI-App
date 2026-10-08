-- Phase 8: admin console and Jarvis (audit log, money approvals, admin API keys, feature flags, announcements,
-- runtime plan limits) and account suspension.

ALTER TABLE "User" ADD COLUMN "suspendedAt" TIMESTAMP(3), ADD COLUMN "suspendedReason" TEXT;

CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");
CREATE INDEX "AuditLog_target_idx" ON "AuditLog"("target");

-- Append-only: rows can be added but never changed or removed, not even by the app's own database role.
CREATE FUNCTION "audit_log_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'AuditLog is append-only';
END;
$$;
CREATE TRIGGER "AuditLog_no_update" BEFORE UPDATE OR DELETE ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION "audit_log_immutable"();
CREATE TRIGGER "AuditLog_no_truncate" BEFORE TRUNCATE ON "AuditLog" FOR EACH STATEMENT EXECUTE FUNCTION "audit_log_immutable"();

CREATE TABLE "AdminApproval" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "requestedBy" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "result" JSONB,
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AdminApproval_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AdminApproval_idempotencyKey_key" ON "AdminApproval"("idempotencyKey");
CREATE INDEX "AdminApproval_status_createdAt_idx" ON "AdminApproval"("status", "createdAt");

CREATE TABLE "AdminApiKey" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "ipAllowList" TEXT[],
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AdminApiKey_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AdminApiKey_hash_key" ON "AdminApiKey"("hash");

CREATE TABLE "FeatureFlag" (
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "rolloutPercent" INTEGER NOT NULL DEFAULT 100,
    "userOverrides" JSONB,
    "description" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FeatureFlag_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "Announcement" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "audience" TEXT NOT NULL DEFAULT 'all',
    "plans" "Plan"[],
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMP(3),
    "dismissible" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Announcement_startsAt_endsAt_idx" ON "Announcement"("startsAt", "endsAt");

CREATE TABLE "PlanLimitOverride" (
    "plan" "Plan" NOT NULL,
    "limits" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PlanLimitOverride_pkey" PRIMARY KEY ("plan")
);

-- Admin data is only ever read and written by the server with the service role; no policies = no browser access.
ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AdminApproval" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AdminApiKey" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FeatureFlag" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Announcement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PlanLimitOverride" ENABLE ROW LEVEL SECURITY;

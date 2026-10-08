-- Phase 7: outgoing webhooks (all plans) and API keys (Pro).

CREATE TABLE "WebhookEndpoint" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "events" TEXT[],
    "secretEncrypted" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSuccessAt" TIMESTAMP(3),
    "lastFailureAt" TIMESTAMP(3),
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "WebhookEndpoint_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WebhookDelivery" (
    "id" TEXT NOT NULL,
    "endpointId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "responseStatus" INTEGER,
    "error" TEXT,
    "nextAttemptAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "scopes" TEXT[],
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ApiKey_hash_key" ON "ApiKey"("hash");
CREATE INDEX "ApiKey_businessId_idx" ON "ApiKey"("businessId");
CREATE INDEX "WebhookEndpoint_businessId_idx" ON "WebhookEndpoint"("businessId");
CREATE INDEX "WebhookDelivery_status_nextAttemptAt_idx" ON "WebhookDelivery"("status", "nextAttemptAt");
CREATE INDEX "WebhookDelivery_endpointId_createdAt_idx" ON "WebhookDelivery"("endpointId", "createdAt");
CREATE INDEX "WebhookDelivery_createdAt_idx" ON "WebhookDelivery"("createdAt");

ALTER TABLE "WebhookEndpoint" ADD CONSTRAINT "WebhookEndpoint_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "WebhookEndpoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- One-time move of the per-widget lead webhook (ChatWidget.webhookUrl) into a WebhookEndpoint that listens to
-- lead.created. The SAME encrypted secret is copied, so receivers keep verifying signatures without any change.
-- The old columns are left as they are (see the end of this file); the new code ignores them.
INSERT INTO "WebhookEndpoint" ("id", "businessId", "url", "events", "secretEncrypted", "enabled")
SELECT 'wh_' || md5("businessId" || 'widget-webhook'), "businessId", "webhookUrl", ARRAY['lead.created'], "webhookSecretEncrypted", true
FROM "ChatWidget"
WHERE "webhookUrl" IS NOT NULL AND "webhookSecretEncrypted" IS NOT NULL;

-- Leads whose old webhook was still waiting for a retry become pending deliveries (same payload shape as before),
-- so the new hourly retry picks them up. (Prisma stores timestamps as UTC without a zone, so they are formatted as they are.) Their 24 hour window starts from the lead's first failure.
INSERT INTO "WebhookDelivery" ("id", "endpointId", "event", "payload", "status", "attempts", "nextAttemptAt", "createdAt")
SELECT 'wd_' || md5(l."id" || 'widget-webhook'), 'wh_' || md5(l."businessId" || 'widget-webhook'), 'lead.created',
  jsonb_build_object(
    'event', 'lead.created',
    'lead', jsonb_build_object('id', l."id", 'name', l."name", 'email', l."email", 'phone', l."phone", 'interest', l."interest",
      'message', l."message", 'source', l."source", 'status', lower(l."status"::text), 'pageUrl', l."pageUrl",
      'createdAt', to_char(l."createdAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
    'business', jsonb_build_object('id', b."id", 'name', b."name"),
    'createdAt', to_char(l."webhookPendingAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  'pending', 3, CURRENT_TIMESTAMP, l."webhookPendingAt"
FROM "Lead" l
JOIN "Business" b ON b."id" = l."businessId"
JOIN "ChatWidget" w ON w."businessId" = l."businessId"
WHERE l."webhookPendingAt" IS NOT NULL AND w."webhookUrl" IS NOT NULL AND w."webhookSecretEncrypted" IS NOT NULL;

UPDATE "Lead" SET "webhookPendingAt" = NULL WHERE "webhookPendingAt" IS NOT NULL;

-- The old ChatWidget.webhookUrl / webhookSecretEncrypted columns are deliberately NOT cleared here. This migration runs
-- minutes before the new Worker is live; an old Worker that sees NULL would skip the webhook after claiming the lead's
-- notifiedAt, and that lead would be lost. The new code never reads those columns, so there is no double send.
-- TODO (follow-up migration, after the deploy is live): clear or drop ChatWidget.webhookUrl and webhookSecretEncrypted.

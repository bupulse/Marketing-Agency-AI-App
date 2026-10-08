-- Phase 7 commerce connectors: Shopify / WooCommerce stores, product mapping, Cloudflare token and installs.
CREATE TABLE "StoreConnection" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "storeUrl" TEXT NOT NULL,
  "credentialsEncrypted" TEXT NOT NULL,
  "scopes" TEXT,
  "currency" TEXT,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "lastSyncAt" TIMESTAMP(3),
  "lastSyncError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StoreConnection_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StoreConnection_businessId_provider_key" ON "StoreConnection"("businessId", "provider");
CREATE INDEX "StoreConnection_provider_storeUrl_idx" ON "StoreConnection"("provider", "storeUrl");
ALTER TABLE "StoreConnection" ADD CONSTRAINT "StoreConnection_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ProductSync" (
  "id" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "externalId" TEXT NOT NULL,
  "baseline" JSONB NOT NULL,
  "imageMap" JSONB NOT NULL,
  "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sourceMissing" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProductSync_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProductSync_projectId_key" ON "ProductSync"("projectId");
CREATE UNIQUE INDEX "ProductSync_connectionId_externalId_key" ON "ProductSync"("connectionId", "externalId");
ALTER TABLE "ProductSync" ADD CONSTRAINT "ProductSync_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "StoreConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductSync" ADD CONSTRAINT "ProductSync_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "CloudflareConnection" (
  "businessId" TEXT NOT NULL,
  "tokenEncrypted" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CloudflareConnection_pkey" PRIMARY KEY ("businessId")
);
ALTER TABLE "CloudflareConnection" ADD CONSTRAINT "CloudflareConnection_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "CloudflareInstall" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "zoneId" TEXT NOT NULL,
  "zoneName" TEXT NOT NULL,
  "toolId" TEXT NOT NULL,
  "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CloudflareInstall_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CloudflareInstall_businessId_zoneId_key" ON "CloudflareInstall"("businessId", "zoneId");
ALTER TABLE "CloudflareInstall" ADD CONSTRAINT "CloudflareInstall_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "CloudflareConnection"("businessId") ON DELETE CASCADE ON UPDATE CASCADE;

-- Other tables in this schema use RLS with no policies (server-only access); keep these private too.
ALTER TABLE "StoreConnection" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProductSync" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CloudflareConnection" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CloudflareInstall" ENABLE ROW LEVEL SECURITY;

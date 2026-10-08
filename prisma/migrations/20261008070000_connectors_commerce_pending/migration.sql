-- Fair rotation of the daily store sync, and WooCommerce keys that wait for the owner's confirmation.
ALTER TABLE "StoreConnection" ADD COLUMN "lastAttemptAt" TIMESTAMP(3);
CREATE INDEX "StoreConnection_lastAttemptAt_idx" ON "StoreConnection"("lastAttemptAt");

CREATE TABLE "StoreConnectionPending" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "storeUrl" TEXT NOT NULL,
  "credentialsEncrypted" TEXT NOT NULL,
  "currency" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StoreConnectionPending_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StoreConnectionPending_businessId_provider_key" ON "StoreConnectionPending"("businessId", "provider");
ALTER TABLE "StoreConnectionPending" ADD CONSTRAINT "StoreConnectionPending_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StoreConnectionPending" ENABLE ROW LEVEL SECURITY;

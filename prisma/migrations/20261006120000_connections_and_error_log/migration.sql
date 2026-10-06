-- CreateEnum
CREATE TYPE "ConnectionKind" AS ENUM ('SOCIAL', 'APP');

-- CreateEnum
CREATE TYPE "ConnectionMethod" AS ENUM ('DIRECT', 'OWN_COMPOSIO');

-- CreateEnum
CREATE TYPE "ConnectionStatus" AS ENUM ('ACTIVE', 'EXPIRING', 'EXPIRED', 'REVOKED', 'ERROR');

-- DropForeignKey
ALTER TABLE "Post" DROP CONSTRAINT "Post_socialAccountId_fkey";

-- DropForeignKey
ALTER TABLE "SocialAccount" DROP CONSTRAINT "SocialAccount_businessId_fkey";

-- DropIndex
DROP INDEX "Post_socialAccountId_externalId_key";

-- AlterTable
ALTER TABLE "Business" ADD COLUMN     "composioApiKeyEncrypted" TEXT;

-- AlterTable
ALTER TABLE "Post" DROP COLUMN "socialAccountId",
ADD COLUMN     "connectionId" TEXT NOT NULL;

-- DropTable
DROP TABLE "SocialAccount";

-- CreateTable
CREATE TABLE "Connection" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "kind" "ConnectionKind" NOT NULL,
    "provider" TEXT NOT NULL,
    "method" "ConnectionMethod" NOT NULL DEFAULT 'DIRECT',
    "externalAccountId" TEXT NOT NULL,
    "displayName" TEXT,
    "accessTokenEncrypted" TEXT,
    "refreshTokenEncrypted" TEXT,
    "scopes" TEXT[],
    "status" "ConnectionStatus" NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMP(3),
    "lastCheckedAt" TIMESTAMP(3),
    "composioConnectedAccountId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Connection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErrorLog" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "level" TEXT NOT NULL DEFAULT 'error',
    "source" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "stack" TEXT,
    "userId" TEXT,
    "businessId" TEXT,
    "context" JSONB,

    CONSTRAINT "ErrorLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Connection_status_expiresAt_idx" ON "Connection"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Connection_businessId_provider_externalAccountId_key" ON "Connection"("businessId", "provider", "externalAccountId");

-- CreateIndex
CREATE INDEX "ErrorLog_createdAt_idx" ON "ErrorLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Post_connectionId_externalId_key" ON "Post"("connectionId", "externalId");

-- AddForeignKey
ALTER TABLE "Connection" ADD CONSTRAINT "Connection_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "Connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Same rule as every other table: RLS on, no policies, server-side access only.
ALTER TABLE "Connection" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ErrorLog" ENABLE ROW LEVEL SECURITY;

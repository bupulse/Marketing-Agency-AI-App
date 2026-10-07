-- "Edit in Canva": one linked Canva account per user (tokens encrypted with ENCRYPTION_KEY) and the
-- short-lived records that tie a Canva editing session back to the BuPulse design it came from.
CREATE TABLE "CanvaConnection" (
    "id" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "accessTokenEncrypted" TEXT NOT NULL,
    "refreshTokenEncrypted" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "canvaUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CanvaConnection_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CanvaConnection_userId_key" ON "CanvaConnection"("userId");
ALTER TABLE "CanvaConnection" ADD CONSTRAINT "CanvaConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CanvaConnection" ENABLE ROW LEVEL SECURITY;

CREATE TABLE "CanvaEdit" (
    "id" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "designId" TEXT NOT NULL,
    "canvaDesignId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CanvaEdit_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CanvaEdit_createdAt_idx" ON "CanvaEdit"("createdAt");
ALTER TABLE "CanvaEdit" ENABLE ROW LEVEL SECURITY;

-- Lead alerts beyond email (docs/RELEASE_2.0.md, "Lead alerts: push and WhatsApp"): phone and browser push
-- subscriptions (Web Push, lib/push), and the WhatsApp alert toggle and number on the widget's notification settings
-- (lib/leads/whatsapp.ts, offered only while the admin has the WhatsApp service on).

-- AlterTable
ALTER TABLE "ChatWidget" ADD COLUMN "notifyWhatsapp" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ChatWidget" ADD COLUMN "whatsappNumber" TEXT;

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "device" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSentAt" TIMESTAMP(3),

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PushSubscription_endpoint_check" CHECK ("endpoint" ~ '^https?://' AND length("endpoint") <= 1000)
);

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");
CREATE INDEX "PushSubscription_businessId_idx" ON "PushSubscription"("businessId");
CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");

-- AddForeignKey
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Server-only table: no access through the Supabase API.
ALTER TABLE "PushSubscription" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "PushSubscription" FROM PUBLIC, anon, authenticated, service_role;

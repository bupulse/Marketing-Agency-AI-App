-- Where and when the chat widget last loaded on a customer's website (for the "Check installation" button).
ALTER TABLE "ChatWidget" ADD COLUMN "lastSeenAt" TIMESTAMP(3);
ALTER TABLE "ChatWidget" ADD COLUMN "lastSeenHost" TEXT;

-- Missed posts move to the next day (lib/content-board/carry-over.ts): a post planned for a day that passed without
-- being posted belongs to the next day, up to 3 times; the 4th miss makes it EXPIRED, which never publishes, until the
-- owner taps "Use again". Additive: every existing post keeps its status, gets no planned day and a count of 0.
ALTER TYPE "PostStatus" ADD VALUE IF NOT EXISTS 'EXPIRED';
ALTER TABLE "Post" ADD COLUMN "plannedDay" DATE;
ALTER TABLE "Post" ADD COLUMN "carryCount" INTEGER NOT NULL DEFAULT 0;

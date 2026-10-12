-- Google Calendar sync state of a demo booking (docs/GOOGLE_CALENDAR.md): a change (create, move, cancel) that has not
-- reached the Google event yet is retried on the next booking request, by the hourly trial-reminders cron, and from
-- Admin -> Demos. Columns with defaults / nullable only: no rewrite. DemoBooking already has RLS on and no API grants.
ALTER TABLE "DemoBooking" ADD COLUMN "googleSyncPending" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "DemoBooking" ADD COLUMN "googleSyncError" TEXT;
ALTER TABLE "DemoBooking" ADD COLUMN "googleSyncAttemptAt" TIMESTAMP(3);

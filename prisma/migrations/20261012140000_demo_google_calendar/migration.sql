-- Google Calendar for demo bookings (docs/GOOGLE_CALENDAR.md): the event created in the owner's calendar and the Meet
-- link Google generated for it. Nullable columns only: no rewrite, existing bookings keep their .ics and meeting link.
-- The connection itself (encrypted refresh token, account email, calendar id) is one AdminSetting row
-- ("google.calendar"), a table that already has RLS on and no grants for anon, authenticated or service_role.
ALTER TABLE "DemoBooking" ADD COLUMN "googleEventId" TEXT;
ALTER TABLE "DemoBooking" ADD COLUMN "meetLink" TEXT;

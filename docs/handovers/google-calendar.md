# Handover: Google Calendar for demo bookings

Built 12 October 2026 on branch `v2-calendar` (worktree `~/BuPulse-v2-calendar`, from `v2`). What it does, Google Cloud setup and how it works: `docs/GOOGLE_CALENDAR.md`. Booking flow: `docs/REGIONS.md`, `docs/handovers/r1-regions-trial.md`.

## Migration

`20261012140000_demo_google_calendar`: `DemoBooking.googleEventId` and `DemoBooking.meetLink`, both nullable TEXT. No new table: the connection is an `AdminSetting` row (`google.calendar`), already under RLS with grants revoked. Not applied to any database from this worktree (`npx prisma generate` only). Deploy order: migration, then the code (the code reads the new columns on every booking).

## Env

`GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET` (Worker secrets; in `.env.example`). Redirect URI `${NEXT_PUBLIC_SITE_URL}/api/admin/google-calendar/callback`. Empty: the Settings panel shows the setup steps and everything works as before.

## Files

- New: `lib/google-calendar/oauth.ts`, `lib/google-calendar/calendar.ts`, `lib/google-calendar/events.ts`, `lib/demo/calendar-links.ts`, `app/api/admin/google-calendar/connect/route.ts`, `app/api/admin/google-calendar/callback/route.ts`.
- Changed: `lib/demo/bookings.ts` (Google busy times in `slotOptions`, event sync in `bookDemo` / `cancelDemo`, emails with Meet link + Google Calendar + .ics links), `lib/admin/demos.ts` (admin cancel deletes the event), `app/admin/(console)/settings/page.tsx` + `actions.ts` (Google Calendar panel: connect, calendar id, Test, Reconnect, Disconnect), `components/app/demo-lock.tsx` (Meet link, Add to Google Calendar, Add to Apple / Outlook), `prisma/schema.prisma`, `.env.example`.
- Tests: `tests/google-calendar/oauth.test.ts` (connect / callback routes, state + PKCE, scopes, encrypted token, audit, disconnect + revoke, calendar id), `tests/google-calendar/booking.test.ts` (free/busy subtraction with buffer, 2-minute cache, fallbacks on 500 / invalid_grant / timeout, own event ignored on reschedule, create / patch / delete bodies and `sendUpdates=all`, 404 → recreate, 409 → new UID, admin cancel), `tests/demo/calendar-links.test.ts`. Google is mocked at `fetch` (`tests/google-calendar/google-fake.ts`).

## Decisions

- **Connection in `AdminSetting`, not a new table.** One row, encrypted refresh token (`lib/crypto.ts`), no new RLS surface. Audits never carry a token (connect, disconnect, calendar change).
- **Scopes**: `calendar.events` + `calendar.freebusy` + `openid email` (only to show which account is connected). Both calendar scopes are required at the callback; a partial grant is refused with a message.
- **Client 360 link not in the event description.** The description is shared with the client (attendee), and the console's address is never shown to clients elsewhere, so the link sits in the event's private extended properties. The admin booking email still has the company link. If the owner wants it clickable in the event anyway, add it to `demoEventDescription` in `lib/google-calendar/events.ts`.
- **One UID for the Google event and the `.ics`** (`<booking id>@bupulse.com`, set as `iCalUID` on insert) so the client's calendar keeps one event; if Google refuses the UID (409, an older deleted event), the event is made without it.
- **Reschedule keeps the Meet link** (the event is patched, its conference stays). A booking made while Google failed gets an event on its next reschedule.
- **Busy-time cache** is per isolate (2 minutes); every event change clears it in that isolate. Another isolate may show a slot that was just taken in Google for up to 2 minutes; the booking check uses the same cached list, and the database indexes still stop double bookings between clients.
- Google calls have a 10-second timeout; the booking action can take up to that much longer when Google hangs, then falls back.
- Not added to the admin service catalog / kill switches (Disconnect is the switch).

## Open items

- Owner: steps 1–5 and 7 of `docs/GOOGLE_CALENDAR.md` (project `bupulse-511410`, Internal consent screen, web client, Worker secrets, Connect).
- The Google event has no "booked through BuPulse" link back for the client other than the dashboard URL in the description.
- Not tested against the live Google API from here (no credentials); the request shapes follow Google's Calendar v3 reference.

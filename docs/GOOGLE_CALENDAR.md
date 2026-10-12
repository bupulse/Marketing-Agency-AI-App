# Google Calendar for demo bookings

When the owner connects a Google Calendar (Admin → Settings → Google Calendar):

- **Slots**: busy times in that calendar are taken out of the slots clients see on `/book-demo`, on top of the weekly availability, blocked dates and other bookings (the same buffer applies). Busy times are read with a free/busy query for the next 15 days and cached for 2 minutes per Worker isolate. If Google fails, slots come from availability alone and the failure is logged (`ErrorLog`, source `google-calendar.freebusy`).
- **Booking**: each booking becomes an event in that calendar: "BuPulse demo — <company>", Africa/Kigali, the client as attendee, a Google Meet link generated for it, reminders (email a day before, pop-up 15 minutes before, for the calendar owner), and `sendUpdates=all`, so Google emails the client its own invite. The Meet link is stored on the booking (`DemoBooking.meetLink`, also `meetingLink`) and used in the emails, the `.ics` and the dashboard.
- **Reschedule** patches the same event (Google sends the update); **cancel** (client, or admin in Demos) deletes it with `sendUpdates=all`.
- **Fallback**: without a connection, or when a Google call fails or times out (10 s), the booking goes through as before: the reusable meeting link from Settings and the `.ics` invite. Nothing in the booking waits on Google succeeding.

Clients always get, on the dashboard lock screen and in the emails: the meeting link, **Add to Google Calendar** (Google's template link, no connection needed) and **Add to Apple / Outlook (.ics)**. The `.ics` and the Google event share one UID (`<booking id>@bupulse.com`), so a calendar that gets both keeps one event.

## Setup (once)

1. **Google Cloud project** `bupulse-511410` (console.cloud.google.com, signed in with a bupulse.com Workspace admin).
2. **APIs & Services → Library → Google Calendar API → Enable.**
3. **OAuth consent screen** (Google Auth Platform → Branding / Audience): user type **Internal** (only bupulse.com Workspace accounts can connect; no Google verification needed). App name "BuPulse", support email hello@bupulse.com.
   Data access: add the scopes `.../auth/calendar.events`, `.../auth/calendar.freebusy`, `openid`, `.../auth/userinfo.email`.
4. **Clients → Create client → Web application**, name "BuPulse admin calendar".
   Authorized redirect URI: `https://<NEXT_PUBLIC_SITE_URL>/api/admin/google-calendar/callback` (exact, no trailing slash; add `http://localhost:3000/api/admin/google-calendar/callback` too for local work). No JavaScript origins needed.
5. Copy the client id and secret into the Worker's secrets (and `.env` locally):
   ```
   npx wrangler secret put GOOGLE_CALENDAR_CLIENT_ID
   npx wrangler secret put GOOGLE_CALENDAR_CLIENT_SECRET
   ```
   `ENCRYPTION_KEY` must already be set (it encrypts the refresh token, `lib/crypto.ts`).
6. Run the migration `20261012140000_demo_google_calendar` (two nullable columns on `DemoBooking`), deploy.
7. Admin → Settings → Google Calendar → **Connect Google Calendar**. Sign in with the account whose calendar you take demos in and allow both calendar permissions. Then **Test**: it reads the busy times of the next 14 days and says how many it found.

Until steps 1–5 are done the panel shows these steps and bookings use the meeting link + `.ics` flow.

## How it works

- `lib/google-calendar/oauth.ts`: authorize URL (PKCE S256, `access_type=offline`, `prompt=consent`), the sealed state cookie (`bp_gcal_oauth`, AES-GCM, tied to the admin, 10 minutes, path `/api/admin/google-calendar`), code exchange (both calendar scopes required: Google lets people untick them), refresh, revoke.
- `app/api/admin/google-calendar/connect` and `/callback`: both run `requireAdmin()` (allow-listed email + AAL2). The callback saves the connection, audited as `connect_google_calendar` (account email, calendar id, scopes; never a token).
- `lib/google-calendar/calendar.ts`: the connection is one `AdminSetting` row, key `google.calendar`: `{ refreshToken: <lib/crypto.ts payload>, email, calendarId, scopes, connectedAt, lastError, lastErrorAt }`. `AdminSetting` has RLS on and no grants for anon / authenticated / service_role. Access tokens are kept in memory only. Disconnect revokes the refresh token at Google, deletes the row, audited as `disconnect_google_calendar`. A calendar change is audited as `update_setting`. The last Google failure (revoked login, 401/403) is kept on the row and shown in Settings until a Test succeeds.
- `lib/google-calendar/events.ts`: the event body and `syncDemoEvent()` (create / patch / delete; a patch on an event deleted in Google creates a new one; a UID Google already knows retries without it). Returns null on any failure, which keeps the fallback.
- `lib/demo/bookings.ts`: `slotOptions()` adds the busy times (leaving out the rescheduled booking's own event), `bookDemo()` / `cancelDemo()` call `syncDemoEvent()` after the database write; `lib/admin/demos.ts` `setDemoStatus("cancelled")` deletes the event.
- `lib/demo/calendar-links.ts`: the "Add to Google Calendar" template link.

## Notes

- The event description is visible to the client (an attendee): plan, contact, phone, industry, country, website, a short "about", and the dashboard link. The Client 360 link (`/admin/companies/<id>`) is kept in the event's **private** extended properties, not in the description, so the admin console address never reaches a client; the admin booking email has the company link.
- Google sends its own invite and the BuPulse email still goes out with the `.ics`; both carry the same UID and Meet link.
- Events already in Google stay there after a disconnect; later reschedules and cancels of those bookings no longer touch them.
- The scopes are `calendar.events` (no access to other calendar settings) and `calendar.freebusy` (busy times only, no event details).

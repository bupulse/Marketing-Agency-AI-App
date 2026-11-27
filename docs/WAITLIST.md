# Pre-launch waiting list

Owner's decisions of 27 Nov 2026: BuPulse takes two weeks to prepare for clients and opens on **15 December 2026**.
Until then bupulse.com runs a waiting list.

## What it does while it is on

- **Banner** above the menu on every public page (`components/marketing/waitlist.tsx`): "🎄 This Christmas, your
  business gets its own AI marketing team. Launching 15 Dec." with a live countdown (days, hours, minutes, seconds)
  and a "Reserve your spot" button that opens the pop-up form.
- **Main button** in the header and the home hero (`components/marketing/waitlist-label.tsx`): swaps between the
  countdown and "Get started" every 4 seconds; hover or keyboard focus shows "Get a free quote". It opens the same
  pop-up. Other buttons keep "Get a free quote".
- **Every visitor, any country**, gets the quote pop-up, titled "Reserve your spot" (`lib/quote/cta-server.ts`). The
  form is the quote form (name, phone, email, business, optional note). Requests are stored as quotes (Admin → Quotes)
  with the usual Telegram alert, and each person gets the thank-you email (`lib/waitlist-email.ts`, English, from the
  usual sender, replies to hello@bupulse.com).
- **No new accounts**: /signup shows the waiting-list form; the sign-up action refuses; a Google sign-in by someone
  without an account signs them out and shows the list (`lib/auth/after-google.ts`). Existing users log in as usual.
- **No self-started trials**: /start-trial says the trial starts on launch day; the action refuses. Admins can still
  add companies and start trials from Admin.

## Switching it

Admin → Settings → Waiting list and free trial (`/admin/settings/trial#waitlist`): the on/off switch and the launch day
(00:00 Kigali time). Settings `site.waitlistOn` (default off) and `site.waitlistLaunchDate` (default 2026-12-15).
Reaching the day does **not** switch it off: the banner says BuPulse is launching and the list stays until the owner
switches it off, so sign-ups never open by surprise while something (for example the AI credit) is not ready.

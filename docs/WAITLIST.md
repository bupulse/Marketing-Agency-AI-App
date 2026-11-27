# Pre-launch waiting list

Owner's decisions of 27 Nov 2026: BuPulse takes two weeks to prepare for clients and opens on **15 December 2026**.
Until then bupulse.com runs a waiting list.

## The site banner (separate setting)

Admin → Settings → Site banner (`/admin/settings/banner`, `lib/site-banner.ts`, one AdminSetting `site.banner`): an
announcement above the menu on every public page that stays in view while scrolling. The owner edits, with a live
preview: the message (computer and phone), font (site, bold, elegant, handwritten, mono; the Google ones load only when
chosen), colour (BuPulse blue, red, orange, black, green, gold, own colour), decoration (🎄 + two 🎁, 🚀 + ✨, none),
animation (none, slide in, shimmer, glow, scrolling text), an optional countdown (Kigali time) and what happens at zero
(another message, keep, hide), show-from / hide-after dates, the banner's button (quote form, link, none) and the
site's main button (unchanged, count down, glow; and whether it wears the banner's colour, BuPulse blue on hover).
Default: the gold Christmas banner counting down to 15 Dec, off until switched on.

The main button's countdown (`components/marketing/waitlist-label.tsx`) swaps the countdown and "Get started" every
4 seconds; hover or keyboard focus shows "Get a free quote" (or "Start your free trial" where the trial is offered).

## What the waiting list does while it is on
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

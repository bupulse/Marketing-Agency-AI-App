# BuPulse and the Video Studio: who does what

Owner decisions, 19 October 2026. These replace the "move the studio into the app" direction of
`docs/VIDEO_APP_INTEGRATION.md` for everything about where video is **made**; the engine, credits, jobs and scheduling
work described there stays.

## The decisions

- The full Video Studio is its own site at **studio.bupulse.com**, opened from BuPulse in a new tab.
- Clients sign in to it with **one click from BuPulse** (their BuPulse account; their products and photos are already
  there).
- Every video the studio finishes appears **automatically** in BuPulse's Videos library, ready to schedule.
- BuPulse keeps:
  - the **Videos library**: studio and slideshow videos, with play, download, schedule and delete;
  - the **"Open Video Studio ↗"** button, in the sidebar and on the Videos page;
  - **video credits**: the balance in Usage and Billing, and MoMo top-ups;
  - **"Your video is ready" notices**: a bell notice and an email;
  - Autopilot posting library videos.
- The Create page now in BuPulse (`/dashboard/video`, `components/video-studio/create-studio.tsx`) **moves to the
  studio**. BuPulse's `/dashboard/video` becomes the library.
- Access: plans with video credits (Trial, Starter, Standard, Business, Pro). Other clients see the button with
  "Upgrade to use".
- The daily slideshow videos (`lib/visuals`, Autopilot) stay in BuPulse and show in the same library.
- Target: ready for the Rwanda launch. The studio may open before the Seedance key arrives.

## The contract between the two sites

Both sites use the same Supabase database and Storage, and the same code in `lib/`.

1. **Address.** `STUDIO_URL` (default `https://studio.bupulse.com`), in Admin → Services ("Video Studio"). BuPulse hides
   the button while the service is off.
2. **One-click sign-in (a ticket).**
   - BuPulse: the button opens `/dashboard/video/open` in a new tab. That route checks the session, the `videoStudio`
     feature, the `content` permission and that the plan has video credits. It then writes a `StudioTicket`
     (`lib/video-studio/ticket.ts`: random token, only its SHA-256 hash stored, user, business, 2 minutes, one use)
     and redirects to `${STUDIO_URL}/auth/bupulse?ticket=<token>&next=<path>`.
   - Studio: `/auth/bupulse` calls `redeemStudioTicket(token)` from the same file. It is a conditional update (unused,
     not expired), so a ticket works once. The studio then sets its own session cookie for that user and business and
     redirects to `next` (studio paths only).
   - The studio never asks for a password. With no session it sends the client to
     `https://bupulse.com/dashboard/video/open?next=<path>`.
3. **Videos.** The studio saves every finished MP4 as it does today: a `MediaAsset` in the Gallery's "Video Studio"
   folder, and the `VideoJob` turns "ready" with `videoPath`, `posterPath`, `bytes` and `durationMs`. BuPulse's library
   reads `VideoJob` and slideshow `ContentVisual` rows. Nothing else is needed for "automatically".
4. **Ready notices.** BuPulse's `/api/cron/video-jobs` sweep finds ready jobs with `readyNoticeAt` null, sends the bell
   notice and the email ("Your video is ready", a "View video" button to `/dashboard/video?v=<id>`) and sets
   `readyNoticeAt`, once. The studio does nothing for this.
5. **Credits.** The studio spends `videoCredits` through `lib/usage.ts`, as `/api/video/design` does now. BuPulse shows
   the balance and sells the `block:videoCredits` top-up. The studio's "Buy credits" links to
   `https://bupulse.com/dashboard/billing`.

## Who owns which files

| Side | Owner | Files |
| --- | --- | --- |
| BuPulse | main session (branch `videos-library`, `/Users/macbook1/BuPulse-library`) | `app/dashboard/video/**`, `components/video-library/**`, `lib/video-studio/ticket.ts`, `lib/video-studio/notices.ts`, the sidebar entry, the Video Studio service entry, the migration `20261024100000_studio_tickets` (`StudioTicket`, `VideoJob.readyNoticeAt`) |
| Studio | video-engine agent (branch `video-engine`, `/Users/macbook1/BuPulse-video`) | `video-lab/**` (the studio site), `/auth/bupulse` on the studio, moving the Create UI into the studio, getting the studio ready to deploy at studio.bupulse.com |

- The video-engine agent stops editing `app/dashboard/video/**`; that page becomes the library.
- The agent's next migration is named after `20261024100000_studio_tickets`.
- `lib/video-engine/**` and `lib/video-studio/{brief,jobs,library,schedule,voice}.ts` stay with the video-engine agent.
  The library may import them but not change them; changes needed there go in a note to the agent.

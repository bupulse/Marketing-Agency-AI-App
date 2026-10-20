# BuPulse on the phone, and Share to WhatsApp

Most shop owners in Rwanda use BuPulse on their phone, and sell on WhatsApp. Two things make that easy:

- **BuPulse installs like an app.** It gets its own icon on the Home Screen and opens full screen, without the browser
  bar. Nothing to download from a store, and it updates itself.
- **Share to WhatsApp, in one tap.** No tool can post to WhatsApp Status for you (WhatsApp does not allow it). So every
  post and every video has a **Share to WhatsApp** button: the phone's share menu opens with the picture or video and
  its caption, and the owner chooses **My status**, a customer or a group.

**Where:** the install tip is at the top of the dashboard on a phone. **Share to WhatsApp** is on every post card in
Content, in a post's details (Content and Calendar), on Autopilot's upcoming posts, and on every video in **Videos**.

## Install BuPulse on a phone

### Android (Chrome)

1. Open BuPulse in Chrome and sign in.
2. At the top of the dashboard: **Install BuPulse on your phone** → **Install**, then **Install** again in Chrome's box.
3. The BuPulse icon is now on the Home Screen. Open BuPulse from there from now on.

If the tip is gone (it was hidden with ✕, or BuPulse is already installed): Chrome's menu **⋮** → **Install app** (or
**Add to Home screen**).

### iPhone (Safari)

1. Open BuPulse in Safari and sign in.
2. Tap **Share** (the square with an arrow, at the bottom of Safari; at the top right in Chrome).
3. Choose **Add to Home Screen** (scroll down the list if it is not there), then **Add**.

The tip at the top of the dashboard shows these two steps. On an iPhone, installing is also what makes **lead alerts**
possible (Leads → **Alerts on this device**): Apple only sends alerts to apps on the Home Screen.

### What it does and does not do

- The tip shows only on phones and tablets, never in the installed app, and never again on that phone once ✕ is
  tapped.
- BuPulse needs the internet as before: **nothing private is kept on the phone** for offline use, so a lost phone does
  not carry the company's posts or leads. Signing out works as usual.

## Share a post or a video to WhatsApp

### On a phone

1. Find the post (Content, Calendar or Autopilot) or the video (**Videos**).
2. Tap **Share to WhatsApp**. The phone's share menu opens with the picture (all pictures of a carousel) or the video,
   and the caption.
3. Choose **WhatsApp**, then **My status** to put it on the Status, or a customer or a group to send it. Send.

The caption is **also copied**. Some phones (often iPhones) send the picture without the text: then tap the caption
box in WhatsApp and **Paste**.

A big video can take a few seconds to get ready. If the share menu does not open, the button changes to **Share now**:
tap it once more.

### On a computer

**Share to WhatsApp** downloads the picture or video and opens WhatsApp (WhatsApp Web or the app) with the caption
written in. A note says **Download done. Add the picture in WhatsApp.** with an **Open WhatsApp** link, in case the
browser blocked the new tab. In WhatsApp, attach the downloaded file and send.

### What the caption contains

The post's words for every app, made fit for WhatsApp:

- the **title** (when the post has one) and the **text, word for word**: the price, phone number, place, delivery and
  payment lines stay exactly as written;
- **no hashtags** (they do nothing on WhatsApp): a line of hashtags is left out, and `#Kigali` inside a sentence becomes
  `Kigali`;
- no "link in bio" sentences (there is no bio on WhatsApp); the post's **link** is added at the end instead;
- for a video post, its **caption**, not the video script.

The post itself is not changed, and sharing does not mark it as posted.

## Rules

| Rule | |
| --- | --- |
| Who can share | Everyone who can see the post or the video (any role) |
| Files | The pictures and videos come from the private links the page already has; nothing is made public |
| Files per share | Up to 10 (a carousel) |
| Counting | Each share is counted for the owner's analytics (product event `whatsapp_share`), at most 200 an hour per company |
| Plan | Free on every plan; it uses no credits |
| Install | Free; works with Chrome on Android and Safari on iPhone (iOS 16.4 and later for alerts) |

## For developers

| | |
| --- | --- |
| Manifest | `public/manifest.webmanifest` (start `/dashboard`, standalone, icons 192, 512 and maskable 512), linked by `metadata.manifest` in `app/dashboard/layout.tsx`, which also sets `appleWebApp` |
| Icons | `public/icons/` (`icon-192.png`, `icon-512.png`, `maskable-512.png`, `apple-touch-icon.png`), made from `public/brand/icon.png` by `node scripts/make-app-icons.mjs` (sharp, local). The iPhone icon is linked in `app/layout.tsx` (`icons.apple`) |
| Service worker | `public/sw.js` (push alerts only: no `fetch` handler, no cache), registered for every signed-in person by `PhoneAppSetup` in `components/app/phone-app.tsx`; `components/leads/push-toggle.tsx` uses the same `registerServiceWorker` |
| Install prompt | `InstallPrompt` in `components/app/phone-app.tsx`, shown by `app/dashboard/layout.tsx`. An inline script keeps Chrome's `beforeinstallprompt` (it can come before React). Dismissal: localStorage `bp-install-dismissed`. Pure rules: `lib/phone-app.ts` (`installPlatform`, `isStandalone`) |
| Share button | `components/share/whatsapp-share.tsx` (`WhatsAppShare`): Web Share API with files on phones (`navigator.canShare({ files })`), else download + `https://wa.me/?text=…`. Used in `components/content-board/post-card.tsx`, `components/publishing/post-detail.tsx`, `components/autopilot/plan-board.tsx`, `components/video-library/video-library.tsx` |
| Caption and files | `lib/share/whatsapp.ts`: `whatsappCaption`, `postShareCaption`, `whatsappTextLink`, `shareFileName`, `shareFileType` |
| Counting | `app/dashboard/share-actions.ts` `recordWhatsAppShare` → `trackEvent("whatsapp_share", { what, how })`; `RATE_LIMITS.whatsappShare`; daily `feature_use` in `lib/analytics/rollup.ts`. No new table |
| Tests | `tests/phone-app/phone-app.test.ts` (platforms, standalone, manifest icons present, no offline cache), `tests/share/whatsapp.test.ts` (caption keeps price, phone and place; hashtags and "link in bio" out; script posts; file names and types) |

## If something goes wrong

| Symptom | Where to look | Usual fix |
| --- | --- | --- |
| No install tip on Android | Already installed, tip hidden with ✕, or not Chrome | Chrome menu ⋮ → **Install app** |
| No install tip on iPhone | Opened from the Home Screen already, or tip hidden | Share → **Add to Home Screen** by hand |
| The installed icon is old | The phone keeps the icon from install time | Remove BuPulse from the Home Screen and add it again |
| "We could not get the picture. Reload the page and try again." | The page's private links last one hour | Reload the page, then share |
| WhatsApp is not in the share menu | WhatsApp not installed on that phone, or the browser cannot share files | Use another browser (Chrome or Safari), or a computer (download + link) |
| The caption is missing in WhatsApp | The phone sent the picture only | Paste: the caption was copied |
| Shares do not show in analytics | The server log: `[share] could not count a WhatsApp share` | Counting never blocks a share; check the database connection |

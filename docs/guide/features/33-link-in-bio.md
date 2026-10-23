# Link in bio

Instagram and TikTok sellers write "price in bio" or "DM for price", and customers give up. **Link in bio** gives every
client a free, fast page to put in their Instagram or TikTok bio instead: their logo and name, a big **WhatsApp**
button, a call button, where to find them (with a landmark and a map link), their opening hours, and the products they
pick, each with its photo, its price in RWF and an **Ask on WhatsApp** button. The page counts its visits and the taps on
WhatsApp and Call, so the owner can see how many messages their bio brought.

**Where:** Dashboard → **Link in bio** (`/dashboard/bio`). The public page is `bupulse.com/b/<address>`.
**Who:** every plan, the free trial included. The Owner and Admin roles can change it (permission *settings*).

**It is off until you switch it on.** Nothing about your business is public until you switch the page on and save, and
it only shows the numbers, place, links and products you pick.

## Set it up

1. Fill in your business first: **Business info → Locations, hours & contacts** (your WhatsApp number, your address,
   your opening hours, your Instagram or TikTok) and **Business info → Products** (name, price and at least one
   photo in each product's album). The page is built from these; you never type them twice.
2. Open **Link in bio**. BuPulse suggests an address from your business name, for example `bupulse.com/b/kigali-shoes`.
   Change it if you like: 3 to 30 small letters, numbers and dashes. Some words are kept for BuPulse (`admin`,
   `support`, `bupulse`...). If another business has it, you are asked to pick another.
3. **Line under your name**: one short sentence ("Shoes and bags in Kimironko, delivery in Kigali"). Leave it empty
   to use the tagline of your Company profile.
4. **Buttons**: pick the number for the **WhatsApp button** and, if you want, the **Call button**. The **first
   message** is what your customer's WhatsApp starts with. Leave it empty and it says "Hello, I saw your page on
   Instagram." (or TikTok or Facebook, from the app the visitor came from), so you know where they found you.
5. **Where and when**: pick the location to show and add a **landmark** ("Opposite the bus park, next to the MTN
   shop"): people in Kigali find places by landmarks. Tick **Show my opening hours** to show them with "We're open now
   until 18:00" or "We're closed now".
6. **Products and prices**: add up to 12 products or services and put them in order with the arrows. Each one shows
   its first album photo, its price and an **Ask on WhatsApp** button that starts the message with the product's name.
7. **Links**: tick your website, Instagram, TikTok or Facebook to show them at the bottom.
8. Switch the page **On** and **Save**. The **Live preview** on the right (below on a phone) shows the page as you
   edit, before you save.
9. **Copy link** and paste it in your Instagram bio (Edit profile → Links) or your TikTok bio (Edit profile →
   Website). You can also send the link on WhatsApp: the preview shows your logo, name and line.

Changed a product's photo or your logo? **Save** the Link in bio page again to put the new picture on it.

## What your customers see

A light page made for phones that opens fast on a slow connection (about 8 KB of page and 5 to 20 KB per photo). Taps
on **Chat on WhatsApp** or **Ask on WhatsApp** open a WhatsApp chat with you; **Call** opens the phone's dialler;
**Open in Google Maps** opens the map. At the bottom: "Made with BuPulse".

A page that is switched off, or whose account is read-only (trial not started, trial over, payment failed, plan
ended), says only "This page is not available." It never says whose page it was.

## What your page brought

The **What your page brought** card counts, for the last 7 and 30 days: **visits**, **WhatsApp taps** (each one opens
a chat with you) and **calls**, with a table of the last 7 days. The preview on your settings screen is never counted.
Robots, link previews and someone tapping again and again (more than 3 visits or 10 taps an hour from one phone) are
not counted.

## Rules

| Rule | |
| --- | --- |
| Plans | Every plan and the trial (no plan feature; like the Knowledge base it is built from) |
| Who can change it | Owner and Admin (`settings` permission); Members cannot open the page |
| Off by default | A new page is off; nothing is public until the owner switches it on and saves |
| What is shown | Only the WhatsApp number, phone number, location, links and products the owner picks; a number, place or product removed from the Knowledge base disappears from the page |
| Address | 3 to 30 small letters, numbers and dashes, unique, with a list of kept words (`lib/bio/slug.ts`) |
| Products | Up to 12, active ones only (a draft or archived product drops off the page) |
| Photos | Small copies (480 px square, logo 320 px) made on save; the gallery files stay private |
| Read-only account | The page goes offline and cannot be changed until the account is active again |
| Saves | 60 an hour per company (`RATE_LIMITS.bioSave`) |
| Deleting the account | The page, its products, its counts and its photo copies are deleted with it |

## For developers

| | |
| --- | --- |
| Public page | `app/b/[slug]/route.ts`: plain HTML from `lib/bio/page.ts` `renderBioPage` (inline CSS with a nonce, CSP `bioPageCsp`, no framework JS), `Cache-Control: private, no-cache` (the greeting follows the user agent). 404 page `bioUnavailablePage` for unknown and offline pages alike |
| Photos | `app/b/[slug]/photo/[file]/route.ts`: streams a copy from the private `media` bucket only when it is the logo or an item photo of a live page (`bioPhotoPath`), `public, max-age=86400` (random file names) |
| Counting | `public/bio.js` sends `navigator.sendBeacon` to `app/b/[slug]/hit/route.ts` ("view", "wa", "call"): own origin only, `isBot`, rate limit per hashed IP and page (`visitorHash` with the daily salt), then `countBioHit`, one `INSERT ... ON CONFLICT` on `BioPageDay` |
| What is shown | `lib/bio/source.ts` `bioSource` (Knowledge base → formatted choices), `lib/bio/view.ts` `buildBioView` (choices → page; pure, also run by the live preview), `validateBioSettings`, `platformOf`, `defaultMessage` |
| Service | `lib/bio/service.ts`: `loadPublicBio`, `liveBioBusinessId`, `bioPhotoPath`, `loadBioEditor`, `saveBioPage` (checks the numbers, place and products are the company's, makes copies with `smallJpeg` from `lib/publishing/jpeg.ts`, removes unused ones), `fillDays` |
| Settings page | `app/dashboard/bio/page.tsx`, `app/dashboard/bio/actions.ts` `saveBioSettings`, `components/bio/bio-settings.tsx` (preview in a sandboxed `srcdoc` iframe), menu item in `components/app/nav.ts` |
| Proxy | `proxy.ts` skips `/b/` and `/bio.js`: no session work for visitors |
| Storage | Copies in `media/<userId>/bio/<uuid>.jpg`; `lib/media/storage-sweep.ts` keeps the ones a page uses and removes the rest after an hour |
| Tables | `BioPage` (one per company: `enabled`, unique `slug` with a CHECK on its shape, the choices, `logoPath`/`logoSource`), `BioPageItem` (product, `position`, `photoPath`/`photoSource`), `BioPageDay` (company, UTC day, `views`, `whatsapp`, `calls`). Migration `20261026100000_link_in_bio_and_testimonials`: RLS on, grants revoked |
| Tests | `tests/bio/view.test.ts` (addresses, what is shown, greeting, HTML escaping), `tests/bio/service.test.ts` (saving and copies, live rules, the page and hit routes), `tests/bio/small-jpeg.test.ts`, `tests/bio/storage-sweep.test.ts` |

**Deploy:** run the migration first; no new environment variable. A QR code is not built in (no QR library in the
project and no outside service); owners can make one from the copied link with their phone's camera app or any QR maker.

## If something goes wrong

| Symptom | Where to look | Usual fix |
| --- | --- | --- |
| "This page is not available." | Is the page switched on and saved? Is the account read-only (Billing)? Suspended? | Switch it on and save; settle the account |
| No WhatsApp button | No WhatsApp number in Business info, or "No WhatsApp button" picked | Add the number in Locations, hours & contacts, pick it, save |
| A product has a letter instead of a photo | The product's album has no photo, or the copy failed ("We could not use the photo of ...") | Add a JPG, PNG or WebP photo under 4096 px to the album, save again; Admin → Errors `bio.copy` |
| Old photo or logo on the page | Copies are made on save | Save the Link in bio page again |
| "Another business already uses that address" | The address is taken | Pick another |
| Counts stay at 0 | The visitor's browser blocked the script, or the visits came from robots | Open the page from a phone; Admin → Errors `bio.hit` |

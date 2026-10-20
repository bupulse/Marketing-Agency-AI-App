# Testimonials on the website

Real words from real BuPulse clients, shown on the home page and the pricing page. The fake testimonials were removed
before launch: nothing is shown until you add one with the client's agreement and publish it. With none published, the
section is simply not there (no heading, no empty space).

**Where:** **Admin → Content → Testimonials** (`/admin/testimonials`). **Who in Admin:** staff with *Content* (the
same as Announcements and the music library). **Shown on:** the home page (after "Up and running in three steps",
before the questions) and the pricing page (before "Pricing questions").

BuPulse never contacts a client about a testimonial. You ask them yourself, on WhatsApp or by phone.

## The rules

| Rule | |
| --- | --- |
| Consent | A testimonial can be published only when **The client agreed to be shown** is ticked. Without it, saving with "Published" ticked is refused: "Tick “The client agreed to be shown” before publishing. Only publish words the client agreed to." The database refuses it too. |
| Their words | Exactly as the client said or wrote them, 20 to 400 characters. You may shorten, never add. |
| Result | Optional, up to 120 characters, highlighted at the top of the card. Only a number the client confirmed ("12 orders on WhatsApp in a week"). |
| Name and business | Required, up to 80 characters each. Use the name the client agreed to (for example "Aline M."). Sector is optional (up to 60). |
| Photo | Optional. The browser crops it to the centre square and makes it small (160 × 160) before it is sent. The server takes only a real JPEG of at most 60 KB and 400 pixels a side. |
| Order | The list order is the order on the site. **Up** and **Down** move one place. |
| Delay | The website keeps the list for up to a minute, so a change can take a minute to show for every visitor. |
| Audit | Every add, edit, publish, hide, move and delete is in Admin → Audit log (`create_testimonial`, `update_testimonial`, `publish_testimonial`, `unpublish_testimonial`, `move_testimonial`, `delete_testimonial`). The photo itself is not copied there, only whether there is one. |

## For the owner: step by step

1. **Ask the client.** On WhatsApp: what they would say about BuPulse, whether you may show it on the website with
   their name and business, and (if you want one) a photo. Keep their message saying yes.
2. Admin → Content → **Testimonials** → **Add a testimonial**. Fill in their name, the business, the sector if you
   like, their words and, if they gave you one, a real result.
3. **Photo (optional):** **Choose a photo**. You see it round, as on the site. **Don't use this photo** takes it off
   before saving.
4. Tick **The client agreed to be shown**. Tick **Published** to show it straight away, or leave it unticked to keep it
   hidden for now.
5. **Add testimonial.** It goes to the end of the list.
6. In the list, each one shows **Published**, **Hidden** or **No consent**. Use **Publish** / **Hide**, **Up** /
   **Down**, **Edit** and **Delete** (asks first; it cannot be undone). **Publish** shows only on one with consent.
7. **Edit** opens it on its own page: change the words, the consent, the publishing, or the photo (**Change photo**, or
   tick **Remove photo**). **Save testimonial** takes you back to the list.
8. **If a client changes their mind:** **Hide** it, or **Delete** it, the same day. It leaves the site within a minute.

## What visitors see

- With at least one published: a section **Business owners like you**, one card per testimonial in your order (one
  column on a phone, two or three on a computer). Each card: the result highlighted (when set), their words in quotes,
  then the small round photo (when set), the name, and the business with the sector.
- With none published (or if the database cannot be reached): no section at all. The rest of the page is unchanged.

## For developers

| | |
| --- | --- |
| Rules (pure, client-safe) | `lib/testimonials/shared.ts`: `LIMITS`, `PHOTO_SIDE` (160), `PHOTO_MAX_BYTES` (60 KB), `PHOTO_MAX_PIXELS` (400), `testimonialInputSchema` (zod), `validateTestimonial`, `NO_CONSENT`, `testimonialState`, `STATE_BADGE` |
| Service | `lib/testimonials/service.ts`: `checkPhoto` (JPEG check with `sniffImage` and `imageSize` from `lib/publishing/jpeg.ts`), `createTestimonial`, `updateTestimonial`, `setTestimonialPublished`, `moveTestimonial`, `deleteTestimonial` (each audited with `writeAudit` in the same transaction), `listTestimonialsAdmin`, `getTestimonialAdmin`, `publishedTestimonials` (published and consented only, cached 60 s in memory, `[]` on a database error after `logError`), `clearTestimonialCache` |
| Admin | `app/admin/(console)/(content)/testimonials/page.tsx`, `[id]/page.tsx` (edit), `actions.ts` (`adminAction("content")` in every action); form `components/admin/testimonial-form.tsx` (client: makes the 160 × 160 JPEG with a canvas and sends it as base64, well under the 1 MB server action limit); menu entry in `components/admin/nav.ts` |
| Site | `components/marketing/home/testimonials.tsx` (server component, `null` with none), used in `app/(marketing)/page.tsx` and `app/(marketing)/pricing/page.tsx` (both rendered per request) |
| Table | `SiteTestimonial` (`photo` bytes, `consent`, `published`, `position`, `createdBy`). Migration `20261026100000_link_in_bio_and_testimonials`: a CHECK (`NOT published OR consent`), RLS on, all grants revoked from the Data API roles |
| Tests | `tests/testimonials/testimonials.test.ts` (rules, photo check, audit rows, the public read and its cache, the empty section); `tests/security/rls-coverage.test.ts` covers the table |

**Deploy:** run the migration before the code (`npx prisma migrate deploy`). Until it has run, Admin → Testimonials
cannot load, and the home and pricing pages just show no testimonials (the read logs the error and returns nothing).

## If something goes wrong

| Symptom | Where to look | Usual fix |
| --- | --- | --- |
| No testimonials on the site | Is at least one **Published** (not Hidden, not No consent)? | Publish one. Wait up to a minute |
| A change does not show on the site yet | The site keeps the list for up to a minute | Wait a minute and reload |
| "Tick “The client agreed to be shown” before publishing…" | The consent box is not ticked | Ask the client; tick it only once they said yes |
| No **Publish** button on a row | It shows **No consent** | **Edit**, tick the consent box (once the client agreed), save |
| "This photo could not be read. Choose a JPEG or PNG photo." | The browser cannot open that file (some iPhone HEIC photos outside Safari) | Take a screenshot of the photo, or save it as JPEG, and choose that |
| "The photo is too large…" or "must be a JPEG picture" | The photo did not go through the browser's resizing | Choose it again in the form |
| The section disappeared from the site | Admin → Errors, source `testimonials.published` (the database could not be read) | Fix the database connection; the section comes back by itself |

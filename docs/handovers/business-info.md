# Handover: structured business info (hours, locations, contacts)

Built 12 October 2026 on branch `v2-knowledge` (worktree `~/BuPulse-v2-knowledge`, from `v2`). What it does and
how it works: `docs/BUSINESS_INFO.md`. Not pushed, not merged.

## Migration

None. Everything lives in `Business.knowledge` (JSON) as new optional keys `openingHours`, `locations`, `contacts`.
Old rows keep working unchanged; `hours` and `contact` free text remain and are read as notes. Deploy order does not
matter.

## Configuration

- New optional server secret `GOOGLE_MAPS_API_KEY` (Places API (New) only; how to create it is in
  `docs/BUSINESS_INFO.md`). Added to `.env.example` and `docs/DEPLOY.md`. Without it the address boxes are plain
  text inputs and nothing calls Google.
- No new dependencies.

## Decisions

- **JSON, not columns.** The data is read whole by the chat and the Brand card and never queried by field; a column
  would add a migration for no gain.
- **Free text kept as notes.** `hours` is now "Note on hours" (public holidays etc.); `contact` only shows in the
  form when an older company still has text that could not be turned into contacts. The form converts readable
  text when it opens; the database changes only on save. "Area you serve" stays free text next to the locations.
- **Head office first.** The first location row is always the head office; branches can only be added once its
  address is filled, and the server refuses branches without it.
- **One main contact.** The widget's WhatsApp and Call buttons prefer it, else use the first contact that can.
- **Map link built server-side** from address + place id (public Maps URLs format), and rebuilt on read: a stored or
  posted URL is never trusted. Details request Essentials fields only (cheapest SKU).
- **Rate limits** live in `RATE_LIMITS` (`placesAutocomplete`, `placesDetails`), keyed on the business id, checked
  after the query is validated.
- **Time zone.** "Open now" is only stated when `Business.timezone` is not the default `UTC`; saving step 4 fills
  the zone from the country when it can (`timezoneForCountryName`).
- **The open-now line** is computed per chat request from `Business.timezone` and passed to the model in English;
  the model answers in the visitor's language.

## Checks run

`npx next typegen`, `npx tsc --noEmit`, `npm run lint`, `npx vitest run` (149 files, all passing), `npx next build`.
Not exercised against a live database or a real Google key from this worktree; the Places calls are covered with a
mocked `fetch` (`tests/api/places.test.ts`).

## Follow-ups

- Try the slider and address search on a phone (touch dragging, the suggestion list over the keyboard).
- Consider showing the hours and the main contact in the chat's "unavailable" and lead-captured states.
- Autopilot's `hasHours` now counts structured hours too, so hours-based post ideas also appear for new companies.

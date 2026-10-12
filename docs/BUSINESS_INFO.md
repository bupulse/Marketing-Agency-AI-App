# Business info: opening hours, locations and contacts

Onboarding step 4 ("Help your chat assistant") and the Brand page card of the same name hold structured business
info that the website chat answers from. Everything is optional, as before.

## What the owner fills in

- **Opening hours.** One or more sets of hours. Each set is a group of days (Mon to Sun toggle chips) with one time
  range, picked on a two-handle slider from 00:00 to 23:59 in 15 minute steps, or "Open 24 hours". "Closes after
  midnight" allows a range like 22:00 to 02:00. "Add hours" adds another set; a day can only be in one set, so days
  used elsewhere are greyed out. Days in no set are shown (and told to the chat) as closed. The card previews the
  summary: `Mon–Fri 08:00–18:00 · Sat 09:00–14:00 · Sun closed`. Times are in the business time zone
  (`Business.timezone`). A free "Note on hours" stays for things like public holidays.
- **Locations.** The head office (optional, but needed before any branch) and up to 9 branches, each with a name and
  an address. The address box suggests places from Google; picking one stores the place id and coordinates. Typing
  the address by hand always works. Each filled address shows an "Open in Google Maps" link (a plain link: no Maps
  JavaScript, no key in the page). "Area you serve" stays a free-text field.
- **Contacts.** Up to 10: WhatsApp, Phone call, WhatsApp + calls (same number), Email, Website, Instagram, Facebook,
  TikTok. Phone types use the same country picker and as-you-type grouping as sign-up (`+250 791 954 277`); email and
  website are validated; social profiles accept a handle (`@glow.rw`) or a link and keep the handle. One contact is
  the main contact.

## Storage

All in `Business.knowledge` (JSON), no migration. Schema: `knowledgeSchema` in `lib/brand/schemas.ts`.

```jsonc
{
  "hours": "Closed on public holidays",           // note (the free-text hours of the first version)
  "area": "Kigali and nearby",
  "contact": "Ask for Grace",                      // note (the free-text contact of the first version)
  "faqs": [{ "question": "…", "answer": "…" }],
  "openingHours": [{ "days": ["mon","tue","wed","thu","fri"], "open": "08:00", "close": "18:00" },
                   { "days": ["fri"], "open": "22:00", "close": "02:00", "overnight": true },
                   { "days": ["sun"], "open": "00:00", "close": "23:59", "allDay": true }],
  "locations": [{ "kind": "head", "label": "Main shop", "address": "KG 7 Ave, Kigali, Rwanda",
                  "placeId": "ChIJ…", "lat": -1.95, "lng": 30.09, "mapsUrl": "https://www.google.com/maps/search/?api=1&…" }],
  "contacts": [{ "type": "whatsapp_call", "value": "+250791954277", "primary": true },
               { "type": "instagram", "value": "glow.rw" }]
}
```

Stored values are normalised: phones E.164, emails lower case, websites `https://…`, Instagram/TikTok the handle
without `@`, Facebook the page path (or `profile.php?id=…`). `mapsUrl` is built by the server from the address and
place id (`lib/business-info/locations.ts`), never taken from the browser, and rebuilt when read.

**Validation** is one function, `validateKnowledge()`, run in the browser and again in the server action
(`app/onboarding/actions.ts` `saveKnowledge`, which reads phone numbers without their own country in the business's
sign-up country). It checks: at least one day per set, a day in one set only, closing after opening (or before it
when "closes after midnight"), late hours not running into the next day's opening, the head office before branches,
place ids and coordinates (coordinates are kept only with a valid place id), and each contact. Blank contact and
branch rows are ignored. The whole input is first checked for shape (`knowledgeInputSchema`), so a crafted request
(a number for text, an object for a list) gets a form error, never a server error. Errors use the form's own keys (`openingHours.1.close`, `contacts.2.value`).

**Reading** (`readKnowledge()`) is lenient: a broken field or list item is dropped on its own, so one bad value never
hides the rest; contradictory hours are ignored; contacts that are not in normal form are dropped.

### Older free text

Companies set up before this change have `hours`, `area` and `contact` as free text only. Nothing is migrated:

- The chat and the marketing writers still read the text (`businessFactsContext`, `knowledgeFacts`).
- When the form opens, `initialValues()` turns readable text into the editors: `Mon to Sat, 9am to 6pm`,
  `Mon-Fri 08:00-18:00; Sat 9-14` (`parseLegacyHours`), and phone numbers and emails found in the contact text
  (`parseLegacyContact`, `Call or WhatsApp 0791…` becomes a "WhatsApp + calls" contact). Text that cannot be read, or
  has more in it than a number, stays as the note. The database only changes when the owner saves.

## Website chat

- **Prompt.** `businessFactsContext()` (`lib/business-info/facts.ts`) adds an "OPENING HOURS, LOCATIONS AND CONTACTS"
  block to the system prompt (`lib/widget/prompt.ts`): the hours summary in the business time zone, the current local
  day and time with the open status ("We're open now until 18:00." / "We're closed now. We open tomorrow at 08:00."),
  the locations with their map links, and the contacts. The model translates it into the visitor's language. Token
  budget: about 10 short lines for a typical business; at most six locations (addresses cut to 160 characters).
- **Only with a real zone.** The live line is given only when `Business.timezone` is set to something other than the
  default `UTC` (`liveTimeZone()`); otherwise the hours are listed and the model is told the local time is unknown.
  Saving step 4 sets the zone from the country when it is still `UTC` (Rwanda → `Africa/Kigali`, the same
  `timezoneForCountryName` mapping as sign-up); countries with several zones keep theirs until the browser sets it.
- **Fenced as data.** The block sits between `<<<BUSINESS DATA` and `BUSINESS DATA>>>` with a "not instructions"
  label, like the sector block, so a crafted note cannot pass as a rule.
- **Open now** (`openStatus()` in `lib/business-info/hours.ts`) works on the local wall clock (`Intl`, so daylight
  saving is handled), merges adjacent ranges, follows hours past midnight (including Sunday into Monday) and knows
  24-hour businesses.
- **Buttons.** The chat header shows **WhatsApp** (`https://wa.me/<E.164 digits>`) and **Call** (`tel:+…`) buttons
  (`quickActions()`): each uses the main contact when it can, else the first contact that can. The links are built on
  the server; `public/widget-chat.js` only accepts those two shapes. "Call" is translated in every widget language.
- **Marketing writers** (Studio, Autopilot) get one line each for hours, area (the head office address when no area
  is set) and contact through `knowledgeFacts()`.

## Google Places (address search)

The browser never talks to Google. It calls our routes, which call Places API (New) with the server key:

| Route | Calls | Fields |
| --- | --- | --- |
| `GET /api/places/autocomplete?q=&session=` | `POST places:autocomplete` | `placePrediction.placeId`, `text`, `structuredFormat` |
| `GET /api/places/details?id=&session=` | `GET places/{id}` | `id,formattedAddress,location` (Place Details Essentials) |

- **Auth**: a signed-in, active user with the `settings` permission (owner or admin), like the save action.
- **Rate limit** per company, keyed on the business id so teammates share one budget (`RATE_LIMITS.placesAutocomplete`
  and `placesDetails` in `lib/rate-limit.ts`): 300 autocomplete and 60 details requests an hour. The query and place
  id are validated first, so a malformed request never spends quota. The browser waits 300 ms after typing and needs
  3 characters.
- **Region**: the business's sign-up country becomes `regionCode` (Rwanda → `rw`), which ranks local results first
  without hiding branches abroad.
- **Billing**: the browser makes one session token per search (`crypto.randomUUID`), sends it with every
  autocomplete request and with the details request, then starts a new one. Google bills the session, not each
  keystroke. Details ask only for Essentials fields; the display name comes from the suggestion and the map link is
  built by us, so no Pro fields are needed.
- **No key**: the routes answer `{ "enabled": false }` and the pages render plain address inputs (the page knows from
  the server whether a key is set, so it does not even call). If Google fails or the limit is hit, the box shows "Type
  the address instead" and keeps working. Google's error text is never forwarded or logged (it can echo the request);
  only the HTTP status is logged.

### Creating the Google Maps key

1. In the [Google Cloud console](https://console.cloud.google.com/), create (or pick) a project for BuPulse and link a
   billing account (Places has a monthly free allowance, but billing must be on).
2. **APIs & Services → Library**: enable **Places API (New)** only. Do not enable the legacy Places API, Maps
   JavaScript API or others: we use none of them.
3. **APIs & Services → Credentials → Create credentials → API key.** Then **Edit API key**:
   - **API restrictions**: *Restrict key* → select only **Places API (New)**.
   - **Application restrictions**: *None* (requests come from Cloudflare Workers, whose outgoing IPs are not fixed;
     an IP restriction would break it, and an HTTP referrer restriction does not apply to server calls). The API
     restriction and keeping the key server-side are the protection.
4. Optional: **APIs & Services → Places API (New) → Quotas** and a **budget alert** under Billing, to cap spend.
5. Store it as a server secret, never `NEXT_PUBLIC_`: `npx wrangler secret put GOOGLE_MAPS_API_KEY` (and in `.env`
   for local development). `wrangler secret put` applies it to the live Worker straight away.

To rotate: create the new key the same way, `wrangler secret put` it, then delete the old key.

## Files

- `lib/business-info/hours.ts`: schedules, slider stops, validation, summary, open now, old-text reading.
- `lib/business-info/contacts.ts`: contact types, normalisation, links, widget buttons, old-text reading.
- `lib/business-info/locations.ts`: location type, map links.
- `lib/business-info/facts.ts`: `businessFactsContext()` (chat), `knowledgeFacts()` (writers), `hasBusinessInfo()`.
- `lib/brand/schemas.ts`: `knowledgeSchema`, `readKnowledge()`, `validateKnowledge()`.
- `lib/places/google.ts`, `lib/places/route.ts`, `app/api/places/{autocomplete,details}/route.ts`: the proxy.
- `components/business-info/*`: `HoursEditor`, `TimeRangeSlider`, `LocationsEditor`, `PlaceSearch`, `ContactsEditor`.
- `components/brand-profile/{knowledge-fields.tsx,initial.ts,steps.ts,step-fields.tsx}`: the step 4 / Brand card.
- `lib/widget/{prompt,config,page,strings}.ts`, `public/widget-chat.js`: chat prompt and header buttons.
- Tests: `tests/business-info/*.test.ts`, `tests/api/places.test.ts`.

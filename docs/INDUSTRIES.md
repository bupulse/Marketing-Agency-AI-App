# Industries, the sign-up sector and the phone field

Built 12 October 2026 on branch `v2-signup`. Handover: `docs/handovers/signup-industries.md`.

## What changed for a client

At sign-up (`/signup` step 2 and `/welcome` for Google sign-ups) a company now gives:

- **Business sector** (required): a select of the active industries from Admin → Industries, plus **Other**. Choosing Other reveals a required **Your industry** text input (slides open, focus moves into it; `aria-controls` / `aria-expanded` on the select, the hidden input is out of the tab order).
- **Describe your business** (required, 20–500 characters, live counter): one or two sentences in the owner's words, for example "We sell kitenge dresses and accessories to young women in Kigali". This is the AI's first fact about the company.
- **Phone** (optional): the country select drives the dial code. The input shows `+250` for Rwanda and groups the digits as they are typed (`+250 791 954 277`). Pasting `0791954277`, `791954277`, `+250791954277` or `00250...` ends up the same. The number must be valid **for the chosen country**; the message says so: "Enter a valid Rwandan number, e.g. +250 791 954 277". Stored as E.164 (`+250791954277`), shown formatted everywhere (`formatPhone`).

Later, the owner edits the sector, the Other text and the description on **Dashboard → Brand → Your industry** (`app/dashboard/brand/actions.ts saveIndustry`). Name, CEO, phone and website stay in **Settings → Business**; the **country is read-only there** (it sets the pricing region; only an admin changes it, audited: `docs/REGIONS.md`). Onboarding step 1 ("What you sell") is prefilled from the sign-up description when the onboarding description is still empty.

## Data

`Industry` (migration `20261012120000_industries`): `id`, `slug` (unique, the form value), `name`, `shortDescription`, `customers`, `offerings`, `postIdeas`, `tone`, `hashtags[]`, `seasons`, `avoid`, `active`, `sortOrder`, timestamps. RLS on and revoked from `anon` / `authenticated` / `service_role` like the other internal tables.

`Business` gains `industryId` (FK, `ON DELETE SET NULL`), `industryOther` (the owner's text when they chose Other) and `industryDescription` (the sign-up description). **`Business.industry` stays** and is written on every save as the readable label (the sector's name, or the Other text), so analytics by industry (`lib/analytics/queries.ts`), the Autopilot playbook tags (`industryTags`), the design packs (`recommendPack`), the voice sample topic and the admin search keep working unchanged. Treat it as deprecated: read `industryRef` / `industryOther` for anything new.

`DismissedIndustrySuggestion` (`key`, `label`, `createdAt`): the normalised Other texts the admin dismissed from "New from sign-ups".

Backfill in the migration: `Business.industry` that equals a seeded name (case-insensitive) is linked by `industryId`; any other text becomes `industryOther` (a bare "Other" is left empty); `industryDescription` is copied from the onboarding `description` when present.

### Seeds

The thirteen sectors of the marketing list (`lib/content/site.ts` `industries`) are seeded by slug and name with guidance written for Rwanda and East Africa: typical customers and offerings in Kigali terms (MoMo, moto delivery, RWF), post ideas, tone, hashtags, the local calendar (Umuganda, Kwibuka with "no promotions 7–13 April", Kwibohora, Umuganura, Christmas/New Year, Easter, Eid, month-end pay days, school terms and back-to-school, the two rainy seasons, Car-Free Day, the Kigali marathon, RRA deadlines) and what to avoid (no medical or financial guarantees, no invented prices, EBM receipts, banned plastic bags and skin-lightening products, consent for client photos, no unearned accreditation claims). `tests/unit/industries-seed.test.ts` checks the SQL seeds every marketing slug and name. Edit the text at Admin → Industries; the seeds are `ON CONFLICT (slug) DO NOTHING`.

### Reading the list

`lib/industries/server.ts`: `getIndustries()` (cached 30 s, last good copy on a database error, otherwise an empty list so the forms offer "Other" only), `industryOptions()` (active rows for the forms), `resolveIndustryChoice()` (form values → the Business columns, or null when the slug is not an active sector: the actions answer "Choose your business sector from the list"). `lib/industries/shared.ts` is the pure part for client components: `INDUSTRY_OTHER = "other"`, the zod fields, `industryKey()` (trim, collapse spaces, lower-case) and `industryFormValues()`.

**Marketing `/industries` page keeps reading `lib/content/site.ts`** (static, with icons and example chips, prerendered, no database on a public page). The sign-up list is the database. The seed test keeps the two in step; a sector the admin adds later appears at sign-up but not on the marketing page until someone adds it to `site.ts` with an icon. Chosen because the public page must never fail or change when the database is down or an admin is mid-edit.

## Admin → Industries (`/admin/industries`, nav group Product)

- List with company counts, order (set inline), Active/Hidden badge, Activate / Deactivate, Delete (only when no company uses it; otherwise the service answers "Deactivate it instead; they keep it").
- Create / edit form (`components/admin/industry-form.tsx`): Name, Slug (optional; kept on edit when blank), Order, Short description, Typical customers, Products and services, Good post ideas, Tone of voice, Useful hashtags, Important dates and seasons in Rwanda and East Africa, Words or claims to avoid, Active. Required: name, short description, customers, offerings, tone. Every field shows a hint with a good example. Validation is zod in `lib/admin/industries-service.ts` (`industryInputSchema`): lengths, slug shape, up to 20 hashtags of letters/digits/underscore, `sortOrder` −1000..1000; the slug is unique (a clash is a `conflict`, never a silent rename).
- **New from sign-ups**: companies with `industryOther` grouped by `industryKey`, most frequent first, with the most common spelling as the label and up to five sample descriptions. **Add as industry** opens the form prefilled (name from the text, slug from the name, short description drafted from the first client description) with a hidden `suggestionKey`; saving creates the industry and moves every matching company (`industryId` set, `industryOther` cleared, `Business.industry` = the new name) in one transaction with one audit row per company (`update_company_industry`). **Dismiss** stores the key in `DismissedIndustrySuggestion`; dismissed ones can be restored.
- Every action starts with `adminAction()` (allow-listed email, AAL2) and writes `AuditLog` rows: `create_industry`, `update_industry`, `delete_industry`, `dismiss_industry_suggestion`, `restore_industry_suggestion`, `update_company_industry`.
- Jarvis read tools: `list_industries` (optionally `active`), `list_industry_suggestions` (optionally `includeDismissed`). No write tools: editing is in the console.

## The AI uses it

`lib/industry-context.ts` `industryContext(business)` builds one compact block from the loaded `Business` (with `industryRef`):

```
Industry: Shops & retail (Shops and boutiques selling …)
About this business, in the owner's words: We sell kitenge dresses …
Sector guidance (general knowledge about this kind of business, not facts about this one; …):
- Typical customers: …
- Typical products and services: …
- Post ideas that work: …
- Tone: …
- Hashtags that fit: #Kigali #MadeInRwanda …
- Dates and seasons in Rwanda and East Africa: …
- Avoid (words, claims, compliance): …
```

For Other it is `Industry (in the owner's words): <text>` plus the description, with no guidance. The owner's words come first because they are facts about this company; the guidance is marked as background so the writer does not turn seeded offerings or dates into claims. Each field is clipped to 320 characters and the whole block to 1,600 (about 400 tokens); over budget, guidance lines are dropped from the bottom while the "Avoid" line is kept. Companies from before the sign-up field fall back to the onboarding `description`.

Where it goes: `BrandContext.industryContext` in `lib/ai/marketing.ts` (Studio generation, `lib/studio/service.ts`), `WriterBrand` in `lib/autopilot/writer.ts` (Autopilot run and regenerate, `lib/autopilot/run.ts` and `manage.ts`; also part of `factsText`, so dates from the guidance are not flagged as invented numbers), and `BusinessFacts.industryContext` in the website chat (`lib/widget/prompt.ts`, loaded in `lib/widget/config.ts`) under "ABOUT THE BUSINESS AND ITS SECTOR" with a note that the guidance is not the offer list. When the block is present the old bare `Industry: <name>` line is dropped. The Autopilot planner itself stays rule-based (`industryTags` from `Business.industry`); the context reaches the writer.

## Phone

`lib/phone.ts` (pure, `libphonenumber-js/max` so client and server agree on validity): `phoneCountry(countryName)` via `COUNTRY_CODES`, `dialCode`, `toInternational` (national → `+<code>…`, strips a leading 0 and a `00`), `formatAsYouType`, `toE164`, `isValidPhone` (must also belong to the chosen country), `formatPhone` (display), `examplePhone` (libphonenumber's mobile examples), `phoneErrorMessage` (adjectives for RW, KE, UG, TZ, BI, CD, SS, SO, ET, NG, GH, ZA, PT, FR, BE, DE, GB, US, CA, IN, CN, AE; otherwise "Enter a valid number for <country>, e.g. …"). The schemas (`lib/auth/schemas.ts`) run the phone and the Other checks as object-level `superRefine` with `when: () => true` so every problem shows at once, then transform the phone to E.164. `businessDetailsSchema(country)` is the Settings variant: the action passes the saved country, the form never does.

Shown formatted: Settings and Welcome inputs (prefilled through `formatPhone`), Client 360 Business panel (phone with a `tel:` link, CEO, the sign-up description). Emails do not currently include the company phone.

## Files

- Pure: `lib/phone.ts`, `lib/industry-context.ts`, `lib/industries/shared.ts`.
- Server: `lib/industries/server.ts`, `lib/admin/industries-service.ts`, `lib/account.ts` (sector columns + E.164 from the sign-up metadata `industry_slug`, `industry_other`, `industry_description`), `app/signup/actions.ts`, `app/welcome/actions.ts`, `app/dashboard/brand/actions.ts`, `app/dashboard/settings/actions.ts`, `lib/admin/tools.ts`.
- Client: `components/auth/industry-fields.tsx`, `components/auth/phone-field.tsx`, `components/auth/organisation-fields.tsx`, `components/brand-profile/industry-section.tsx`, `components/settings/settings-form.tsx`, `components/admin/industry-form.tsx`.
- Admin pages: `app/admin/(console)/industries/{page,actions,new/page,[id]/page}.tsx`, `components/admin/nav.ts`, `components/admin/client360.tsx`.
- Prompts: `lib/ai/marketing.ts`, `lib/autopilot/writer.ts`, `lib/autopilot/run.ts`, `lib/autopilot/manage.ts`, `lib/studio/service.ts`, `lib/widget/prompt.ts`, `lib/widget/config.ts`.
- Tests: `tests/unit/phone.test.ts`, `tests/unit/industry-context.test.ts`, `tests/unit/industries-seed.test.ts`, `tests/admin/industries.test.ts`, `tests/unit/auth-schemas.test.ts`, `tests/account/welcome.test.ts`, `tests/marketing.test.ts`, `tests/autopilot/writer.test.ts`, `tests/widget/units.test.ts`; `tests/admin/fake-db.ts` gained the two tables, `delete` and `_count.businesses`.

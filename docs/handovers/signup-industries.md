# Handover: sign-up industries, description and phone

Built 12 October 2026 on branch `v2-signup` (worktree `~/BuPulse-v2-signup`, from `v2` after R1). What it does and how it works: `docs/INDUSTRIES.md`. Not pushed, not merged.

## Migration

`20261012120000_industries`, after `20261010100100_regions_and_demos`:

- Tables `Industry` and `DismissedIndustrySuggestion` (RLS on, revoked from `anon` / `authenticated` / `service_role`).
- `Business.industryId` (FK → `Industry`, `ON DELETE SET NULL`, indexed), `Business.industryOther`, `Business.industryDescription`: nullable, no default, no rewrite. `Business.industry` is kept and still written (deprecated label).
- Seeds the 13 marketing sectors (`ON CONFLICT (slug) DO NOTHING`) with Rwanda / East Africa guidance.
- Backfill: links `Business.industry` to a seeded sector by name; other text → `industryOther`; `industryDescription` ← onboarding `description`.

Not applied to any database from this worktree; `npx prisma generate` was run.

**Deploy order.** Back up, `npx prisma migrate deploy` (with `DIRECT_URL`), then the code. The gap is tolerated in one direction only: the old code ignores the new columns and tables, so migrating first is safe. The new code before the migration would fail every sign-up (`ensureAccount` writes `industryId` / `industryDescription`) and every generation (`include: { industryRef: true }`), so **run the migration before the new Worker takes traffic**. `getIndustries()` returns an empty list on a database error, so the forms then offer "Other" only. New dependency: `libphonenumber-js` (1.12.10) — `npm ci` on the server / in the deploy workflow picks it up from the lock file.

Supabase user metadata written at sign-up gained `industry_slug`, `industry_other`, `industry_description`; `phone` is now E.164. Older unconfirmed sign-ups still carry `industry: "<name>"` and are linked by name when they confirm.

## Files

See the Files section of `docs/INDUSTRIES.md`. New: `lib/phone.ts`, `lib/industry-context.ts`, `lib/industries/{shared,server}.ts`, `lib/admin/industries-service.ts`, `app/admin/(console)/(content)/industries/**`, `components/admin/industry-form.tsx`, `components/auth/{industry-fields,phone-field}.tsx`, `components/brand-profile/industry-section.tsx`, `app/dashboard/brand/actions.ts`, four test files.

## Decisions

- **Form value = slug**, resolved to the id on the server (`resolveIndustryChoice`); the server refuses a slug that is not an active sector ("Choose your business sector from the list"). `other` is the fixed value for Other.
- **`Business.industry` stays** and is written as the readable label on every save, so analytics, `industryTags`, design packs and admin search are untouched. Deprecated for new code.
- **Two descriptions.** `industryDescription` (sign-up, required) and the onboarding `description` ("What you sell", step 1) both exist; onboarding is prefilled from the sign-up text and the AI context prefers `industryDescription`, falling back to `description` for older companies. Merging them was out of scope: the onboarding field has its own schema, step and page.
- **Sector editing moved to the Brand page** ("Your industry" card); Settings → Business keeps name, CEO, phone, website and shows the sector and the country read-only. `saveBusiness` no longer accepts `industry` or `country` (R1 rule: the country sets the region once; only an admin changes it). The welcome action still writes country / region / zone on the first save only.
- **Marketing `/industries` keeps the static list** (`lib/content/site.ts`); the sign-up list is the database. A test keeps the seeds and the static list in step.
- **Phone validity with the full metadata** (`libphonenumber-js/max`, ~150 KB on the sign-up, welcome, settings and brand pages) so the browser and the server agree; `min` metadata only checks plausible lengths. A number from another country than the one selected is refused (typo, not a foreign customer). National grouping is libphonenumber's international format: Kenya reads `+254 712 345678`.
- **Deleting an industry in use is refused** (`conflict`), deactivating hides it from sign-up while companies keep it; the FK is `SET NULL` as a last resort only.
- **Suggestions are computed, not stored**: grouping `industryOther` by `industryKey` on each page load (fine at this scale); only dismissals are stored. "Add as industry" moves the matching companies in the same transaction as the create, one audit row per company.
- **Industry context budget**: 320 characters per field, 1,600 for the block (about 400 tokens), guidance dropped from the bottom with the "Avoid" line kept. The context replaces the bare `Industry:` line in the prompts; it is part of the writer's `factsText` so dates in the guidance are not flagged as invented.
- Autopilot **planning** stays rule-based; the context goes to the writer (plan → posts) and to regenerate.

## Checks (12 October 2026)

- `npx next typegen`, `npx tsc --noEmit`: clean.
- `npm run lint`: clean.
- `npx vitest run`: 142 files passed, 9 skipped; 1,764 tests passed, 69 skipped (before the last four prompt / seed tests, which pass on their own: 55 tests across `tests/marketing.test.ts`, `tests/autopilot/writer.test.ts`, `tests/widget/units.test.ts`, `tests/unit/industries-seed.test.ts`).
- `npx next build`: succeeded; `/admin/industries`, `/admin/industries/new`, `/admin/industries/[id]` are dynamic routes.
- `e2e/signup.spec.ts` updated for the new fields (sector select, Other reveal with focus, description, Kenyan phone grouping); not run here (needs a dev server).

## Status at handover (12 October 2026, work moves to another model)

**Done**: everything in sections A–F of the brief is implemented, tested and committed (`6512cbb`): migration + seeds + backfill, Admin → Industries with suggestions, sign-up / welcome / Brand forms, country-aware phone (E.164), `industryContext()` in Studio, Autopilot writer and website chat, docs. All checks green (see above).

**Remaining**: nothing in the brief is unfinished. Not done by design or out of scope: the open items below; the Playwright spec was updated but not executed; the migration has not been applied to any database; the branch is not pushed or merged.

## Open items

- Emails do not include the company phone (none showed it before either); add `formatPhone(business.phone)` to the demo booking admin email if wanted.
- Marketing `/industries` cards need a manual `site.ts` entry (with an icon) for a sector added in the admin.
- `phoneErrorMessage` has adjectives for ~22 countries; the rest read "Enter a valid number for <country>".
- `PhoneField` prefixes the dial code on focus of an empty field; a person who wants to type a foreign number deletes it and types `+…`.
- Dismissed suggestions never expire; the Restore list shows them.
- Industry text is English only (the admin writes it); the AI writes in the company's content language regardless.

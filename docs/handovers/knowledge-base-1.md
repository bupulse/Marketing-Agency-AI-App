# Handover: Knowledge base, part 1

Built 12 October 2026 on branch `v2-kb` (from `v2`). Full description: `docs/KNOWLEDGE_BASE.md`.

## What was built

- **Shell.** Sidebar "Knowledge base" (`/dashboard/knowledge`) replaces "Projects". Landing page with one card per
  section and its completeness, from the `KNOWLEDGE_SECTIONS` registry (`lib/knowledge/sections.ts`) and
  `knowledgeProgress()` (`lib/knowledge/overview.ts`). Ready: Company profile, Products & services, Campaigns,
  Locations hours & contacts (the existing business info editor, embedded), Brand look (links to Brand), Channels
  (links to Channels). Coming soon: Customers & audience, Competitors, FAQs & policies, Reviews, AI marketing interview.
- **Company profile** (`/dashboard/knowledge/profile`): name, website and sector in their Business columns; tagline,
  mission, vision, what the company does, year founded, size, legal name, registration number / TIN, languages,
  values, achievements in `Business.profile` (JSON, zod `profileSchema`); the service area is
  `Business.knowledge.area`. Required: name, what it does, sector.
- **Products & services**: new `Product` model with kind-specific details (physical / digital / service), structured
  price (model, amount in the smallest unit, currency defaulting to the region's), selling points (at least one),
  features, target customer, status. List with kind / status / search filters, create, edit, duplicate, archive,
  delete; each product page has its facts, album, content and design studio.
- **Campaigns**: new `Campaign` model (event, offer, promotion, launch, other) with dates, price/discount, highlights,
  linked products (`CampaignProduct`) and status. Same pages as products.
- **Albums and destinations**: `ProductPhoto` / `CampaignPhoto` link gallery photos to albums (a photo can be in
  several). Every upload and import names a destination (folder, product album, campaign album) first; the Gallery has
  an Albums row, "Add to album", "Make cover", "Remove from album" and a "Used for" picker on each photo.
- **Writing from a product or campaign**: content, Autopilot, designs, posts and the chat assistant now start from a
  product or campaign; the writers get a fenced, budgeted `PRODUCT DATA` / `CAMPAIGN DATA` block and a
  `COMPANY PROFILE` block (`lib/knowledge/context.ts`).
- **Migration from Projects** (`prisma/migrations/20261013100000_knowledge_base`): every project copied into a product
  or campaign with the same id, its photos into the album; content, designs, posts and store mappings backfilled with
  `productId` / `campaignId`; `GeneratedContent.businessId` added; `projectId` kept everywhere; old URLs redirect.
  Mapping (also `mapLegacyProject()`): product, listing → physical product (listing keeps "Listing" as its category);
  service, project → service ("project" keeps "Finished work"); event, offer → campaigns of that type; anything else →
  "other" campaign.
- **Public API**: `/api/v1/products`, `/campaigns` (+ `/:id`); `/projects` kept in the old shape (deprecated).

## Deploy (hard rule: migration first)

1. `npx prisma migrate deploy` (with `DIRECT_URL`), then deploy the build. **Not applied to any database from this
   worktree**; only `npx prisma generate` was run. `.env` has no database values.
2. While the old build still runs against the migrated database: content, designs and posts it writes get their
   `productId` / `campaignId` (and the content its `businessId`) from the `bupulse_legacy_subject` trigger. Projects
   it **creates** in that window are not copied: if the old build ran for more than a few minutes after the migration,
   re-run the "BACKFILL" block of the migration (it is idempotent) after the new build is live.
3. Nothing is dropped. Rolling back the code is safe: the old build reads `Project`, which still holds every project
   from before the migration (but not products or campaigns created after it). One caveat: migrated photos keep their
   `<userId>/projects/…` object paths, so a photo deleted in the new Gallery is also gone from the old project
   (`Project.photoPaths` still lists it; the old build shows it as missing). Store-import mappings an older build
   writes after the migration (`ProductSync` has no trigger) also need the BACKFILL block re-run.

## Checks

`npx next typegen`, `npx tsc --noEmit`, `npm run lint`, `npx vitest run` (167 files, 2008 tests pass; 9 database
files skipped without a database) and `npx next build` all pass. New tests: `tests/knowledge/{products,campaigns,
legacy,destinations,context,profile,actions}.test.ts`; updated: store sync, media service and imports, studio
service, publishing, public API, features registry. `tests/studio-actions.test.ts` was replaced by
`tests/knowledge/actions.test.ts` (the project actions are gone).

## Review fixes (second commit)

Quota exemption for migrated photos and the shared storage guard with an admin warning at 80%; store photos skipped
and reported when the gallery is full; store sync never deletes a store photo that is in a folder or used by a post
or design; `GET /api/v1/projects` without `type` merges products and campaigns with cursor paging; `/api/generate`
puts `photoPaths` (gallery photos) in the album or answers 400 `invalid_photo`; a per-album advisory lock for the
30-photo cap; a retried finalize links its destination; the fence stripper removes any run of 3+ `<` or `>` until
stable. Further items from the reviewer are listed with their tests in the commit.

## For part 2

- Add a section: flip its `KNOWLEDGE_SECTIONS` entry to `ready` with its `href`, add its progress to
  `knowledgeProgress()`, its page under `app/dashboard/knowledge/<key>/` (start with `<BackLink />`), its actions
  through `knowledgeAction()` (role, plan feature, rate limit, readable errors; pick `settings` or `content`), and its
  AI facts as a fenced, budgeted block in `lib/knowledge/context.ts`, passed through `BrandContext` (Studio,
  `lib/ai/marketing.ts`) and `WriterBrand` (Autopilot, also into `factsText`).
- FAQs: today they live in `Business.knowledge.faqs` (the business info card). A "FAQs & policies" section should edit
  the same list (the chat and Autopilot read it there) rather than add a second one.
- Customers & audience: `Business.audience` (from onboarding) is the current single line; the section can
  grow from it the way the profile grew from `Business.description`.

## Open items

- Photos moved from projects do not count toward the gallery quota (`source = 'project-migration'`); store photos do,
  and are skipped (and reported) when the gallery is full. All photos count toward the shared storage cap
  (`MEDIA_PLATFORM_MAX_BYTES`, default 900 MB for the Supabase free plan's 1 GB); set it when the Storage plan grows.
- Migrated products have no selling point and no structured amount (the price text is kept as the note, the form
  reads it back): they show "Needs details" until the owner opens and saves them. That is intended (the owner confirms
  the number), but a one-click "confirm price" could help.
- Saving the product form of a store-imported product turns the store's price text into an amount and clears the note,
  which the re-sync treats as the owner's edit: the price then stops following the store. Store a structured
  baseline price if that matters to merchants.
- The `Project` table is read-only and can be dropped in a later release once no older build can run (also drop the
  `projectId` columns, the trigger and `/dashboard/projects` from the `content` feature's routes).
- Photos can be added to a product only after it is first saved (the album needs the product's id); the form says so.
- The composer's own Upload asks for a destination each time unless the post came from a product's content.
- Archived products and campaigns stay linked to their posts and designs but are hidden from pickers, Autopilot and
  the chat; an archived product linked to a campaign still appears in that campaign's AI context.

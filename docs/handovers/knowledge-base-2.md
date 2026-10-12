# Handover: Knowledge base, part 2

Built 12 October 2026 on branch `v2-kb2` (from `v2-kb`, with `v2` merged in for invoices). Full description:
`docs/KNOWLEDGE_BASE.md`. Part 1: `docs/handovers/knowledge-base-1.md`.

## What was built

- **Merge of `v2`** (invoices) into the knowledge base branch: the only conflict was `ManualPayment`'s indexes in
  `prisma/schema.prisma` (kept v2's, which add `reference` and `invoiceId`). Migration order: invoices
  `20261013090000`, knowledge base part 1 `20261013100000`, part 2 `20261013110000` (tested in
  `tests/knowledge/part2.test.ts`).
- **All five part-2 sections are ready** on the landing page with their progress scores:
  - **Customers & audience**: personas (`Persona`, ordered, up to 12) and the overall notes (`Business.audienceNotes`).
  - **Competitors & what makes you different**: competitors (`Competitor`, ordered, up to 20) and differentiators +
    positioning statement (`Business.positioning`).
  - **FAQs & policies**: FAQs moved to their own ordered table (`KnowledgeFaq`, up to 200; the migration copies
    `Business.knowledge.faqs`), policies in `Business.policies` (payment methods, delivery, returns and refunds,
    warranties, booking and cancellation). The business info card no longer edits FAQs; it links to the new page.
  - **Reviews & testimonials**: `Testimonial` with "The customer agreed to be quoted" (`canPublish`, granted by
    Owners and Admins only); only those reach the AI.
  - **Digital marketing profile**: the adaptive AI interview (14 topics, 3 to 5 options + Other, skip and back, hard
    cap 20), the AI-written brand-voice summary the owner edits and approves (`Business.marketingProfile`), and the
    fixed question set + a summary built from the answers when the AI cannot be used.
- **AI use of the new data** (`lib/knowledge/context.ts`, all fenced as data, markers stripped, budgeted):
  `CUSTOMERS`, `POSITIONING`, `CUSTOMER REVIEWS`, `POLICIES` and `BRAND VOICE PROFILE` go to Studio and Autopilot
  through `writerKnowledge()` (`lib/knowledge/writer-context.ts`); the approved voice replaces the voice preset
  (`voiceLine()`). The website chat gets the `FAQ` and `POLICIES` blocks and answers delivery, returns, payment,
  warranty and booking questions only from them. Autopilot's FAQ ideas read the new table.
- **Cheap AI provider**: `getCheapTextProvider()` in `lib/ai/index.ts` (Gemini Flash-Lite, or Claude Sonnet at low
  effort with `AI_TEXT_PROVIDER=claude`; `CHEAP_TEXT_MODEL` in `.env.example` overrides). Interview calls are in the
  `AiCall` ledger as feature `interview`, behind the admin switch and the budget cap, rate-limited per company.

## Review fixes (second commit)

- Interview cost: AI calls capped at 40 per company over a rolling 24 hours, counted from the ledger (restarts do not
  reset it); starting over an interview in progress needs the owner's "Start over" confirmation, 3 restarts a day.
  The row is claimed before the AI call (no double-click second call); a call refused before the provider is not
  counted.
- Per-company monthly AI allowance for every AI feature: `AI_COMPANY_MONTHLY_USD` (default $3), checked in
  `withLedger` on top of the platform cap, with the "monthly AI allowance reached" message and the month's spend in the
  admin client view (Usage tab).
- Plan feature `content` on the audience, competitors, reviews and interview pages and saves (deletes never).
- FAQs (create, edit, delete, order) and the permission to quote a review moved to the `settings` role.
- Reordering is one `UPDATE ... FROM (VALUES ...)` statement; `Testimonial.rating` has a `CHECK` (1 to 5 or null).

## Deploy (migration first)

1. `npx prisma migrate deploy` (with `DIRECT_URL`) runs, in order, invoices, knowledge base part 1 and part 2, then
   deploy the build. **Not applied to any database from this worktree**; only `npx prisma generate` was run.
2. Part 2 only adds tables and nullable `Business` columns and copies the FAQs (idempotent: a company that already
   has FAQ rows is skipped). Nothing is dropped; `Business.knowledge.faqs` stays as it was.
3. FAQs edited by an older build in the window between the migration and the new build land in the JSON only; re-run
   the FAQ `INSERT` of the migration for companies with no FAQ rows if that matters (it skips the others).
4. Rolling back the code is safe: the old build reads `Business.knowledge.faqs` (the pre-migration list), and ignores
   the new tables and columns.

## Checks

`npx next typegen`, `npx tsc --noEmit`, `npm run lint`, `npx vitest run` (178 files, 2145 tests pass after the review fixes; 10 database
files skipped without a database) and `npx next build` pass. New tests: `tests/knowledge/part2.test.ts` (validation,
progress scores, context blocks: fencing, marker stripping, budgets, only permitted reviews, voice profile replacing
the preset, website chat answering from FAQs and policies, migration order and FAQ copy),
`tests/knowledge/interview.test.ts` (adaptive next question, rejected AI output, fallback, lasting fallback on budget /
missing key / rate limit, hard cap, skip and back, stale tab, AI summary, approval), `tests/knowledge/part2-actions.test.ts`, `tests/knowledge/records.test.ts`, `tests/ai-budget.test.ts` (company allowance)
(permissions, field errors, service messages). Updated: widget prompt and chat, studio service, Autopilot run and
manage (mock `writerKnowledge`), sections registry.

## Open items

- Onboarding step 4 no longer asks for FAQs (they live in the Knowledge base now); the step links there. If FAQs
  during onboarding matter, add a small FAQ step that writes `KnowledgeFaq` rows.
- The interview, its summary and the fixed questions are in English; the sample captions follow the content
  language. Translate the UI with the rest of the dashboard when that happens.
- The interview's "content you like" accepts links in Other; they are kept as text, never fetched.
- Persona and competitor reordering uses Move up / Move down buttons (no drag and drop).
- Reviews are not linked to Google Business or WhatsApp imports; they are typed or pasted.
- `Business.knowledge.faqs` and `MAX_ONBOARDING_FAQS` can be removed in a later release once no older build runs.
- `claude-sonnet-5-5` is the Claude "cheap" default because its price is in `lib/ai/pricing.ts`; add a Haiku price
  there and set `CHEAP_TEXT_MODEL` to use a cheaper Claude model.

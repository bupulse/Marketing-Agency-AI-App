# Creator campaign wizard

Phase 3 of creator campaigns (after [CREATOR_CAMPAIGNS.md](CREATOR_CAMPAIGNS.md) and [CREATOR_MARKETPLACE.md](CREATOR_MARKETPLACE.md)).
A company makes a creator campaign in 12 short steps instead of one long form, with the AI filling each step from one
line and Business info, and builds the application form creators fill in, branded as the company.

## Owner decisions (22 October 2026)

- **Entry:** Business info → Campaigns → "New campaign" first asks who posts it: "My business, on my pages" (today's
  Event / Offer / Promotion / Launch form) or "Content creators" (this wizard). The menu item "Creators" becomes
  **"Creator campaigns"** and holds all creator campaigns, Find creators and payouts.
- **Steps:** one step per screen, Next / Back, a progress bar ("Step 6 of 12 · Content"). Enough questions to make a
  good campaign without writing much: clickable answers, searches, date pickers, sliders and money inputs, each with a
  placeholder that fits the question.
- **AI:** the owner writes one line ("Get people to film our new juice"); the AI fills every later step from it and
  Business info (products, campaigns, audience, brand voice). The owner edits; each step has "Suggest again".
- **Drafts:** saved after every step. The list shows "Draft · step 6 of 12 · Continue".
- **Editing:** Settings opens the same steps, any one at a time. Dates and currency still lock once live.
- **Pay per views:** the owner picks the number of views (1,000 / 10,000 / 100,000 / 1,000,000) and the price. Floor:
  **1,000 RWF for every 1,000 views** (about $0.68; clipping/UGC campaigns paid $0.30-$6, typically $1, in 2026). A meter
  shows Too low / Fair / Generous. See `lib/creators/pay-floor.ts`.
- **Networks:** all social networks are listed; the ones BuPulse can't count views on yet say "Coming soon"
  (`lib/creators/networks.ts`). TikTok is "Coming soon" until its app is set up (COMPOSIO_TIKTOK_AUTH_CONFIG_ID).
- **Application form:** the company builds it. Default: First name, Last name, Email, Phone number, Social media
  accounts (the creator ticks the networks they have, then types the username and followers of each). Ready-made
  fields to add with one tap, or any field by type: text, choices, numbers / dates / money range / scale, uploads /
  links / place. `lib/creators/form-fields.ts`.
- **Branding:** the application page uses the company's logo, colours and font from Brand, plus a cover photo or
  video the owner picks. Small "Powered by BuPulse" at the bottom.
- **Files:** the wizard makes three Photos folders for the campaign: Images, Videos, Documents. The owner uploads or
  imports (Google Drive, Dropbox, Canva, as in Photos) and may also paste a shared Google Drive folder link.
- **Required before going live:** logo and product photos (Images), the brief (AI-written, edited), do's and don'ts,
  example videos or a mood board (Videos, or links to posts), and instructions (at least one task).
  `goLiveProblems()` in `lib/creators/wizard.ts`.
- **Followers:** what creators type is kept; when they connect the account after being picked, BuPulse reads the real
  count and the company sees "Verified" or the difference.
- **Requirements** (niches, places, languages, minimum followers): creators who don't fit can still apply; the
  company sees "Doesn't match" and why, the ones who match first. `lib/creators/requirements.ts`.
- **Marketplace one-tap apply:** the creator's profile fills the form (they can change it); they answer only the
  company's extra questions. With none, it stays one tap.

## The 12 steps

`WIZARD_STEPS` in `lib/creators/wizard.ts`. Inputs per step (the placeholder fits each one):

| # | Step | What the owner gives | Inputs |
|---|------|----------------------|--------|
| 1 | Idea | One line; the kind (Product review, Challenge, Unboxing, How-to, Event, Launch, Testimonial, Other); the Business info campaign and products it promotes | text with examples from their industry, kind chips, search pickers. The name is suggested by the AI. |
| 2 | Goal | Get seen / Sell more / Visits / Followers / App downloads | cards |
| 3 | Creators | Topics, places, languages, minimum followers, how many creators | chips, place search (`lib/creators/places.ts`), chips, slider (`FOLLOWER_STEPS`), slider up to the plan's `creatorsPerCampaign` |
| 4 | Where | Networks (`campaignNetworks`), ALL or ANY, formats (Reel, Story, Photo post, Carousel, Live), required mentions | tiles with "Coming soon", two-way switch, chips, tag input (the AI suggests a hashtag and the business's handle) |
| 5 | When | First and last day, how often a new brief comes (whole campaign / week / day), posts a day, video or photo | date range picker with presets (2 weeks, 1 month, 2 months, 3 months), three cards, stepper, three cards |
| 6 | Content | The brief, and the tasks with their instructions | AI-written text with "Rewrite"; task cards the AI writes from step 5 (one per period), each editable |
| 7 | Rules | Do's and don'ts, anything else | suggestion chips (`DO_SUGGESTIONS`, `DONT_SUGGESTIONS`) plus the AI's, add your own; optional text (`rules`) |
| 8 | Pay | Per views (views + price, meter), per post, milestones, caps, budget a month, view targets | method cards, views switch, money input with currency, meter, rows, money inputs; "Creators will read" preview and a cost estimate |
| 9 | Form | The application form | built-in rows (locked, or Required / Optional / Hidden), preset chips, "Add a field" by group, field cards, live phone preview |
| 10 | Files | Images, Videos, Documents folders; Drive link; links to posts they like; suggested documents | upload / import into each folder, link inputs, a checklist of what's missing |
| 11 | Look | Cover photo or video; show on the marketplace; taking applications | preview of the branded page, Photos picker, switches |
| 12 | Review | Everything | one card per step with Edit, the go-live checklist, "Save as draft" / "Go live" |

Suggested documents (optional, step 10): brand guidelines, product sheet and prices, logo pack, a script or key
messages, music the company owns, a "how to show the product" guide.

## Data

Migration `20261030100000_creator_campaign_wizard` (applied on TEST). On `CreatorCampaign`: `setupStep` (null when
done; existing campaigns are done), `idea`, `kind`, `goal`, `knowledgeCampaignId` (→ `Campaign`, set null on delete),
`productIds`, `requirements` (Json), `formats`, `platformMode`, `briefEvery`, `dos`, `donts`, `applicationForm` (Json),
`files` (Json), `look` (Json). On `CreatorConnection`: `followers`, `followersAt`. `PayRules.rateViews` (1,000 when
left out; `ratePerThousand` is the price for `rateViews` views).

Campaigns made before the wizard have no `applicationForm`: `readApplicationForm(null, questions)` gives the default
form with their questions as short text fields. New campaigns write `applicationForm` and leave `questions` empty.

## Who builds what

- **Company side** (branch `creators-wizard-company`): the entry chooser in Business info, the menu name, the wizard
  pages and components (`/dashboard/creators/new`, `/dashboard/creators/[id]/setup`), saving each step, the AI
  suggestions, the Files step folders, the Look step, Review and the go-live check, Settings opening the wizard.
- **Creator side** (branch `creators-wizard-creator`): the branded application page `/c/<slug>` with the built form
  and every field type, uploads, reading and checking answers, marketplace one-tap with the form, matching and answers
  on the company's Applicants list, the follower check on connect, and the campaign's files, brief and do's and don'ts
  on the creator portal.

## Company side: what was built (22 October 2026)

- **Entry.** Business info → Campaigns → **New campaign** (`/dashboard/knowledge/campaigns/new`) asks "Who will post
  it?": **My business, on my pages** (`?who=me`, the old form) or **Content creators** (`/dashboard/creators/new`).
  Without the `creators` feature the card says "Add to your plan" (to `/dashboard/upgrade?feature=creators`), or "Not
  in your plan" / "Owners and admins" for people who cannot add it. A Business info campaign's page has **Get creators
  to post it** → `/dashboard/creators/new?from=<id>`: its idea line ("Get people to come to …"), kind, products, and
  its dates when they are still ahead. `?product=<id>` is kept both ways. Menu: **Creator campaigns**.
- **Pages.** Step 1 is `/dashboard/creators/new`; its Next makes the DRAFT and opens `/dashboard/creators/[id]/setup?
  step=2`. Every step: "Step N of 12 · Title", a progress bar, the step list (a row of pills on a phone, a column on
  a computer; steps reached can be opened, all of them when editing), the step's question as the heading, Back / Next
  (both save the step first), and "Suggest again" on steps 2 to 9. A draft opens at most the furthest step it
  reached. Settings shows a card per step with Edit (the same cards as Review) plus the switches it had.
- **Saving** (`saveStep` in `lib/creators/campaigns.ts`, the checks in `lib/creators/wizard-steps.ts` STEP_SCHEMAS):
  each step checks and saves only its own answers and moves `setupStep` to the furthest step reached; Review's "Save
  as draft" and going live set it to null. Old rules stay: dates and currency only while a draft, a platform a live
  task needs cannot be taken off, a task with hand-ins is never deleted, the pay floor (`rateProblem`) and the plan's
  creators per campaign.
- **Going live.** A campaign made with the wizard (`setupStep` or `applicationForm` set) goes live only when
  `readinessProblems` is empty: `goLiveProblems` (photos counted in the campaign's Images and Videos folders) and the
  full `campaignSchema`, each problem with the step to fix it in. Campaigns made before keep the old rule (a task).
  The check runs for DRAFT → LIVE only: resuming a paused campaign is never blocked.
- **AI** (`lib/creators/wizard-ai.ts`, ledger feature `creatorWizard`): one call writes the whole campaign as JSON
  (`aiSuggestionSchema`), with Business info (profile, industry, products promoted and others, Business info
  campaigns, audience, brand voice or the approved voice profile, Instagram handle, language) and the owner's answers
  so far. It goes through `withLedger` (the company allowance and the admin switch), a rate limit of 30 an hour and 60
  a day per company, and a 40-second limit. Its answer is checked value by value (`sanitizeSuggestion`): anything
  missing or wrong comes from the template, the price is never below the floor, TikTok only once it is ready. When the
  AI is not set up, switched off, over the allowance, slow or wrong, the **template of the kind** answers
  (`templateSuggestion`, eight kinds), so the wizard always works. "Suggest again" puts the step's part on screen
  without saving; the brief has its own "Rewrite".

### Decisions made while building

- **Step 1's Next** asks the AI once and makes the draft with every later step filled: goal, creators (5 wanted, or
  fewer on a small plan), networks, formats, mentions (the business's @handle and a short #hashtag), how often a brief
  comes, the brief and its tasks, do's and don'ts, pay (1.5 times the floor per 1,000 views) and 2-3 form fields.
  Saving step 1 again fills only the steps not reached yet that are still empty (the AI is asked only then).
- **New drafts start next Monday** and run the suggested days (30 by the templates), or take the Business info
  campaign's dates when they are ahead (a short one, such as a one-day event, starts up to 13 days before it ends).
- **Posts a day and video or photo (step 5)** have no column of their own: they live on the tasks. While a draft,
  saving step 5 plans the tasks again when their days no longer fit (`tasksMatchSpans`; the texts are kept,
  `taskTexts`) and sets these two on every task. Once live, step 5 changes only how often a brief comes; posts a day
  and media change on each task in step 6.
- **Content while a draft** replaces all tasks with the ones on screen; once live it updates, adds and deletes like
  the Tasks tab, and refuses to delete a task creators handed in. A daily brief is limited to 120 days.
- **Pay method** is shown as a card (Per views / Per post / Milestones / Mix) read from the rules; switching to one
  kind clears the others (caps stay). The cost estimate uses the real pay maths (`computePeriodPay`) for "if each of
  your creators gets 5K / 10K / 50K / 100K views a month". A milestone without both numbers says so in words.
- **Files.** The three folders are made when the owner reaches step 10 (under a lock, once; one is made again if it
  was deleted in Photos), named "<campaign> – Images" etc. with " (2)" on a clash, under 60 characters. Photos only
  takes photos and videos, so **Documents holds photos or screenshots of documents; PDFs go in the shared Drive
  folder** (the page says so). The suggested documents are a checklist ticked on the device only. Uploads and imports
  use the gallery's own upload and Import menu with `folder:<id>`.
- **Look.** The preview uses the logo (signed link from the private "brand" bucket) and the first brand colour; the
  cover is any Photos photo or video (`look.coverAssetId`, checked to be the company's). The Brand page has no font
  yet, so the preview has none.
- **Form builder.** Built-in rows (locked "Always asked", phone and best posts Required / Optional / Hidden), the
  AI's fields as violet chips and the ready-made ones as chips, "Add a field" by group in a sheet, field cards (label,
  help, example, answers, smallest / largest, upload kind, required), move up / down, delete, and a phone preview (at
  the side on wide screens, "See it on a phone" otherwise). Empty answer boxes are dropped before the check.
- **Drafts in the list** show "Draft · step N of 12" with **Continue**; a draft's own pages show the same line.

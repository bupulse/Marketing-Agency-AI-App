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

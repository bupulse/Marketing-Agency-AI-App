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

## Creator side: what was built (22 October 2026)

**The application page `/c/<slug>`** (`app/c/[slug]/page.tsx`, `components/creators/apply/**`):

- In the company's look: its logo and name at the top, `Business.brandColors` as CSS variables (`--brand`,
  `--brand-2`, `--on-brand`, `lib/creators/brand-look.ts`: the first colour fills buttons and picked answers with text
  that passes WCAG AA, the second tints the top), the cover photo or video from `look.coverAssetId` (a `MediaAsset` of
  that company, signed with the server's key, `lib/creators/campaign-files.ts`), and a small "Powered by BuPulse" at
  the bottom. Without brand colours the page keeps BuPulse's blue. **Brand has no font yet**, so the page keeps
  BuPulse's font; a font picked in Brand later only needs a CSS variable here.
- The page also says who the campaign looks for ("Kigali · 1,000+ followers · Kinyarwanda · Food and drinks", with
  "you can apply even if you don't fit everything"), what to post (formats) and the do's and don'ts. The OG image is
  unchanged.
- The form comes from `readApplicationForm(campaign.applicationForm, questions)`: First name, Last name (saved as one
  `name`), Email, WhatsApp as `phone` says, **Social media accounts** (chips of every network; ticking one opens its
  username box with `HANDLE_PLACEHOLDER` and followers, "12k" and "1.5M" accepted; the campaign's own networks are
  marked "This campaign" and listed first; untracked ones say "Coming soon: views not counted yet"; at least one
  account, on any network), best posts as `samples` says, then each field with its control: short and long text,
  radio cards, chips (several choices), a dropdown with a search box above it when it has more than 8 answers, Yes /
  No buttons, number, two money boxes with the currency, scale buttons, date, two dates, upload, link, and the place
  search (`searchPlaces`, free text kept). After an error everything typed stays (the form is keyed by what came back,
  several values per name for chips).
- Form names (`lib/creators/application.ts`): `q_<id>` for every field, `q_<id>.min` / `.max` (money range) and
  `q_<id>.from` / `.to` (dates); the reader is `readApplication(form, { ..., form })` built on `readAnswer()`. Without
  a form (old callers, tests) it reads the form campaigns had before the wizard: one `name` box, best post required,
  the questions as short text.
- Handles are stored as before (`{ network, handle, followers }`), now with any `SocialNetwork`. LinkedIn keeps the
  profile link as typed; the others are cleaned as before.

**Uploads** (`lib/creators/application-uploads.ts`, `startApplicationUpload` in `lib/creators/apply.ts`, action
`startApplicationUploadAction` in `app/c/[slug]/actions.ts`): applicants have no account, so the server hands out one
signed upload URL per file, only for a campaign that is LIVE, taking applications and not hidden, only for an UPLOAD
field of its form, photos or videos as the field's `accept` says, 50 MB at most (Supabase Free). Rate limits: 10
uploads an hour per address (all campaigns, hashed address) and 100 a day per campaign. Files go to the private
`creator-media` bucket at `applications/<campaignId>/<uuid>.<ext>` and are never public: the company opens them
through one-hour signed links ("View file"). On submit (form or one-tap) every UPLOAD answer must match that pattern
for this campaign exactly and the object must exist with an allowed type and size, else "Upload the file again.". The
form waits while a file is still sending.

*Abuse and clean-up:* someone could upload without ever applying. The creator views job's file clean-up
(`cleanupMedia`) now also runs `cleanupApplicationUploads`: uploads no application uses are deleted 2 days after they
were made, and every upload of a campaign 60 days after it ended (or once it is deleted). It looks at 50 campaign
folders a run, 100 files each. The worst case before a clean-up is the per-campaign limit (100 × 50 MB a day), so
watch Storage on the Free plan; lower `UPLOAD_LIMIT_CAMPAIGN` if it is ever abused.

**One-tap** (`lib/creators/quick-apply-form.ts`, `components/creators/portal/quick-apply-form.tsx`): see
docs/CREATOR_MARKETPLACE.md. Decisions: optional questions never block one tap (they are folded); a WhatsApp number
the form does not require does not count as a profile gap; when the form hides the phone or best posts they are not
sent even if the profile has them; edits in the short form are for that application only.

**Applicants and Creators lists** (`lib/creators/applicant-facts.ts` pure, `lib/creators/applicants-view.ts` loader,
read in the two dashboard pages): each answer in words (`answerInWords`) in the form's order, uploads as "View file",
every account with its followers, and the match: facts from the accounts' followers (a connected account's count
replaces the typed one), the "location", "languages" and "niches" preset answers, and a marketplace applicant's profile
location when the form did not ask. "Matches" / "Doesn't match: <reasons>" / "Location not given"; the waiting list
puts matches first, then those who left something out, then those who don't match (newest first within each). A
campaign with no requirements shows no match line.

**Followers check:** an account's follower count is read when it connects and saved on `CreatorConnection.followers` /
`followersAt`: Instagram `followers_count` (`INSTAGRAM_GET_USER_INFO`, own profile), a Facebook Page's
`followers_count`, else `fan_count` (`FACEBOOK_LIST_MANAGED_PAGES` with `fields`; `FACEBOOK_GET_PAGE_DETAILS` later),
TikTok `follower_count` (`/v2/user/info/`, scope `user.info.stats`; without the scope the request is retried with
fewer fields and the account connects with no count). The views job reads it again at most once a week per account,
when it reads that account's posts (one more Composio call, inside the month's budget); a network that gives no count
is not asked again before the week is out. Shown as "12,300 followers · Verified" (what they typed is at most 10%
above the real count) or "Said 20,000 · has 12,300". Checked against the docs (22 October 2026):
developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/get-started (`followers_count`
"The number of followers of the app user's Instagram professional account"), docs.composio.dev/toolkits/instagram
("followers_count and follows_count are returned for your own profile"), developers.facebook.com/docs/graph-api/reference/page
(`followers_count` "Number of page followers"; `fan_count` "For New Page Experience Pages, this field will return
followers_count"), docs.composio.dev/toolkits/facebook (`FACEBOOK_GET_PAGE_DETAILS` fields include `fan_count,
followers_count`), developers.tiktok.com/doc/tiktok-api-v2-get-user-info (`follower_count`, `user.info.stats`).
**Not verified without real credentials:** whether Composio's managed Instagram and Facebook apps return these counts
(a missing value just means no "Verified" line), and the exact TikTok error when `user.info.stats` was not granted (the
code treats any error code mentioning "scope" as "no count"). BuPulse's TikTok auth config asks for `user.info.basic`,
`user.info.profile` and `video.list` only: add `user.info.stats` to it to get TikTok counts.

**Creator portal** (`components/creators/portal/campaign-files.tsx`, `/creator/campaigns/<id>/brief`): a joined
campaign shows "Campaign files": the do's and don'ts, the Images, Videos and Documents folders (100 newest each) with a
preview and Download (signed links that save under the file's name), the Drive link and the posts the company likes.
`campaignKitFor()` checks the creator is JOINED to that campaign on the server (removed creators keep their history
but not the files). The brief page puts the brief, formats, tasks, do's and don'ts, rules and links on one page; the
portal's bar and tabs are hidden in print, so the browser's Print / Save as PDF gives a clean brief.

**Marketplace cards** show the formats and who the campaign looks for under the pay; pay words come from
`payRulesInWords`, which already uses `rateViews`.


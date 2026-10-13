# Autopilot

Autopilot plans next week's posts for a business, writes each one for its network, makes the picture, and leaves the posts ready for the owner to approve in one tap (or schedules them straight away when the owner chose "Post without asking").

The page is `/dashboard/autopilot`. Everything lives in `lib/autopilot/`.

## How a week is made

1. **Cron.** Cloudflare (`AUTOPILOT_CRON` in `worker.ts`, every 3 hours on Fridays and Saturdays) and `.github/workflows/autopilot.yml` call `POST /api/cron/autopilot` (bearer `CRON_SECRET`). `runDueBusinesses` visits enabled businesses in id order after `?cursor=`, skips accounts waiting for deletion and businesses where it is not yet Friday locally, and plans at most 2 per call. The answer has `nextCursor` until every business was reached; the callers loop on it.
2. **Run.** `runAutopilot(businessId)` claims an `AutopilotRun` (unique per business and week, so calling it twice is safe). The week is keyed by its local Monday date stored as midnight UTC, so changing the time zone cannot create a second run. A RUNNING run that went quiet (15 minutes) and saved posts is closed as DONE, never planned again; one with no posts is retaken, plans, writes and saves. The same function serves the "Plan next week now" button through `runAutopilotForUser(userId)`, which resolves the business from the signed-in user.
3. **Plan.** `planWeek` loads what the planner needs (`data.ts`) and `buildWeekPlan` (pure, `planner.ts`) decides.
4. **Write.** One Gemini call per post group (`writer.ts`), recorded in the cost ledger with feature `autopilot`.
5. **Draw.** `visuals.ts` gives the group its visual (`docs/CONTENT_VISUALS.md`): a short carousel when the idea is a list or the product has several photos, else the picture from `images.ts` (`createTemplateDesign`, or `createAiPhotoDesign` when "Use AI images" is on), and a video plan for video ideas when the plan has video.
6. **Save.** One `Post` per chosen account, `source AUTOPILOT`, `status PENDING_APPROVAL` (or `SCHEDULED` with "Post without asking"), with `autopilotRunId`, `playbookId` and a `groupId` shared by the posts of one idea.
7. **Email.** When approval is needed, the owner gets "Your posts for next week are ready. Approve them" through `lib/publishing/email.ts` (Resend).

A group is one idea. The week's `postsPerWeek` counts groups, and each group becomes one post for every connected account the idea suits (a tip becomes an Instagram caption, a Facebook post and a LinkedIn post, each written for its network).

## Playbook (`playbook.ts`)

About 37 proven post types ("ideas"). Each has a goal (awareness, engagement, sales, trust), the industries it suits (soft tags or all), the network and format it uses on each network, a free brand template id plus an English label for the image, the facts it needs (`project`, `faq`, `holiday`, `hours`) and writing guidance.

- Nothing is industry-specific in code beyond tags: `industryTags` maps `Business.industry` to tags such as `food` or `construction`, and an idea with `industries: "all"` suits everyone.
- An idea whose facts are missing is skipped, never invented: no FAQ, no "question we get asked"; no project of the right type, no offer post.
- Customer stories are told from the project facts only. The writer is told never to invent a quote, name or review.
- Formats follow the network rules in `lib/social/*`: LinkedIn gets professional posts and some `ARTICLE` long-form; Instagram and Facebook get image posts and carousels; TikTok and YouTube (and Reels) get `SCRIPT` reminders until Stage 2 video.

To add an idea, add an entry to `IDEAS`. `tests/autopilot/playbook.test.ts` checks the shape (templates exist, formats are allowed on that network, every network has ideas).

## Calendar (`calendar.ts`)

A small offline table with movable-date rules instead of a library. `date-holidays` and similar packages ship megabytes of data, which does not suit a Cloudflare Worker.

- Fixed days and "nth weekday of a month" rules are exact.
- Easter and everything counted from it (Good Friday, Easter Monday, Ascension, Whit Monday, UK Mothering Sunday) use the Gregorian computus.
- Eid, Ramadan, Islamic New Year and Mawlid come from the Umm al-Qura calendar in `Intl`. Real observance depends on the moon sighting and can differ by a day, so they are marked `approximate`.
- Diwali and Holi (lunisolar) are listed for 2026 to 2035; add years to `DIWALI` and `HOLI` when needed.
- Mother's Day and Father's Day follow each country (UK Mothering Sunday, France's last Sunday of May, Spain's 19 March Father's Day, Germany's Ascension, UAE's 21 March and so on).
- Countries: Rwanda, Kenya, Uganda, Tanzania, Nigeria, South Africa, United States, United Kingdom, France, Spain, Germany, India and the United Arab Emirates. Any other country gets the global days only.
- Religious days have `religious: true`; the owner's "Skip religious holidays" switch removes them.
- Remembrance days (`sensitive: true`, for example Kwibuka on 7 April) keep that day quiet: the planner posts nothing that day.

## Learning (`learning.ts`)

From `PostMetrics` of the business's published posts: the engagement rate is `(likes + comments x 2 + saves x 3 + shares x 3)` divided by reach, else views, else a fixed audience of 100, capped at 1. It scores each `playbookId` (shrunk towards the overall mean, so one lucky post does not decide), each network, the best weekdays and the best local hours.

With at least 6 posts with metrics the scores steer the plan: about 70% of picks exploit (one of the best ideas, still weighted) and about 30% explore. Without data it always explores and uses sensible defaults per network (`NETWORK_DEFAULTS`: LinkedIn mornings on Tuesday to Thursday, Instagram midday and evening, TikTok evenings and so on). Ideas used in the last four weeks and goals already in the week are down-weighted, so the week has variety.

`TrendSource` is the interface where live trends (Instagram hashtag search) plug in later. `noopTrendSource` returns nothing; `runAutopilot` accepts a `trends` option and passes up to three trends to the writer.

## Planner (`planner.ts`)

`buildWeekPlan(input)` is pure and seeded by business and week, so it is repeatable and testable.

- Holidays in the week come first, on the day itself (a greeting, or an offer on shopping days when an offer exists), at most one per three posts.
- Every connected network gets at least one post when there is room, and LinkedIn gets an article when there are three or more posts. Video scripts are capped at about a quarter of the plan unless only video accounts are connected.
- Days are spread over the week (posts avoid piling on one day) and lean on each network's best weekdays.
- Times come from the owner's posting times (or learned best hours when confident), in `Business.timezone`, never in the past, and never closer than 2.5 hours to another post on the same account, including posts already scheduled.
- Projects: new, never-posted ones first, each used at most once a week.
- Photos: gallery photos not used recently first, varying folders. Templates only get JPG or PNG photos. A carousel needs two pictures, otherwise it becomes a single image post.

## Credits and cost

- Each AI-written post group costs 1 text credit (`consumeUsage`), refunded in a `finally` unless the group's posts were saved.
- When the plan runs out mid-week, the run stops, keeps what is done and leaves a friendly note on the run (shown on the page).
- AI images use 1 image credit per group (`createAiPhotoDesign`); when image credits run out Autopilot falls back to free templates for the rest.
- All AI calls go through `withLedger` with feature `autopilot`, so the monthly budget cap (`AI_MONTHLY_BUDGET_USD`) applies. When it is reached the run stops with a note.
- "Regenerate this post" rewrites every network's version of one idea for 1 text credit.

## Settings

"Skip religious holidays" is the `AutopilotSettings.skipReligiousHolidays` column; `settings.ts` maps rows to the page's config and back.

Gallery photos used in a template are remembered in `Design.prompt` as `photo:<path>` (that column is unused for template designs), which is how the next plans know a photo was used.

## Cron has no session

`createTemplateDesign` and `createAiPhotoDesign` normally use the signed-in user's Storage client. The cron has none, so `lib/designs/service.ts` takes `service: true` and then uses `lib/supabase/admin.ts` (the service key `SUPABASE_SECRET_KEY`). Ownership is still checked from `userId` and `businessId`; `service` only changes which Storage client is used.

## Security

Every user action starts from the signed-in user's id and works inside that user's business (`manage.ts`, `run.ts`):

- `saveSettings` keeps only connections that belong to the business.
- `approveAll` approves only this business's `PENDING_APPROVAL` Autopilot posts (through `approvePosts`).
- `removeGroup` and `regenerateGroup` look the group up with the user's business in the query, so another user's group id finds nothing.
- Planning and regenerating are rate limited per user.

## Tests

- `tests/autopilot/*.test.ts`: playbook coverage, holidays by country and year, time zones, learning scores, planner distribution and slots, runs (idempotency, credits, refunds, notes), writer prompt and clean-up, images, settings, ownership.
- `tests/ai-eval/autopilot.test.ts` (`npm run ai:eval:autopilot`, needs `GEMINI_API_KEY`, costs a few cents): plans a week for 5 varied businesses (English, French, Spanish, Swahili) and writes every post with the real model, checking each network's rules (LinkedIn professional and long-form, Instagram hashtags, Facebook short, scripts with timestamps), that versions differ, the content language, and that no invented numbers appear.

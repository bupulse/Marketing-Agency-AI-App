# Meta App Review: the owner's checklist

Everything needed to get BuPulse's own Meta app approved so clients can connect Facebook Pages and Instagram
Business/Creator accounts directly (instead of through Composio), with trending sounds on Instagram reels. Written
13 November 2026 against Meta's live docs. Background and older notes: `docs/PLATFORM_APPS.md` section 1.

Do the steps in order and tick each box. Nothing here costs money. Plan 3 to 6 weeks in total (Business Verification
a few days to 2 weeks, App Review about 2 to 3 weeks, one rejection adds about a month).

**Two decisions already made in this checklist**

1. **Submit Facebook Login only.** Meta's Instagram App Review page says an app uses Facebook Login *or* Instagram
   Login for Instagram, not both. Facebook Login covers Facebook Pages and Instagram in one sign-in, and the Instagram
   Audio API (trending sounds) works **only** with Facebook Login. So do **not** request the `instagram_business_*`
   permissions now, and leave `INSTAGRAM_APP_ID` / `INSTAGRAM_APP_SECRET` empty on production: then the main
   Instagram "Connect" button uses Facebook Login automatically (`primaryVariant` in
   `components/connections/types.ts`).
2. **Two submissions.** Submission A = publishing and insights (what every client needs). Submission B = comments and
   DMs, sent after A is approved. The inbox keeps working through BuPulse-Socials (Composio) meanwhile, and a small
   first submission is approved faster.

---

## Step 1. Business Verification (start today, it takes the longest)

- [ ] business.facebook.com → the BuPulse business portfolio → **Settings → Business info**: legal name exactly as on
  the registration certificate (RDB), street address in Kigali, phone, website `https://bupulse.com`, business email
  `hello@bupulse.com`.
- [ ] **Security centre → Start verification**. Upload the RDB registration certificate (or the TIN/VAT certificate)
  and one document with the same legal name and address (bank statement or utility bill). Confirm by email on the
  bupulse.com domain (or by domain verification: Meta gives a DNS TXT record to add in Cloudflare).
- [ ] Same legal name and address everywhere: business portfolio, App settings, the privacy page and terms page. **Today
  the privacy and terms pages say only "BuPulse, Kigali, Rwanda"** (see Step 3). Change that line once the legal name
  and street address are final.
- [ ] If the App Dashboard asks for **Access Verification (Tech Provider)** because BuPulse acts for other
  businesses, complete it there (same documents, a short form about how BuPulse serves its clients).

## Step 2. App settings (App Dashboard → App settings → Basic)

- [ ] **App icon** 1024 × 1024 PNG: the real BuPulse logo mark. The repo only has 500 px versions
  (`public/brand/icon.png`); export a 1024 px one from the original logo file (do not upscale the 500 px PNG).
- [ ] **Display name** BuPulse. **App domains** `bupulse.com`. **Contact email** `hello@bupulse.com`.
- [ ] **Category** Business and pages.
- [ ] **Privacy Policy URL** `https://bupulse.com/privacy`
- [ ] **Terms of Service URL** `https://bupulse.com/terms`
- [ ] **User data deletion**: choose **Data deletion callback URL** and enter
  `https://bupulse.com/api/meta/data-deletion` (built: verifies Meta's `signed_request`, deletes that person's
  Facebook and Instagram connections and tokens, answers with a status URL `https://bupulse.com/data-deletion?code=…`
  and a confirmation code). The instructions page `https://bupulse.com/data-deletion` is live as well.
- [ ] **Website** platform: Site URL `https://bupulse.com`.
- [ ] Facebook Login for Business → Settings:
  - Valid OAuth Redirect URIs: `https://bupulse.com/api/social/facebook/callback` and
    `https://bupulse.com/api/social/instagram/callback` (Instagram "through Facebook" uses the second one).
  - **Deauthorize callback URL** `https://bupulse.com/api/meta/deauthorize`.
- [ ] Use cases: "Manage everything on your Page" and "Manage messaging & content on Instagram" (API setup with
  Facebook login). Add the permissions of submission A to them.
- [ ] App Roles → add the Facebook account that owns the test Page as **Tester** (it must accept the invite).
- [ ] Switch the app to **Live** before submitting.

## Step 3. Public pages (checked live on 13 November 2026)

| Page | Status | What is missing or wrong |
|---|---|---|
| `https://bupulse.com/privacy` | 200, opens signed out | (1) Said "We never post, comment, message … unless you ask us to publish", which contradicts the comments-and-DMs feature, and said nothing about the comments and messages of the people who write to a client's account. **Fixed in code** (section 3 now describes "Answer comments and messages" and trending sounds). (2) No `#deletion` anchor: `/privacy#deletion` landed at the top. **Fixed** (section 8 has `id="deletion"` and a "Data from Facebook and Instagram" paragraph). (3) Operator is only "BuPulse, Kigali, Rwanda": add the registered legal name and street address (owner, Step 1). (4) Mentions Paddle for payments; Rwanda clients pay by MoMo: not a Meta issue, but update when convenient. |
| `https://bupulse.com/terms` | 200 | Same legal name/address gap. Also says Paddle and a 3-day free trial, which no longer match Rwanda (MoMo, free quote). Not Meta-blocking. |
| `https://bupulse.com/data-deletion` | 200 | Good: self-service steps, email request, disconnect a channel, Meta callback, status by code (`?code=` shows "received", "completed" or "could not find"). Instagram's own removal path was wrong ("Business integrations"). **Fixed** (Facebook: Settings & privacy → Settings → Business integrations; Instagram: Settings → Website permissions → Apps and websites). |
| `/privacy#deletion` | Works once the fix is deployed | |
| All three pages | | The email address is hidden by **Cloudflare Email Address Obfuscation**: without JavaScript the page shows "[email protected]". Reviewers use a normal browser so it decodes, but automated checks may not see a contact address. Turn it off in Cloudflare → bupulse.com → Scrape Shield → Email Address Obfuscation (owner, 1 click). |

The fixes are on branch `meta-review-nov13`. They must be deployed (release zip, owner-confirmed) before submitting.

## Step 4. Test accounts for the reviewer

- [ ] A BuPulse company **"BuPulse Review"** on test.bupulse.com: active plan with Content and Channels, onboarding
  finished, Business info filled in, 3 or more products, 10 or more photos in the Gallery, one finished reel in Videos
  (library music on it), and a few posts published a few days earlier (so insights are not empty).
- [ ] Sign-in by email and password, no 2FA, no IP limit; test it from a private window. Put the credentials **only**
  into Meta's form, never in this repository.
- [ ] A Facebook test user (or your own account with the Tester role) that is admin of a real **test Facebook Page**,
  and an **Instagram Business or Creator account linked to that Page**, both with a few real posts. Give the Facebook
  login for that user in the reviewer notes, or use Meta's "Test users" if the form offers it.
- [ ] **Where the reviewer tests.** `SOCIALS_DIRECT` is one switch for the whole server: setting it on bupulse.com
  before approval would send every client to an app only testers can use. So record and let Meta test on
  **test.bupulse.com**, with `SOCIALS_DIRECT=facebook,instagram`, `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET` set there
  and `INSTAGRAM_APP_ID` empty, and the review company created there. Add
  `https://test.bupulse.com/api/social/facebook/callback` and `/api/social/instagram/callback` to the Valid OAuth
  Redirect URIs and `test.bupulse.com` to App domains. Production stays on Composio until Step 9. (Before the app is
  approved, permissions already work for people with a role on the app, so you can record now.)
- [ ] The test site must run a build that has the trending-sounds feature (commit `7fc0beba`, branch
  `worktree-agent-a74651378b90790b8`, not on main on 13 November) and this branch's privacy fixes. Without it, shots
  A2.7 to A2.9 cannot be recorded.
- [ ] Keep the test site and its tunnel running for the whole review (about 3 weeks): reviewers test at any hour.

## Step 5. Submission A: publishing, insights and trending sounds

Ask for exactly these (they are exactly what the code requests: `FACEBOOK_SCOPES` in
`lib/social/providers/facebook.ts`, `INSTAGRAM_VIA_FACEBOOK_SCOPES` in `lib/social/providers/instagram.ts`). The
trending-sound feature needs **no extra permission**: Meta's Audio API page says `GET /ig_audio` and
`audio_configuration` on a REELS container need `instagram_basic` and `instagram_content_publish` through Facebook
Login (only ads audio, which BuPulse does not use, needs more).

| Permission | Code that uses it | Screencast |
|---|---|---|
| `pages_show_list` | `/me/accounts` at connect (list Pages to choose) | A1 |
| `pages_read_engagement` | Page name/picture, reactions, comments count and shares of BuPulse's posts | A1 |
| `pages_manage_posts` | `/{page}/feed`, `/{page}/photos`, `/{page}/videos` | A1 |
| `instagram_basic` | Linked IG account id, username, picture; `GET /ig_audio` trending sounds | A2 |
| `instagram_content_publish` | `/{ig-user-id}/media` (image, carousel, REELS with `audio_configuration`) and `/media_publish` | A2 |
| `instagram_manage_insights` | `/{ig-media-id}/insights` (views, reach, likes, comments, saves) | A3 |

Do **not** request: `business_management` (not used; add it only if a tester's business-owned Page does not appear in
the Page list), `read_insights` (not used), `ads_management`, any `instagram_business_*` (Instagram Login).

**Check in the form:** Meta's permissions reference lists `pages_read_user_content` as a dependency of
`instagram_basic`, and Meta says a dependency must be included in the submission. If the form marks it as required,
include it in submission B instead (comments) and tell the developers, because the Instagram login would then need to
ask for it too.

### What to write for each permission ("How will your app use this permission?")

**pages_show_list**
> BuPulse is a social media assistant for small businesses in Rwanda. When a business owner clicks "Connect" on the
> Channels page and logs in with Facebook, BuPulse lists the Facebook Pages they manage so they can choose the Page
> BuPulse should publish to. We store only the chosen Page's id, name, picture and access token. We never act on a
> Page the owner did not choose.

**pages_read_engagement**
> After a post goes out, BuPulse reads that post's reactions, comment count and shares, and the Page's name and
> picture, so the owner sees in their BuPulse dashboard which Page is connected and how each post performed. We only
> read posts that BuPulse published for the owner. This permission is also required by pages_manage_posts and
> instagram_content_publish.

**pages_manage_posts**
> The owner creates a post in BuPulse (text, photos or a short video, often drafted with AI from the owner's own
> products), approves it and either clicks "Publish now" or picks a date and time. BuPulse then publishes it to the
> owner's chosen Facebook Page as the Page. Nothing is published without the owner's approval, and scheduled posts can
> be edited or cancelled before they go out.

**instagram_basic**
> BuPulse reads the Instagram Business or Creator account linked to the owner's Facebook Page (account id, username and
> profile picture) to show which account is connected and to publish to it. When the owner publishes a reel, BuPulse
> also asks Instagram which trending sounds apps may use (the Instagram Audio API, GET /ig_audio for the owner's own
> account) and shows the chosen sound's name on the post.

**instagram_content_publish**
> The owner creates and approves Instagram posts in BuPulse: photos, carousels and reels with a caption. At the time the
> owner chooses, BuPulse publishes the post to the owner's own Instagram account. For reels, BuPulse adds one of the
> trending sounds Instagram allows apps to use (audio_configuration on the reel), under the reel's own voice-over, and
> the post in BuPulse shows "Trending sound: <title>". Every post is approved by the owner first.

**instagram_manage_insights**
> After a post is published, BuPulse shows its views, reach, likes, comments and saves on the post in the owner's
> dashboard, so the owner can see which posts work best and plan the next ones. We read insights only for the owner's
> own Instagram account and only for posts published through BuPulse.

### Test steps to paste ("Verification details")

> 1. Open https://test.bupulse.com/login in a private window and sign in with the BuPulse credentials below. The account is
>    a small business that has already finished setup.
> 2. In the left menu open **Channels**. Click **Connect** on Facebook. Log in with the Facebook test user below and
>    approve the permissions. Choose the Page "<test Page name>". The Page now shows as connected.
> 3. On Channels click **Connect** on Instagram (it uses Facebook Login). Approve, choose the same Page; the linked
>    Instagram account "@<username>" shows as connected.
> 4. Open **Posts** (Create). Pick a product, click Generate (or type a caption), add a photo from the Gallery, choose
>    the Facebook Page and the Instagram account and click **Publish now**. The post appears on the Page and on the
>    Instagram account within about a minute.
> 5. Open **Videos**, pick the reel "<reel name>", choose the Instagram account and click **Publish now**. Open the
>    post in BuPulse: it shows "Trending sound: <title>". On Instagram the reel plays with that sound.
> 6. Open **Calendar** (or Posts → Published) and open a post from a few days ago: its likes, comments, reach and
>    saves (Instagram) or reactions, comments and shares (Facebook) are shown.

## Step 6. Screencast shot list (submission A)

Rules for every video: real BuPulse screens and real accounts only (no mock-ups, no AI-drawn screens), app in
English, 1080p, mouse visible, under 3 minutes, captions on screen in English (or a clear English voice-over).
Start signed out, in a fresh private window, at `https://test.bupulse.com/login` (Step 4). The Facebook consent screen must be
visible in full. Cut waiting time but keep a visible clock when you schedule.

**A1. Facebook Page publishing** (pages_show_list, pages_read_engagement, pages_manage_posts)

| # | Screen | Do | Say / caption |
|---|---|---|---|
| 1 | test.bupulse.com/login | Sign in with the review account | "This is BuPulse, a social media assistant for small businesses. I sign in as a business owner." |
| 2 | Dashboard → Channels | Point at Facebook, click Connect | "The owner connects their Facebook Page on the Channels page." |
| 3 | Facebook login + consent | Log in, show the permission list, Continue | "Facebook asks to show the Pages I manage and publish to the Page I choose." |
| 4 | Page chooser in BuPulse | Choose the test Page | "pages_show_list: BuPulse lists my Pages so I choose one." |
| 5 | Channels | Page connected with name and picture | "pages_read_engagement: BuPulse shows the Page's name and picture." |
| 6 | Posts → Create | Generate a caption from a product, add a Gallery photo, choose the Page, Publish now | "pages_manage_posts: I approve the post and publish it to my Page." |
| 7 | facebook.com, the Page | Show the new post live | "The post is now on the Page." |
| 8 | BuPulse, the post opened (an older post) | Show reactions, comments, shares | "pages_read_engagement: BuPulse reads the results of its own posts." |

**A2. Instagram publishing with a trending sound** (instagram_basic, instagram_content_publish)

| # | Screen | Do | Say / caption |
|---|---|---|---|
| 1 | Channels | Click Connect on Instagram | "Instagram connects through Facebook Login." |
| 2 | Facebook consent | Show the Instagram permissions, choose the Page whose Instagram account is linked | "The Instagram Business account is linked to this Page." |
| 3 | Channels | "@username" connected with picture | "instagram_basic: BuPulse reads the account's username and picture." |
| 4 | Posts → Create | Photo + caption, choose Instagram, **Schedule** 2 minutes ahead | "instagram_content_publish: I schedule a photo post." |
| 5 | Calendar | Clock visible, post turns Published | "At the chosen time BuPulse publishes it." |
| 6 | Instagram app or instagram.com | The photo post is live | "It is on my Instagram account." |
| 7 | Videos | Open a reel, choose Instagram, Publish now | "Now a reel." |
| 8 | The post in BuPulse | Show "Trending sound: <title>" | "instagram_basic and the Instagram Audio API: BuPulse picked a trending sound Instagram allows apps to use." |
| 9 | Instagram, the reel | Play it with sound, tap the sound name | "The reel is live with that trending sound under the voice-over." |

**A3. Instagram insights** (instagram_manage_insights)

| # | Screen | Do | Say / caption |
|---|---|---|---|
| 1 | Posts → Published (or Calendar) | Open an Instagram post from a few days ago | "instagram_manage_insights: results of a post BuPulse published." |
| 2 | Post detail | Show views, reach, likes, comments, saves | "The owner sees which posts work best." |
| 3 | Instagram app → that post → View insights | Same numbers (roughly) | "The numbers come from Instagram." |

Insights with zeros get rejected: use a post with real reach.

**A4. Removing access and data (optional, helps)**
Channels → Disconnect on the Page → open `https://bupulse.com/data-deletion` and `https://bupulse.com/privacy#deletion`;
say "Disconnecting deletes the tokens; removing BuPulse in Facebook settings sends us a deletion request and the person
gets a confirmation code they can check here."

## Step 7. Submission B: comments and direct messages (after A is approved)

These are asked for only when Admin → Services → Instagram and Facebook replies is on **Meta direct**
(`inboxScopesFor` in `lib/social/inbox/scopes.ts`); today's sign-ins do not ask for them. Webhooks setup:
`docs/SOCIAL_INBOX.md` "Changing over to Meta direct".

| Permission | Used for |
|---|---|
| `pages_manage_metadata` | Subscribing the Page to webhooks (`/{page}/subscribed_apps`) for new comments and messages |
| `pages_read_user_content` | Reading the comments people leave on the Page's posts (needed by pages_manage_engagement) |
| `pages_manage_engagement` | Replying to those comments as the Page (`POST /{comment-id}/comments`) |
| `pages_messaging` | Reading and answering Messenger conversations people start with the Page |
| `instagram_manage_comments` | Reading and replying to comments on the Instagram account's posts (`/{comment-id}/replies`) |
| `instagram_manage_messages` | Reading and answering Instagram Direct messages people send the account |

`pages_read_user_content` and `pages_manage_engagement` were added to the Facebook inbox scopes on this branch: the
Facebook comment reply needs them (Meta's comments reference: "pages_manage_engagement" and a Page token with the
MODERATE task). Do **not** ask for the Human Agent feature now; ask later only if the team often answers after 24 hours.

**Texts**

- **pages_manage_metadata**: "When the owner switches on 'Answer comments and messages' for their Page in BuPulse, we
  subscribe that Page to webhooks so new comments and Messenger messages reach the owner's BuPulse inbox within
  seconds. Switching it off stops it."
- **pages_read_user_content**: "BuPulse shows the comments people leave on the owner's Page posts in the owner's
  inbox, with the commenter's name and the comment text, so the owner or their team can answer. Only comments on the
  owner's own Page, only after the owner switched the feature on."
- **pages_manage_engagement**: "From the BuPulse inbox the owner (or an automation the owner set up, or the AI
  assistant whose replies the owner can review) replies to a comment as the Page. BuPulse never comments anywhere
  else."
- **pages_messaging**: "People message the business's Page on Messenger to ask about prices or hours. The messages
  appear in the owner's BuPulse inbox and the owner, their team or the AI assistant answers within 24 hours. BuPulse
  only answers conversations the person started; it never sends marketing messages."
- **instagram_manage_comments**: "Comments on the owner's Instagram posts appear in the BuPulse inbox and the owner
  answers them there; replies are posted under the comment from the owner's account."
- **instagram_manage_messages**: "Instagram Direct messages sent to the owner's business account appear in the BuPulse
  inbox and are answered from there by the owner, their team or the AI assistant, within Instagram's messaging window."

**Test steps**: sign in → Channels → turn on **Answer comments and messages** under the Page and the Instagram account
→ from a second (tester) account, comment on a post and send a DM → in BuPulse open **Inbox**: both appear → reply to
each → show the reply on facebook.com / Instagram.

**Screencast B1 (Facebook) and B2 (Instagram)**, same rules as above:

| # | Screen | Do | Say / caption |
|---|---|---|---|
| 1 | Channels | Turn on Answer comments and messages; consent screen shows the new permissions (reconnect) | "The owner switches on answering comments and messages." |
| 2 | Phone with a second account | Comment on the Page / IG post, send a DM | "A customer asks a question." |
| 3 | BuPulse → Inbox | Comment and DM arrive with name and text | "pages_read_user_content / pages_messaging (instagram_manage_comments / instagram_manage_messages): the owner sees them." |
| 4 | Inbox conversation | Type or approve the AI reply, send | "pages_manage_engagement: the owner answers from BuPulse." |
| 5 | Facebook / Instagram | The reply is under the comment and in the chat | "The customer gets the answer." |
| 6 | Channels | Turn the switch off | "Switching off stops it." |

## Step 8. Submit

- [ ] App Review → Requests → Edit → add submission A's six permissions. For each: paste the text, upload the
  matching screencast (A1 for the three Page permissions, A2 for instagram_basic and instagram_content_publish, A3 for
  insights), tick the allowed-usage box.
- [ ] Verification details: paste Step 5's test steps with both sets of credentials.
- [ ] Each permission must have at least one successful API call in the last 30 days (the dashboard shows it): do one
  connect, one Page post, one Instagram post and one insights view with the app the day before submitting.
- [ ] Submit, then watch the business email for questions. If rejected: fix only what the reviewer names, record
  again, resubmit.

## Step 9. After approval

- [ ] Production env: `SOCIALS_DIRECT=facebook,instagram`, `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET` set,
  `INSTAGRAM_APP_ID`/`INSTAGRAM_APP_SECRET` **empty** (so Instagram connects through Facebook). Restart the server.
- [ ] Ask every client with Facebook or Instagram to **reconnect through Facebook** (Channels → the account →
  Reconnect). Existing Composio connections keep working until then, but only Facebook Login connections get trending
  sounds (and, after submission B, the Meta-direct inbox).
- [ ] Post one test reel to the test Instagram account. Open the post in BuPulse: it must show
  **"Trending sound: <title>"**. Open the reel on Instagram and check the sound plays under the voice-over. If it shows
  the reel with library music instead, the sound was refused: check the logs for the `/ig_audio` or media error.
- [ ] Post one photo to a Facebook Page and one to Instagram from a real client account (with their OK).
- [ ] After submission B is approved: Admin → Services → Instagram and Facebook replies → Change route → **Meta
  direct**, then clients reconnect once more so their tokens carry the inbox permissions (`docs/SOCIAL_INBOX.md`).

## Common rejection reasons (avoid)

- A permission requested that no screencast shows being used.
- A test account that fails in a fresh browser, needs 2FA or lands on onboarding.
- Insights screens with zeros.
- Different legal names or addresses between the business portfolio, the app and the privacy page.
- Vague texts ("to improve our app"). Say exactly what the owner does and sees.
- A privacy policy that contradicts a feature (fixed for comments and messages on this branch).

Sources (checked 13 November 2026): developers.facebook.com/docs/instagram-platform/content-publishing/audio-api,
developers.facebook.com/docs/permissions, developers.facebook.com/documentation/instagram-platform/app-review,
developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback,
developers.facebook.com/docs/graph-api/reference/object/comments.

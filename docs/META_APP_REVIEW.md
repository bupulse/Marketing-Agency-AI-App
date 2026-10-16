# Meta App Review pack

Everything to submit for Facebook and Instagram publishing once BuPulse is live on bupulse.com. Background, rules and
timings are in `docs/PLATFORM_APPS.md` section 1. Cost: $0. Plan 3 to 6 weeks in total.

**Blocker first:** real customers need **Advanced Access**, which needs **Business Verification** (legal-entity
documents). BuPulse is not registered yet (owner decision, October 2026). Until it is, only people with a role on the
app (you and testers) can connect, and clients use reminders plus copy-and-post. Prepare everything below now so the
submission can go out the day verification is approved.

## 1. Before you submit (checklist)

- [ ] bupulse.com is live with HTTPS, and these pages open without signing in:
  - `https://bupulse.com/privacy` (mentions Facebook and Instagram data and how to delete it)
  - `https://bupulse.com/terms`
  - `https://bupulse.com/data-deletion`
- [ ] Facebook app → App settings → Basic:
  - Privacy Policy URL, Terms of Service URL, app icon (1024 × 1024), category "Business and pages"
  - Data deletion callback URL: `https://bupulse.com/api/meta/data-deletion`
  - Deauthorize callback URL: `https://bupulse.com/api/meta/deauthorize`
- [ ] Instagram app settings: the same two callback URLs.
- [ ] Valid OAuth redirect URIs:
  - `https://bupulse.com/api/social/facebook/callback`
  - `https://bupulse.com/api/social/instagram/callback`
- [ ] Business Verification approved (Business settings → Security centre).
- [ ] App switched to **Live** mode.
- [ ] Reviewer account ready (section 4) and tested from a private browser window.
- [ ] One real Facebook Page and one Instagram **Business** account linked to it, both with a few real posts, added as
  app testers.

## 2. Permissions and what to write for each

Request only these. They are exactly what the code asks for (`lib/social/providers/facebook.ts`, `instagram.ts`).
Submit all of them in one submission.

| Permission | Used for |
|---|---|
| `pages_show_list` | Listing the Pages the user manages so they pick which one BuPulse posts to |
| `pages_read_engagement` | Reading the Page's basic details and post engagement for the dashboard |
| `pages_manage_posts` | Publishing the posts the user writes and schedules in BuPulse to their Page |
| `instagram_basic` | Reading the linked Instagram Business account's id, username and media |
| `instagram_content_publish` | Publishing the user's scheduled photos and captions to Instagram |
| `instagram_manage_insights` | Showing reach and engagement of published posts in BuPulse |
| `instagram_business_basic`, `instagram_business_content_publish`, `instagram_business_manage_insights` | The same three, for the Instagram Login connection (no Facebook Page needed) |

### Text to paste (adapt the wording if Meta's form asks a specific question)

**pages_show_list**
> BuPulse is a marketing assistant for small businesses. After the business owner clicks "Connect Facebook", we list
> the Facebook Pages they manage so they can choose which Page BuPulse should publish to. We store only the chosen
> Page's id, name and access token. We never post to a Page the user did not choose.

**pages_read_engagement**
> We read the chosen Page's name and picture to show which Page is connected, and the reactions, comments count and
> reach of posts BuPulse published, so the owner sees in one dashboard how their posts perform. We do not read
> private messages or other users' data.

**pages_manage_posts**
> The owner writes a post in BuPulse (text and photo, often drafted with AI from their own products), picks a date and
> time, and approves it. At that time BuPulse publishes it to the owner's chosen Page. Nothing is published without
> the owner's approval, and the owner can edit or cancel a scheduled post before it goes out.

**instagram_basic**
> We read the Instagram Business account linked to the owner's Page (id, username, profile picture) to show which
> account is connected and to publish to it. We read the account's own published media only to show results of posts
> published through BuPulse.

**instagram_content_publish**
> The owner creates and approves Instagram posts (photo and caption) in BuPulse and schedules them. At the scheduled
> time BuPulse publishes the post to the owner's own Instagram Business account. Every post is approved by the owner
> first.

**instagram_manage_insights**
> After a post is published, BuPulse shows its reach, likes, comments and saves in the owner's dashboard so they can
> see which posts work best. We read insights only for the owner's own account.

## 3. Screencast scripts

Record at 1080p, captions on screen (or narrate in English), each under 3 minutes, real data visible. Start every
video signed out, in a fresh browser window, at `https://bupulse.com/login`.

**Video A: Facebook Page publishing (covers pages_show_list, pages_read_engagement, pages_manage_posts)**
1. Sign in with the reviewer account. Caption: "Reviewer test account, already onboarded."
2. Dashboard → **Channels** → **Connect Facebook**.
3. Facebook login and consent screen: show every permission listed, click Continue.
4. Choose the test Page → back in BuPulse the Page shows as connected (name and picture).
5. **Content** → write a short post (or generate one from a product in the Knowledge base) → add a photo from the
   Gallery → choose the Facebook Page → **Publish now**.
6. Open the Page on facebook.com in a second tab: the post is live.
7. Back in BuPulse: **Calendar** shows the post as Published; open it to show its engagement numbers.

**Video B: Instagram publishing and insights (covers instagram_basic, instagram_content_publish, instagram_manage_insights)**
1. Sign in → Channels → **Connect Instagram through Facebook** → consent screen → choose the Page whose Instagram
   Business account is linked.
2. BuPulse shows the Instagram username as connected.
3. Content → create a post with a photo → choose Instagram → **Schedule** 2 minutes ahead → wait (cut the wait in
   editing, keep the clock visible) → the Calendar shows Published.
4. Open the Instagram account (app or web): the post is live with the same caption and photo.
5. In BuPulse open the post → insights (reach, likes, comments, saves). Use a post that is a few days old if the new
   one shows zeros; empty insights get rejected.

**Video C: Instagram Login (only if you submit the instagram_business_* permissions)**
Same as Video B, but click **Connect Instagram** (Instagram Login, no Facebook Page needed) and log in on instagram.com.

**Video D: Removing data (optional but helps)**
Channels → Disconnect; then show `https://bupulse.com/data-deletion` and explain that removing the app in Facebook
settings also deletes the connection (deauthorize callback).

## 4. Reviewer test account and instructions

- Create a company "BuPulse Review" with an **active** plan that includes Content and Channels (admin → Start trial
  with 30 days, or an active custom plan), onboarding finished, a few products in the Knowledge base and photos in the
  Gallery.
- Sign-in: email + password (no 2FA, no IP restriction). Put the credentials only into Meta's form, never in this
  repository.
- Instructions to paste:
  > 1. Go to https://bupulse.com/login and sign in with the credentials above.
  > 2. Open Channels in the left menu and click Connect Facebook (or Connect Instagram).
  > 3. Log in with the test Facebook user (app tester) and approve the permissions; choose the test Page.
  > 4. Open Content, write a post or click "Generate" on a product, add a photo, choose the Page or Instagram account
  >    and click Publish now.
  > 5. The post appears on the Page/Instagram account. Open Calendar → the post → to see its engagement.

## 5. Common rejection reasons (avoid)

- Asking for a permission the videos don't show being used.
- Test account that fails from a fresh browser, needs 2FA, or lands on onboarding.
- Insights screens with no data.
- Legal name or address that differs between the app settings, the privacy page and Business Verification.
- Vague explanations ("to improve the app"). Say exactly what the user does and sees.

If rejected: read the reviewer notes, fix only what they name, record again, resubmit (about a month extra).

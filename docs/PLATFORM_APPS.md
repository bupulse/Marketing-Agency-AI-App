# BuPulse developer apps: registration and review guide

Written 6 October 2026 for Phase 0. Plain English. Do the steps in order.

Rules used in this file:
- "Verified" means I read it on the official page listed in that section.
- "Unverified" means I could not confirm it. Check it on the day you do the step.
- Everything below costs $0, except where it says COST.
- Contact email for all forms: bupulse.office@gmail.com now. Switch to hello@bupulse.com when it exists. Reviewers dislike free-mail addresses on some platforms (LinkedIn needs a business email), so create hello@bupulse.com before LinkedIn.

---

## 0. Read this first: three surprises

1. **YouTube changed its limits.** The plan says "about 6 uploads a day". That is out of date. Since 1 June 2026 each project gets 100 `videos.insert` calls per day, 1 unit each, in its own bucket. See section 4.
2. **TikTok posts are private until the audit passes**, and posts made before the audit stay private for good. Do not onboard real TikTok customers before the audit passes. See section 2.
3. **Meta review now takes about 20 days** when it goes well, and one rejection adds roughly a month. See section 1.

---

## 1. Meta (Instagram and Facebook Pages)

### Which login to use

Meta has two ways to publish to Instagram.

| | Instagram Login | Facebook Login (for Business) |
|---|---|---|
| Needs a Facebook Page linked to the Instagram account | No | Yes |
| Publish to Instagram Business and Creator accounts | Yes | Yes |
| Publish to Facebook Pages | **No** | **Yes** |
| Read insights | Yes | Yes (more detail, e.g. account insights) |
| Token type | Instagram user token | Facebook Page token |

**Recommendation: use Facebook Login (for Business) as BuPulse's main app.** One login covers Instagram and Facebook Pages, and BuPulse needs both. Optionally add Instagram Login later for owners who have no Facebook Page. This is my recommendation, not a Meta rule.

Sources: https://developers.facebook.com/docs/instagram-platform/content-publishing (verified table of differences), https://bundle.social/blog/instagram-graph-api (third-party summary).

### What to register

1. Go to https://developers.facebook.com and log in with a Facebook account that will own BuPulse long-term. Use a business account, not a personal one if you can avoid it.
2. Create a Meta Business portfolio for BuPulse at https://business.facebook.com (legal name, address, website bupulse.com, phone).
3. Create an app. Type: Business (or "Other / Business"). Add the products "Facebook Login for Business" and "Instagram" (API setup with Facebook Login).
4. In App Settings > Basic fill in: app name, privacy policy URL, terms URL, app icon 1024x1024, category, contact email, and **User data deletion** (see below).
5. Connect the app to the Business portfolio, then start Business Verification.

### What the code implements (as built)

BuPulse uses **both** logins, because Instagram Login needs no Facebook Page:

| Connection | Login | App keys (env) | Scopes requested |
|---|---|---|---|
| Instagram (default, "Professional") | Instagram API with Instagram Login | `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET` (the Instagram app ID and secret under Instagram > API setup with Instagram login) | `instagram_business_basic`, `instagram_business_content_publish`, `instagram_business_manage_insights` |
| Instagram "through Facebook" (secondary link) | Facebook Login | `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET` | `pages_show_list`, `pages_read_engagement`, `instagram_basic`, `instagram_content_publish`, `instagram_manage_insights` |
| Facebook Pages | Facebook Login | `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET` | `pages_show_list`, `pages_read_engagement`, `pages_manage_posts` |
| Instagram "Personal" | none (reminder posting, no API) | none | none |

`read_insights` is not requested: Facebook likes, comments and shares come from the post itself. The Graph API version is the constant `GRAPH_VERSION` in `lib/social/graph.ts`. A Connect button shows only when the keys for that network are set; otherwise the page says "Coming soon". `META_APP_SECRET` (older name) is still accepted when verifying `signed_request`.

### Redirect URIs (Valid OAuth Redirect URIs)

Built from `NEXT_PUBLIC_SITE_URL` + `/api/social/<network>/callback`. Register exactly:

- Instagram Login (Instagram product > API setup with Instagram login > Business login settings > OAuth redirect URIs): `https://bupulse.com/api/social/instagram/callback`
- Facebook Login (Facebook Login > Settings > Valid OAuth Redirect URIs), for both Pages and "Instagram through Facebook": `https://bupulse.com/api/social/facebook/callback` **and** `https://bupulse.com/api/social/instagram/callback`
- Staging: the same two paths on `https://staging.bupulse.com`.
- Development: `http://localhost:3000/api/social/instagram/callback` and `/facebook/callback` (Meta allows localhost for apps in development mode; unverified for the exact current rule).

### Permissions to request

For Facebook Login:

| Permission | Why | Needs review |
|---|---|---|
| `pages_show_list` | List the Pages the user manages | Yes |
| `pages_read_engagement` | Read Page content and basic Page insights; dependency of the others | Yes |
| `pages_manage_posts` | Create, edit, delete Page posts, photos, videos | Yes |
| `instagram_basic` | Read the linked Instagram account and its media | Yes |
| `instagram_content_publish` | Publish photos, videos, reels, carousels to Instagram | Yes |
| `instagram_manage_insights` | Read Instagram insights (views, reach, likes, saves) | Yes |
| `business_management` | Only if the Page is owned by a Business portfolio and listing fails without it. Ask for it only if you truly need it. Extra permissions cause rejections | Yes |

For Instagram Login (only if you add it): `instagram_business_basic`, `instagram_business_content_publish`, and `instagram_business_manage_insights` (name from search results; unverified on the official page). The old names without "instagram_" were retired on 27 January 2025.

Sources: https://developers.facebook.com/docs/permissions (verified: each permission, its dependencies and what the review asks), https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login (verified scope names).

### Access levels and Business Verification

- Standard Access only works for people with a role on your app (you and your testers). It needs no review.
- **Advanced Access** is needed for real customers. It needs App Review and **Business Verification**.
- Business Verification: you upload legal-entity documents (registration certificate, utility bill or bank statement with the legal name and address) and confirm by email, phone or domain. Names and addresses must match everywhere. Timing is not stated on Meta's page; community reports say a few days to 2 weeks (unverified).
- Meta may also ask for **Tech Provider** (Access Verification) status because BuPulse acts on behalf of other businesses. Verify in the App Dashboard when prompted (unverified whether required for this permission set).

Source: https://developers.facebook.com/docs/development/release/business-verification (verified: process, no timings), https://bundle.social/blog/meta-app-review-20-days (third-party, July 2026).

### Instagram account rules (tell customers)

- Instagram account must be **Business or Creator**, not personal.
- With Facebook Login the Instagram account must be linked to a Facebook Page.
- Some Pages need "Page Publishing Authorization (PPA)" before API publishing works. Tell users to complete it first.
- Images must be **JPEG**. Media must be on a public URL when you publish.
- Limit: **100 API-published posts per 24 hours** per account (Meta pages disagree, some say 50). Read it live from `/{ig-id}/content_publishing_limit`.
- Containers expire after 24 hours: create the container at publish time, not at scheduling time.

Source: https://developers.facebook.com/docs/instagram-platform/content-publishing (verified).

### Privacy policy and data deletion

- Privacy policy URL: `https://bupulse.com/privacy` (must be public, no login, mention Meta data, how users delete it).
- Data deletion: choose ONE of these in App Settings > Basic:
  - **Data deletion request callback URL**: `https://bupulse.com/api/meta/data-deletion` (built). Meta POSTs a `signed_request`; BuPulse verifies it (HMAC-SHA256 with the Facebook or Instagram app secret, Web Crypto), deletes that person's Facebook and Instagram connections and tokens, records the request, and answers `{ "url": "https://bupulse.com/data-deletion?code=<code>", "confirmation_code": "<code>" }`. Set the same URL in both the Facebook app (App settings > Basic) and the Instagram app settings.
  - Or **instructions URL**: `https://bupulse.com/data-deletion` explaining step by step how to delete.
  Recommended: do both (the page and the endpoint).
- Also set a **Deauthorize callback URL**: `https://bupulse.com/api/meta/deauthorize` (built; removes the person's connections when they remove the app in Facebook or Instagram).
- How a connection is matched to Meta's `user_id`: each connection stores a `meta_uid:<id>` entry in `Connection.scopes` (no schema change). Instagram Login connections also match on their own account id. Unverified until tested with real keys: that the `user_id` Meta sends in the Instagram app's callbacks equals the `user_id` returned at login.
- Public instructions page (built): `https://bupulse.com/data-deletion` (also shows request status for `?code=`).
- Exact callback format: the official page returned 404 for me, so confirm at https://developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback (unverified URL).

### App Review: what to submit

For EACH permission, Meta asks for:
1. A written explanation of why you need it, for other businesses' accounts.
2. A **screencast** (screen recording) showing the whole flow: log in to BuPulse, click Connect, Meta login and consent screen, choose the Page or Instagram account, then the feature working. For publishing: write a post in BuPulse, publish, then show it live on Instagram/Facebook. For insights: show real post metrics in the BuPulse dashboard.
3. Step-by-step test instructions and **test credentials** (a BuPulse reviewer account, already onboarded). No 2FA or IP blocks on that account.
4. A test Instagram Business account and Facebook Page that reviewers can use (add them as app testers, or give working logins).

Screencast tips (rejection reasons reported in 2026): vague notes, permissions requested without a feature that uses them, poor recordings, test accounts that fail from a fresh browser, mismatching legal names. Narrate or add captions. Keep each video under a few minutes. Use real posts and real data on screen (empty insights get rejected).

Source: https://developers.facebook.com/docs/permissions (verified), https://bundle.social/blog/meta-app-review-20-days.

### Cost and timing

- Cost: $0.
- Business Verification: days to 2 weeks (unverified).
- App Review: Meta itself warns about up to about 20 days; 9 to 12 days seen in April 2026; one rejection adds about a month. Plan 3 to 6 weeks total.
- Put the app in **Live mode** (not development) before submitting the final review; some permissions can only be tested when live.

### Gotchas

- Do not request `instagram_manage_comments`, messaging or ads permissions in Stage 1. Ask only for what the screencast shows.
- Submit all publishing permissions in one submission so reviewers see the whole story.
- Long-lived tokens last about 60 days; refresh before expiry (built: `/api/cron/social-refresh`, daily via `.github/workflows/social-refresh.yml`, refreshes anything expiring within 7 days; Instagram Login tokens only refresh once they are 24 hours old). Page tokens obtained from a long-lived user token do not expire (unverified for current rules).
- Reviewers need BuPulse to work with sign-up; give them a pre-made account because sign-up is gated by email links.

---

## 2. TikTok (Content Posting API and Login Kit)

### What to register

1. Create a developer account at https://developers.tiktok.com and a Manage apps > Create app (type: Web).
2. Fill in app name, icon, category, description, **Terms of Service URL** (`https://bupulse.com/terms`) and **Privacy Policy URL** (`https://bupulse.com/privacy`), website URL.
3. Add products: **Login Kit** and **Content Posting API**.
4. In Content Posting API, turn on **Direct Post** (otherwise only upload-to-inbox works).
5. Verify your domain `bupulse.com` (and any media/CDN domain) in the portal if you will use `PULL_FROM_URL`. Not needed for `FILE_UPLOAD`.

### Redirect URIs

- `https://bupulse.com/api/social/tiktok/callback`
- Development: TikTok does **not** accept `http://localhost` (verified: redirect URIs must be HTTPS, static, no query or fragment, under 512 characters, at most 10 per app; https://developers.tiktok.com/doc/login-kit-web). Use an HTTPS tunnel (e.g. Cloudflare Tunnel) or `https://staging.bupulse.com/api/social/tiktok/callback`, and set the same URL as the redirect URI in the app.

### Request these scopes and products
Products: **Login Kit** and **Content Posting API** (enable Direct Post in the Content Posting API settings). Scopes in code: `user.info.basic,video.publish,video.upload`. Env: `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`.

### What the code does (lib/social/providers/tiktok.ts)
- OAuth: authorize at `https://www.tiktok.com/v2/auth/authorize/`, tokens at `https://open.tiktokapis.com/v2/oauth/token/` (access token 24 hours, refresh token 365 days, refresh may return a new refresh token), profile via `/v2/user/info/` (name and avatar), revoke via `/v2/oauth/revoke/`.
- Stage 1 posts are SCRIPT reminders; the publisher never calls publish for them.
- Photo carousels (`/v2/post/publish/content/init/`, PHOTO, PULL_FROM_URL, up to 35 photos) are implemented but advertised in `rules.formats` only when `TIKTOK_PHOTO_POSTING=true`. Reason: TikTok only pulls from a verified domain or URL prefix, and signed Supabase storage URLs cannot be verified. Set the flag once images are served from a verified `bupulse.com` path (verify the prefix in the TikTok portal under URL properties).
- Privacy is the constant `TIKTOK_PRIVACY_LEVEL = "SELF_ONLY"`: unaudited apps can only post privately. Change it after the audit passes.
- Verified against the docs: error codes `access_token_invalid`, `scope_not_authorized` (auth), `rate_limit_exceeded`, `spam_risk_too_many_posts`, `reached_active_user_cap` (rate limit), `url_ownership_unverified`, `unaudited_client_can_only_post_to_private_accounts`, `privacy_level_option_mismatch` (rejected post).
- Not verifiable without real keys: accepted image formats for photos (the docs do not list them), and whether Direct Post is enabled before the audit for a brand-new app.

### Scopes

| Scope | Use |
|---|---|
| `user.info.basic` | Name and avatar for the connection card (Login Kit). Verified: read-only avatar and display name |
| `video.publish` | Direct Post to the creator's profile. Needs app approval and user consent |
| `video.upload` | Send a video to the creator's TikTok **inbox/drafts**; the creator finishes and posts inside TikTok |
| `user.info.stats`, `video.list` | Optional, for metrics (views, likes). Request only if the review video shows them (unverified exact names; check portal) |

Sources: https://developers.tiktok.com/doc/content-posting-api-get-started (verified), https://developers.tiktok.com/doc/login-kit-manage-user-access-tokens (verified), https://developers.tiktok.com/doc/content-posting-api-reference-upload-video (verified).

### Direct Post versus upload to inbox

| | Direct Post (`video.publish`) | Upload to inbox (`video.upload`) |
|---|---|---|
| Where it lands | Posted on the profile | Draft in the creator's TikTok app inbox |
| User has to open TikTok | No | Yes, tap the notification and finish |
| Audit needed to be public | **Yes** | Not stated on the page (unverified) |
| Limits | Unaudited: max 5 users per 24 hours, accounts must be private, posts forced to `SELF_ONLY`. All clients: about 15 posts per creator per day | 6 init requests per minute per user; at most 5 pending shares per 24 hours |

**Plan for BuPulse:** ship TikTok first as "send to drafts" (works for everyone, no audit), then switch on direct posting once the audit passes.

Sources: https://developers.tiktok.com/doc/content-sharing-guidelines (verified), https://bundle.social/blog/tiktok-api-approval (third-party, July 2026).

### The audit

- Stage 1, product access: usually days. Posts work but are private.
- Stage 2, **Direct Post audit**: weeks, variable. Submitted through the app's review form with a **demo video**.
- Your demo video and UI must follow TikTok's rules:
  - Call `creator_info` first and build the composer from it (privacy options, comments/duet/stitch toggles, max video length). Skipping this fails the audit.
  - No default privacy: the user must choose the privacy status.
  - Title field, interaction settings, commercial-content disclosure toggles (Your brand / Branded content), and a preview before posting.
  - Do not add BuPulse watermark, logo or promotion on the video.
  - Show the full flow: login, consent screen, composer, successful post.
- Cost: $0.
- **Gotcha:** posts made while unaudited stay private forever. Tell early testers.

### What reviewers need

Working test account, demo video (uploaded in the form), URLs for terms and privacy, a short description of each scope, an estimate of daily active creators (the form uses it for your daily cap).

---

## 3. LinkedIn

LinkedIn has two separate products for posting.

### 3a. Share on LinkedIn (member's own profile)

- What it gives: scope `w_member_social` (post as a person). Plus "Sign In with LinkedIn using OpenID Connect" (`openid`, `profile`, `email`) to learn who connected.
- How to get it: create an app at https://www.linkedin.com/developers/apps, go to the Products tab and add **Share on LinkedIn** and **Sign In with LinkedIn using OpenID Connect**. Both are self-serve (no manual review) as of the docs; confirm on the day (unverified timing).
- Rate limits: 150 requests per member per day, 100,000 per app per day.
- Source (verified): https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/share-on-linkedin

### 3b. Community Management API (company pages)

Needed to post to a **company page** (scopes such as `w_organization_social` and `rw_organization_admin`; names unverified on the official page I read) and to read page analytics.

Steps:
1. Create the app and associate it with a **LinkedIn Company Page for BuPulse**. A **super admin of that Page must verify the app** (the app settings page generates a verification link).
2. Add the **Community Management API** product and fill the access request form.
3. **Development tier** is reviewed for: approved use case, verified business email, verified organization, website and domain, and Page verification. Personal email addresses fail. LinkedIn says it is only for **registered legal organizations with commercial use cases**.
4. If rejected you cannot re-apply with that app: create a new app.
5. After Development tier works, request **Standard tier** from the Products tab. You must provide: company and product overview, use case description, **test credentials**, privacy policy, and a **screencast** (high resolution, downloadable, narrated).

Screencast for "Page Management" use cases must show:
- the full OAuth flow where a user approves access to their LinkedIn Page;
- a user posting to their Page from BuPulse;
- how a member's comment on that post is displayed in BuPulse, and which commenter profile fields you show;
- any other feature using member data.
For "Page Analytics": show post performance (reactions) and engaging-member data if displayed.

Limits:
- Development tier: **500 calls per app per day and 100 per member per day**; batch-get calls and social-action webhooks disabled; meant for testing, expect to finish within about 12 months.
- Standard tier: production, no such caps (limits still apply per endpoint).

Sources: https://learn.microsoft.com/en-us/linkedin/marketing/community-management-app-review (verified), development tier limits from https://learn.microsoft.com/en-us/linkedin/marketing/increasing-access (via search result, partly unverified).

### Redirect URIs
- `https://bupulse.com/api/social/linkedin/callback`
- `http://localhost:3000/api/social/linkedin/callback` (the docs only say "add the redirect URL via HTTPS" and that URLs must be absolute with no `#`; whether http localhost is accepted is unverified, so use the staging HTTPS URL if the portal rejects it). Redirect URLs are added in the app's Auth tab.

### What the code does (lib/social/providers/linkedin.ts)
- Env: `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`. Two variants through `variant`: `member` (scopes `openid profile w_member_social`, products Share on LinkedIn and Sign In with LinkedIn using OpenID Connect) and `organization` (scopes `w_organization_social r_organization_social rw_organization_admin`, product Community Management API; the connecting member must be a Page ADMINISTRATOR).
- LinkedIn invalidates a member's earlier tokens when the same app is authorized with a different scope set (verified in the authorization code flow doc). So both variants request the same union of scopes once `LINKEDIN_COMMUNITY_MANAGEMENT=true` (set it after the Community Management API product is approved; before that only the member scopes are requested and Page connections answer "No LinkedIn Pages available"). The member id is saved as a `li_member:<id>` scope entry, and `saveConnections` copies the newest token to every other LinkedIn connection of the business from the same member.
- Posts API (`POST /rest/posts`) with headers `Linkedin-Version: 202609` (constant `LINKEDIN_VERSION`; bump before LinkedIn retires it) and `X-Restli-Protocol-Version: 2.0.0`. Text, link (article card), one image and multi-image (2 to 20). Images go through `POST /rest/images?action=initializeUpload`, then a PUT of the bytes with the member's token.
- Commentary uses LinkedIn's "little" format, so reserved characters are backslash-escaped and hashtags become `{hashtag|\#|tag}`.
- ARTICLE cannot create a native newsletter article through the API, so it publishes as a long-form post: title, blank line, text. 3000 characters maximum.
- Tokens last 60 days. Refresh tokens exist only for approved Marketing Developer Platform partners (365 days); without one `refresh` throws an `auth` error and the connection layer should mark the connection EXPIRING near the 60-day expiry.
- Metrics: Page posts only, via `organizationalEntityShareStatistics` (impressions, unique impressions, likes, comments, shares). Member post analytics need `r_member_social`, which LinkedIn restricts to approved apps, so members get no metrics.
- Not verifiable without real keys: the `ugcPosts=List(...)` form of the statistics query (the docs show `shares=List(...)` and an indexed form for ugcPosts), whether the `article` content needs a thumbnail, and the token revoke endpoint (not found in the docs, so `revoke` is not implemented).

### Cost and timing
- Cost: $0.
- Share on LinkedIn: minutes to a day (unverified).
- Community Management Development tier: no official time; reports say days to a few weeks (unverified). Standard tier: weeks (unverified).

### Gotchas
- Do not use "Linked", "In" or LinkedIn logos in the app name or logo.
- Marketing API version 202510 is shut down on 15 October 2026. Use the newest versioned APIs (header `Linkedin-Version`) from day one.
- Changing app functionality after review can trigger a re-review.
- Because this needs a legal entity, **BuPulse must have its legal entity details ready** (name, registered address, website, privacy policy).

---

## 4. Google and YouTube Data API v3

### What to register

1. Go to https://console.cloud.google.com, create a project "BuPulse".
2. APIs and Services > Library: enable **YouTube Data API v3** (and later Google Picker API for Drive, section 5).
3. OAuth consent screen (now "Google Auth Platform"): user type External, app name BuPulse, logo, support email, home page `https://bupulse.com`, privacy policy `https://bupulse.com/privacy`, terms, authorized domain `bupulse.com`.
4. Verify `bupulse.com` in **Google Search Console** with an Owner or Editor account.
5. Credentials > Create OAuth client ID > Web application.

### Redirect URIs
- `https://bupulse.com/api/social/youtube/callback`
- `http://localhost:3000/api/social/youtube/callback` (Google allows http localhost)
- `https://staging.bupulse.com/api/social/youtube/callback`

### What the code does (lib/social/providers/youtube.ts)
- Env: `GOOGLE_YOUTUBE_CLIENT_ID`, `GOOGLE_YOUTUBE_CLIENT_SECRET` (a separate OAuth client from the Supabase Google sign-in).
- Authorize with `access_type=offline` and `prompt=consent` so Google returns a refresh token every time. Scopes `youtube.upload` and `youtube.readonly`. Channels come from `channels.list?part=snippet&mine=true` (1 quota unit).
- Refresh uses `https://oauth2.googleapis.com/token`; Google keeps the same refresh token. A revoked or expired one (`invalid_grant`) is an `auth` error.
- Publish always throws `invalid` in Stage 1. Metrics: `videos.list?part=statistics&id=...` (views, likes, comments; 1 quota unit). 403 `quotaExceeded` is a `rate_limit`, not an auth failure.
- Use `https://bupulse.com/api/connections/google-drive/callback` for Drive (section 5). Keep them separate so scopes are requested separately.

### Scopes
- Upload: `https://www.googleapis.com/auth/youtube.upload` (verified). This is a **sensitive** scope.
- Basic channel info: `https://www.googleapis.com/auth/youtube.readonly` (sensitive; unverified exact sensitivity).
- Analytics: `https://www.googleapis.com/auth/yt-analytics.readonly` (sensitive; unverified). Only add if Stage 1 shows analytics.
- Also `openid email profile` for sign-in (non-sensitive).

Source: https://developers.google.com/youtube/v3/guides/auth/server-side-web-apps (verified).

### Sensitive scope verification
Google's page says it typically takes **3 to 5 business days** once everything is correct. Requirements (verified):
- Public home page (no login), not a Play Store or Facebook link.
- Privacy policy on the **same domain** as the home page, saying how Google user data is accessed, used, stored, shared (add the Google API Services User Data Policy "Limited Use" statement).
- Domain verified in Search Console.
- **Brand verification** first (logo, name). The result is valid for 7 days; publish within that time.
- **Demo video** uploaded to YouTube as Unlisted: the full OAuth consent flow in English, with the OAuth client ID visible in the browser address bar, and showing how each sensitive scope is used (upload a video from BuPulse).
- Written justification for each scope.
- While unverified, only 100 test users can sign in and they see a warning screen. Add testers in the consent screen.

Source: https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification (verified).

### Quota: the real numbers (changed in 2026)

| Item | Value | Source |
|---|---|---|
| Default quota per project | 100 `videos.insert` calls per day, 100 `search.list` calls per day, 10,000 units per day for all other methods | https://developers.google.com/youtube/v3/determine_quota_cost (verified, page updated 2026-09-15) |
| Cost of a video upload | 1 unit from its own bucket (limit 100 uploads/day for the whole project) | same, and https://developers.google.com/youtube/v3/revision_history (verified: changes of 4 Dec 2025 and 1 Jun 2026) |
| Older figure | About 1,600 units per upload (the "10,000 units, about 6 uploads" in the plan) | Plan text is out of date |

So BuPulse can upload about **100 videos per day across all customers** until quota is raised. That is enough for beta. A hidden "uploads per day" 429 error has been reported even with quota left (https://github.com/googleapis/google-api-python-client/issues/2753, unverified). Keep a queue and back off.

### Unverified-project lock (important)
Videos uploaded by an API project **created after 28 July 2020 that has not passed the compliance audit are forced to private**. Source (verified): https://developers.google.com/youtube/v3/revision_history. So even with OAuth verification, customers' YouTube uploads will be private until the **YouTube API Services audit** is passed. (If you want public uploads, the audit is required, not just the quota increase.)

### Request more quota and pass the audit
1. Make sure the app follows the YouTube API Services Terms and Developer Policies (https://developers.google.com/youtube/terms/api-services-terms-of-service): show a link to the YouTube Terms of Service in BuPulse, let users revoke access, do not store data longer than allowed, delete data on request.
2. Submit the **"YouTube API Services - Audit and Quota Extension Form"**: https://support.google.com/youtube/contact/yt_api_form (link per Google docs; confirm).
3. A YouTube API team member contacts you "as soon as possible" (no stated timeline; community reports weeks; unverified).
4. If it fails, use the Appeals form. After a pass within 12 months you can use the same form for more quota.
Source: https://developers.google.com/youtube/v3/guides/quota_and_compliance_audits (verified).

### Cost and timing
- Cost: $0.
- OAuth verification: 3 to 5 business days after a clean submission (often longer after rejections).
- YouTube audit: weeks (unverified).

### Gotchas
- Start the audit in Phase 0; it is the slowest Google item.
- Use refresh tokens; keep the app status "In production" (apps left in "Testing" make refresh tokens expire after 7 days).
- Each Google scope request should be minimal; do not add Drive or Gmail scopes to the YouTube client.

---

## 5. Other connectors

### 5a. Google Drive

- Use the **`https://www.googleapis.com/auth/drive.file`** scope plus the **Google Picker API**. `drive.file` is classed **non-sensitive** (basic OAuth verification only) and gives access only to files the user picks or the app creates. Source (verified): https://developers.google.com/workspace/drive/api/guides/api-specific-auth
- Avoid `drive` and `drive.readonly`: they are **restricted** scopes needing a security assessment if data is stored on a server, which is expensive. (The assessment can cost thousands of dollars: COST, unverified amount.)
- Setup: same Google project as section 4 (or a second one). Enable Google Drive API and Google Picker API. Create an API key restricted to `bupulse.com` for the Picker.
- Redirect URIs: `https://bupulse.com/api/connections/google-drive/callback` and `http://localhost:3000/api/connections/google-drive/callback`.
- Review: basic OAuth verification, brand verification, privacy policy; demo video of picking a file and importing it.
- Time: days to about 1 week (unverified). Cost: $0.
- Gotcha: files must be picked in BuPulse; BuPulse cannot browse the whole Drive. That is the point.

### 5b. Dropbox

- Register: https://www.dropbox.com/developers/apps > Create app > Scoped access > App folder or Full Dropbox (prefer **App folder**; fewer questions). Scopes: `files.metadata.read`, `files.content.read` (and `account_info.read` if needed).
- Redirect URIs: `https://bupulse.com/api/connections/dropbox/callback`, `http://localhost:3000/api/connections/dropbox/callback` (Dropbox allows http localhost; unverified).
- Development status: only your own account until it links users; **at 50 linked users you have 2 weeks to get production approval or linking freezes**. Up to 500 users total in development. Source (verified): https://docs.dropboxapi.com/dropbox-api/docs/developer-resources/developer-guide
- Production approval: in the App Console, press Apply for production and describe how the app uses the API, upload an icon, follow the branding guide (do not imply Dropbox endorses you). You can ask for early review before 50 users with evidence.
- Gotcha: **you cannot change the app name after approval.** Choose it carefully, e.g. "BuPulse".
- Cost: $0. Time: not stated; community says days (unverified).

### 5c. Canva Connect API

- Register: https://www.canva.com/developers (Developer Portal) > Your integrations > Create integration (Connect API / "Public" or "Private").
- Two types (verified): **Public** integration (any Canva user) must pass Canva's review. **Private** integration is only for your own team and **requires a Canva Enterprise plan**. For BuPulse customers you need Public. Source: https://canva.dev/docs/connect/submitting-integrations
- Auth: OAuth 2.0 with PKCE (SHA-256); token calls must come from your backend. Source (verified): https://www.canva.dev/docs/connect/authentication/
- Redirect URIs: `https://bupulse.com/api/connections/canva/callback`. For development Canva may require `http://127.0.0.1:3000/...` instead of `localhost` (unverified; check the portal).
- Scopes (names unverified, check the portal list): design read (`design:meta:read`, `design:content:read`), asset read/write (`asset:read`, `asset:write`), `profile:read`. Ask for read-only scopes for "import designs".
- Review: you submit the integration for review with listing text, media, links, **test account credentials and testing instructions**. Keep external links out of descriptions. After submission it is locked until the review ends. Brand-guidelines compliance needed. Preview APIs cannot be used in public integrations. Source: https://www.canva.dev/docs/connect/submission-checklist/ (verified).
- Plan needed to create an integration: not stated in the pages I read (unverified). MFA on your Canva account is typically required (unverified).
- Cost: $0 (unverified for plan). Time: no stated time; "varies" (verified).
- Gotcha: some endpoints (e.g. autofill, brand templates) need the end user to be on a paid or Enterprise Canva plan (unverified). For Stage 1, import designs and export PNGs only.

### 5d. Shopify

- Two real options (verified, https://shopify.dev/docs/apps/launch/distribution):
  - **Public app** (App Store listing): installable on many stores; needs Shopify review.
  - **Custom app**: single store or stores inside one Plus organization; no review. Not usable for many unrelated customers.
  - An unlisted multi-store app is **not** allowed.
- So BuPulse needs a **public app**.
- Register: create a free Partner account at https://partners.shopify.com, create an app (Dev Dashboard). Test on a free **development store** (Partners > Stores).
- COST: one-time **$19 USD** to register for App Store distribution (verified via https://help.shopify.com/en/partners/partner-program/glossary and https://shopify.dev/docs/apps/launch/distribution/revenue-share). Revenue share only matters if you charge through Shopify (we do not).
- Redirect URI: `https://bupulse.com/api/connections/shopify/callback`; dev `http://localhost:3000/api/connections/shopify/callback` (Shopify allows this for dev; unverified). Install URL needs the shop domain, so the Connect button asks for `mystore.myshopify.com`.
- Scopes: `read_products` only (plus `read_inventory` if needed). Request the least. Product import reads title, price, photos, description.
- Review (verified): only production-ready apps are reviewed. Must install and reinstall without errors, OAuth must work, billing flow must be right (we have none; say so), app listing complete. Required: **mandatory privacy webhooks** `customers/data_request`, `customers/redact`, `shop/redact` (unverified on the pages I read, but long-standing Shopify rule). Source: https://shopify.dev/docs/apps/launch/app-store-review/pass-app-review
- Time: not stated; community reports about 1 to 3 weeks with resubmissions (unverified).
- Gotcha: App Store apps normally must be embedded in the Shopify admin; a standalone app that only imports data may get questions. Describe it clearly, or ask Shopify support before building (unverified).
- Fallback to ship earlier: ask the first merchants for a **custom app Admin API token** (Settings > Apps > Develop apps) and paste it into BuPulse. No review. Only for beta; it is a clunky flow.

### 5e. WooCommerce

- **There is no central app to register.** Each store owner creates REST API keys in their own store.
- Two ways:
  1. Manual: store admin goes to WooCommerce > Settings > Advanced > REST API > Add key (Read permission), and pastes the consumer key and secret into BuPulse.
  2. Guided: send the user to `https://<their-store>/wc-auth/v1/authorize` with `app_name=BuPulse`, `scope=read`, `user_id=<BuPulse business id>`, `return_url=https://bupulse.com/connections/woocommerce/done`, `callback_url=https://bupulse.com/api/connections/woocommerce/callback`. WooCommerce POSTs the keys to the callback (callback must be HTTPS).
- Needs WooCommerce 3.5+, WordPress 4.4+, pretty permalinks, HTTPS store (verified). Source: https://woocommerce.github.io/woocommerce-rest-api-docs/#authentication
- Callback URL for BuPulse: `https://bupulse.com/api/connections/woocommerce/callback`. Development: use a tunnel, because the store posts to this URL from the internet.
- Review: none. Cost: $0. Store the secret encrypted and use read-only keys.
- Gotcha: many stores have security plugins or firewall rules that block the API; give a clear error message.

### 5f. Cloudflare

- **Option A, user API token (works today):** user creates a token in the Cloudflare dashboard with `Zone: Read` (and `DNS: Read`/`Edit` if you later install the widget script via DNS or Workers). Pastes it into BuPulse. Source (verified): https://developers.cloudflare.com/fundamentals/api/get-started/create-token/
- **Option B, OAuth for third-party apps (new in 2026):** Cloudflare now has self-managed OAuth clients, on all plans (Free, Pro, Business, Enterprise). Create one at Dashboard > Manage account > OAuth clients. Clients start **private** (only your own account's members). To make an app **public** (any Cloudflare user) you must meet prerequisites including **publisher domain verification**. Scope names match API token permission names. Sources (verified): https://developers.cloudflare.com/fundamentals/oauth/ , https://developers.cloudflare.com/changelog/post/2026-06-03-public-oauth-clients/
- Redirect URIs for Option B: `https://bupulse.com/api/connections/cloudflare/callback` and `http://localhost:3000/api/connections/cloudflare/callback` (redirect rules not stated on the pages I read: unverified).
- Review process for going public: not stated: unverified. Cost: $0.
- Recommendation: build Option A first (zero wait), add Option B when public clients are approved. Scope in Stage 1: read zones only.

---

## 6. What BuPulse must have live before submitting

Put every item on production `https://bupulse.com` (not staging) and open each link in a private window to check no login is needed.

Checklist:
1. **Public home page** at `https://bupulse.com` that clearly describes the product (Google rejects a login-only or vague home page).
2. **Privacy policy** at `https://bupulse.com/privacy`. It must name every platform whose data we handle, say what we store (encrypted tokens, posts, metrics), how long, how to delete, and include Google's "Limited Use" wording and a contact email.
3. **Terms of service** at `https://bupulse.com/terms`.
4. **Data deletion page** at `https://bupulse.com/data-deletion` (step-by-step instructions) and **endpoint** `https://bupulse.com/api/meta/data-deletion` (Meta callback with signed_request, returns a confirmation code and status URL). Also a deauthorize callback.
5. **In-app "Delete my account"** that removes all tokens and data (Phase 2 already plans it).
6. **Logo**: 1024x1024 PNG square, plus a 512x512 and a 120x120 version; no trademark of other platforms in it.
7. **Support email** that works and is a company address: hello@bupulse.com (create it before LinkedIn).
8. **Company details**: legal entity name, registered address, phone, registration certificate, website, matching spelling everywhere (Meta and LinkedIn compare these).
9. **LinkedIn Company Page** for BuPulse with a super admin.
10. **A working reviewer login**: email + password (not an email link, since reviewers cannot read your inbox). Needs a "reviewer login" bypass or a password account, onboarded, with a sample brand and connections ready. Disable 2FA for it. Keep it alive for 90 days.
11. **Working production flows** that the screencasts show: sign-in, connect account, compose, publish, view metrics. The reviewers test the live app.
12. **Test accounts on each network**: an Instagram Business account linked to a Facebook Page, a TikTok account, a LinkedIn profile and Page, a YouTube channel (verified phone, so it can upload), a Dropbox account, a Shopify development store, a WooCommerce test store.
13. **Screencasts** recorded per platform (script them; a separate task). 1080p, narrated or captioned, in English.
14. **Domain verified** in Google Search Console and TikTok portal, and DNS records set on Cloudflare.
15. **Scope justification text** for each permission (one short paragraph each).
16. **Secrets and security**: HTTPS everywhere, tokens encrypted, the deauthorize and deletion endpoints tested.

---

## 7. Do this first (ordered)

1. **Today:** create hello@bupulse.com, finish the legal entity details and company documents, make the LinkedIn Company Page, start the Meta Business portfolio and **Business Verification** (longest unknown).
2. **Today:** create all developer accounts: Meta, TikTok, LinkedIn, Google Cloud, Dropbox, Canva, Shopify Partner ($19 at registration), Cloudflare OAuth client (private).
3. **Within 2 days:** get privacy, terms, data-deletion pages live on bupulse.com (can be simple first, then reviewed by a lawyer); verify the domain in Google Search Console and TikTok.
4. **Day 3:** LinkedIn: add Share on LinkedIn and Sign In (instant), submit the **Community Management Development tier** form.
5. **Day 3:** Google: finish OAuth consent screen, submit brand verification, then submit sensitive-scope verification (youtube.upload) with a demo video. Submit the **YouTube API audit and quota form** right after.
6. **Week 1:** Dropbox: build the connector, apply for production approval early. Cloudflare: use API tokens for now.
7. **Weeks 1 to 2:** once the publishing flows work on staging with a reviewer account, record Meta and TikTok screencasts and submit **Meta App Review** (all publishing and insights permissions together) and **TikTok Direct Post audit**.
8. **Weeks 2 to 3:** Canva integration review; Shopify app review (after install flow works on a development store).
9. **After Development tier works:** LinkedIn Standard tier with screencast.
10. WooCommerce needs nothing; ship it any time.

---

## 8. Quick reference: lead times and money

| Item | Typical wait | Money |
|---|---|---|
| Meta Business Verification | Days to about 2 weeks (unverified) | $0 |
| Meta App Review | About 2 to 4 weeks, +1 month per rejection | $0 |
| TikTok product access / Direct Post audit | Days / weeks | $0 |
| LinkedIn Share on LinkedIn | Instant (unverified) | $0 |
| LinkedIn Community Management dev tier / standard | Days to weeks (unverified) | $0 |
| Google OAuth sensitive scope verification | 3 to 5 business days | $0 |
| YouTube API audit (public uploads, more quota) | Weeks (unverified) | $0 |
| Google Drive (`drive.file`) | Basic verification, days | $0 (avoid restricted scopes: assessment costs real money) |
| Dropbox production | Days (unverified) | $0 |
| Canva public integration | Not stated | $0 (plan requirement unverified) |
| Shopify public app | 1 to 3 weeks (unverified) | **$19 one-time** |
| WooCommerce, Cloudflare tokens | None | $0 |

## 9. Source list

- Meta: https://developers.facebook.com/docs/instagram-platform/content-publishing , https://developers.facebook.com/docs/permissions , https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login , https://developers.facebook.com/docs/development/release/business-verification , https://bundle.social/blog/meta-app-review-20-days
- TikTok: https://developers.tiktok.com/doc/content-posting-api-get-started , https://developers.tiktok.com/doc/content-sharing-guidelines , https://developers.tiktok.com/doc/content-posting-api-reference-upload-video , https://developers.tiktok.com/doc/login-kit-manage-user-access-tokens , https://bundle.social/blog/tiktok-api-approval
- LinkedIn: https://learn.microsoft.com/en-us/linkedin/marketing/community-management-app-review , https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/share-on-linkedin
- Google and YouTube: https://developers.google.com/youtube/v3/determine_quota_cost , https://developers.google.com/youtube/v3/revision_history , https://developers.google.com/youtube/v3/guides/quota_and_compliance_audits , https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification , https://developers.google.com/workspace/drive/api/guides/api-specific-auth
- Dropbox: https://docs.dropboxapi.com/dropbox-api/docs/developer-resources/developer-guide
- Canva: https://canva.dev/docs/connect/submitting-integrations , https://www.canva.dev/docs/connect/submission-checklist/ , https://www.canva.dev/docs/connect/authentication/
- Shopify: https://shopify.dev/docs/apps/launch/distribution , https://shopify.dev/docs/apps/launch/app-store-review/pass-app-review , https://shopify.dev/docs/apps/launch/distribution/revenue-share
- WooCommerce: https://woocommerce.github.io/woocommerce-rest-api-docs/#authentication
- Cloudflare: https://developers.cloudflare.com/fundamentals/oauth/ , https://developers.cloudflare.com/changelog/post/2026-06-03-public-oauth-clients/ , https://developers.cloudflare.com/fundamentals/api/get-started/create-token/

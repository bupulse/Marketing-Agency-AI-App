# Sign-up, onboarding and account states

How a new business gets from the public site to a working dashboard, and every "state" an account can be in on the
way: signing up, confirming the email, giving the organisation details, setting up the brand, choosing the plan to
try and starting the free trial, the trial itself, and the screens for suspended accounts, teammates who arrive too
early, and people invited to join a team.

**Page:** `/signup`, `/login`, `/welcome`, `/onboarding`, `/start-trial`, `/account/waiting`, `/suspended`,
`/invite/[token]`  **Plans:** every plan. Nobody starts on a plan at sign-up: the company chooses the plan to try and
starts the free trial itself, with no demo call. The trial gives that plan's features with the trial's limits.

## What you see

**Sign-up** (three steps: email, organisation details, password and consent):

![The sign-up page](../images/public/signup.jpg)

**Brand set-up (onboarding)**, four steps: what you sell, your voice, your look, business information:

![Onboarding step for a new account](../images/states/onboarding.jpg)

**Start your free trial** (`/start-trial`), one screen: choose the plan you want to try, then **Start my free trial**.
The dashboard opens straight away.

(No screenshot of the new screen yet.)

**During the trial** the normal dashboard opens with a banner that counts the days left:

![Dashboard during the free trial](../images/states/trial-home.jpg)

What each screen shows:

- **Sign-up.** Step 1 asks for the email; an address that already has an account is sent straight to sign in. Step 2
  asks for the organisation name, the owner's name, the business sector (from the admin's list), the country, a
  phone and a website (optional). Step 3 asks for the password twice and the terms. Then "check your email" with a
  resend button. A security check (Cloudflare Turnstile) appears when it is set up.
- **Login.** Email and password, or **Continue with Google**; links to forgot password and sign up.
- **About your organisation (`/welcome`).** Only for people who signed up with Google: the same organisation details
  as sign-up step 2. The country can only be set once.
- **Set up your brand (`/onboarding`).** Step 1: what you sell and who buys it. Step 2: the brand voice. Step 3: logo
  and colours (can be skipped). Step 4: opening hours, head office address and a WhatsApp or phone number (needed),
  other locations, contacts and FAQs. If the person leaves, they come back to the first unfinished step.
- **Choose the plan you want to try (`/start-trial`).** The plans sold in the company's region, with that region's
  prices (and the card price in dollars where it differs), and a line: "Try it free for (days) with this plan's
  features, no card needed. Your trial starts as soon as you tap the button; you can change plan later." The plan the
  pricing-page quiz suggested is already selected. **Start my free trial** starts the trial at once and opens the
  dashboard. Until then, every dashboard link comes back to this screen.
- **Your free trial starts soon.** A teammate who is not the owner or an admin sees this on `/start-trial`: the owner
  or an admin chooses the plan and starts the trial, and the dashboard opens for everyone.
- **An invoice instead of a trial.** If the BuPulse team sent an activation invoice, the dashboard shows the invoice and
  how to pay it instead of the trial screen.
- **Trial banner.** Days left, then "Your trial has ended — choose a plan to keep creating" (read-only from then on).
- **Waiting for your company owner (`/account/waiting`).** A teammate who signs in before the owner has finished
  set-up.
- **Your account is suspended (`/suspended`).** Nothing can be used or published; data is kept.
- **Join (company) (`/invite/[token]`).** The invited email and role, a name and password form; or a message that the
  link is not valid, already used or expired (invitations last 7 days). Someone already signed in is asked to sign
  out first: a person can belong to one company only.

## Video

<video src="../videos/public-signup.webm" controls muted width="100%"></video>

[Watch the clip](../videos/public-signup.webm)

## How to use it

New business owner:

1. Open the site and click **Sign up** (or **Continue with Google** on the login page).
2. Enter your email, then your organisation details, then a password. Tick the terms and finish.
3. Open the confirmation email and click the link. (Google sign-ups skip this and fill in `/welcome` instead.)
4. Set up your brand in four steps. Step 4 needs opening hours, the head office address and a phone or WhatsApp.
5. Choose the plan you want to try and tap **Start my free trial**. The trial starts at once (no demo call, no card)
   and the dashboard opens. You get a "your trial has started" email.
6. Pay from **Billing** whenever you are ready, before the trial ends (see
   [Billing, plans and usage](17-billing-plans-and-usage.md)).

BuPulse team (admin console):

1. Clients start their own trial. For a company that has not started yet, you can also start it from the company's
   page with **Start trial** (it uses the plan the client chose, unless you pick another one sold in their region, and
   you can set the length). The client gets an email.
2. Or skip the trial and send an activation invoice; the client sees the invoice on their dashboard.
3. **Admin → Demos** still lists the demos booked before 22 October 2026. When such a client starts their trial, a
   demo that is still to come is cancelled and they are told the call is no longer needed.

Invited teammate:

1. Open the link in the invitation email.
2. Enter your name and a password, twice. You are signed in and the dashboard opens.

## Limits and settings

- **Trial length:** Admin → Settings, `trial.days` (default 3). Start trial accepts 1 to 90 days.
- **Trial limits:** the TRIAL plan in Admin → Plans (seed: 10 texts, 5 images, one 30-second sample video, 600 voice
  characters, 50 chat replies, 1 user). Features come from the chosen plan.
- **Trial end:** an hourly job sends "ends tomorrow" (24 hours before) and "ends today" (8 hours before) emails to
  clients without a card, then marks the trial ended and emails "Your free trial has ended". Card trials are left to
  Paddle.
- **Who can start it:** the owner or an admin of the company (the settings permission). Starting the trial is
  limited to 10 tries an hour per company.
- **Rate limits:** sign-up, the "is this email registered" check and resend emails are limited per address.
- **Region:** set once from the sign-up country; it decides prices and payment methods. Only an admin can change it.
- **Seats:** an invitation counts against the plan's users (Starter 1, Business 3).

## For developers

### Where it lives

| Part | Where |
|---|---|
| Pages | `app/signup/page.tsx`, `app/login/page.tsx` (`app/login/LoginForm.tsx`), `app/forgot-password/page.tsx`, `app/reset-password/page.tsx`, `app/welcome/page.tsx`, `app/onboarding/page.tsx`, `app/start-trial/page.tsx` (`app/book-demo/page.tsx` only redirects there), `app/account/waiting/page.tsx`, `app/suspended/page.tsx`, `app/invite/[token]/page.tsx` |
| Server actions | `app/signup/actions.ts` (`checkEmail`, `signUp`, `resendConfirmation`), `app/login/actions.ts` (`signInWithPassword`, `signInWithGoogle`), `app/welcome/actions.ts` (`saveOrganisation`), `app/onboarding/actions.ts` (`saveOffer`, `saveVoice`, `saveLook`, `saveKnowledge`, `createLogoUpload`, `finishOnboarding`), `app/start-trial/actions.ts` (`startTrialAction`), `app/invite/[token]/actions.ts` (`acceptInviteAction`) |
| Auth routes | `app/auth/confirm/route.ts` (email links), `app/auth/callback/route.ts` (Google), `app/auth/signout/route.ts` |
| Components | `components/auth/signup-form.tsx`, `components/auth/welcome-form.tsx`, `components/auth/turnstile-field.tsx`, `components/onboarding/onboarding-wizard.tsx`, `components/onboarding/onboarding-shell.tsx`, `components/brand-profile/steps.ts` (the four brand steps, shared with the Brand page), `components/trial/plan-choice.tsx`, `components/app/invoice-lock.tsx` (`InvoiceLock`), `components/app/trial-banner.tsx` (`TrialBanner`) |
| Logic | `lib/account.ts` (`ensureAccount`, `findAccountByEmail`, `allowGoogleSignIn`), `components/app/context.ts` (`getAppContext`, the redirects), `lib/auth/require-user.ts` (`requireActiveUser`), `lib/auth/schemas.ts`, `lib/trial/start.ts` (`beginTrial`, `startOwnTrial`), `lib/demo/limits.ts` (`demoLimited`), `lib/demo/bookings.ts` (demos booked before 22 October), `lib/demo/trial-reminders.ts` (`processTrialReminders`), `lib/admin/demos.ts` (`startTrial`, `listDemos`, `setDemoStatus`), `lib/invoices/service.ts` (`openInvoiceOf`, `createActivationInvoice`), `lib/team/service.ts` (`previewInvite`, `acceptInvite`), `lib/region.ts` (`regionFromCountryName`), `lib/region-check.ts` (`noteRegionMismatch`), `lib/region-prices.ts` (`companyPlans`), `lib/widget/turnstile.ts` (`verifyTurnstile`), `lib/request-limits.ts` (`publicLimited`) |
| Database | `User`, `Business`, `Membership`, `Subscription` (`status` `PENDING_DEMO` / `TRIALING` / `ACTIVE` / `PAST_DUE` / `CANCELED` / `EXPIRED`, `chosenPlan`, `trialEndsAt`), `DemoBooking`, `AdminAvailability`, `Invite`, `PlanDefinition` (TRIAL) |
| API routes | `app/api/demo/ics/[token]/route.ts` (calendar file), `app/api/admin/google-calendar/connect/route.ts` and `callback/route.ts` (the team's Google Calendar for demo events) |
| Cron jobs | `app/api/cron/trial-reminders/route.ts` (hourly at :53, see `worker.ts`) |
| Tests | `tests/journeys/1-rwanda-signup-to-trial.test.ts`, `tests/trial/start-trial.test.ts`, `tests/demo/demo-flow.test.ts`, `tests/demo/demo-actions.test.ts`, `tests/demo/slots.test.ts`, `tests/demo/calendar-links.test.ts`, `tests/account/welcome.test.ts`, `tests/account/industry-choice.test.ts`, `tests/auth/email-links.test.ts`, `tests/auth-confirm.test.ts`, `tests/auth-callback.test.ts`, `tests/team/require-user.test.ts`, `tests/team/team.db.test.ts`, `e2e/signup.spec.ts`, `e2e/app.spec.ts` |
| Docs | [docs/REGIONS.md](../../REGIONS.md) ("Trial first", regions), [docs/GOOGLE_CALENDAR.md](../../GOOGLE_CALENDAR.md), [docs/INVOICES.md](../../INVOICES.md), [docs/BUSINESS_INFO.md](../../BUSINESS_INFO.md), [docs/INDUSTRIES.md](../../INDUSTRIES.md) |

### Key functions

- `signUp` (app/signup/actions.ts) — validates the form, rate-limits, checks Turnstile, resolves the sector and calls
  Supabase `auth.signUp` with the details in the user metadata; a known address is sent to `/login`.
- `checkEmail` (app/signup/actions.ts) — step 1's "already registered?" check, padded to a fixed time and limited.
- `ensureAccount` (lib/account.ts) — after email confirmation or Google sign-in, creates `User`, `Business` (region and
  time zone from the country), the OWNER `Membership` and a `Subscription` on `TRIAL` with status `PENDING_DEMO`
  (the name is historical: it now means "trial not started yet").
- `saveOrganisation` (app/welcome/actions.ts) — Google sign-ups' details; sets country and pricing region only once.
- `finishOnboarding` (app/onboarding/actions.ts) — needs steps 1, 2 and the essentials of step 4, then sets
  `Business.onboardedAt`.
- `getAppContext` (components/app/context.ts) — the order of redirects: `/suspended`, `/account/deletion`,
  `/account/waiting`, `/welcome`, `/onboarding`, `/start-trial`.
- `beginTrial` (lib/trial/start.ts) — `PENDING_DEMO` → `TRIALING` on the TRIAL plan for `trial.days`, with the chosen
  plan's features (it must be sold in the company's region), audited, emails the client; one guarded update, so two
  taps start one trial. `startOwnTrial` is the client's ("Start my free trial"); `startTrial` (lib/admin/demos.ts) is
  the admin's, with an optional plan and length.
- `processTrialReminders` (lib/demo/trial-reminders.ts) — the two reminder emails and the switch to `EXPIRED`.
- `accountBlock` (lib/entitlements.ts) — turns the subscription into `pending_demo`, `trial_expired`, `past_due` or
  `inactive`; the dashboard and `lib/usage.ts` read it.
- `previewInvite` / `acceptInvite` (lib/team/service.ts) — check the invitation token and create the teammate's
  sign-in and `Membership`.

### How it works

1. `/signup` → `signUp` → Supabase sends the confirmation email (link to `/auth/confirm?next=…`).
2. `/auth/confirm` → `verifyOtp` → `ensureAccount` creates the rows → redirect to `next` (normally `/dashboard`).
3. `getAppContext` sends the user on: `/welcome` (Google, details missing) → `/onboarding` → `/start-trial` (unless an
   invoice is open: then `DashboardLayout` shows `InvoiceLock`).
4. `/start-trial` → `startTrialAction` → `startOwnTrial` → `Subscription.status = TRIALING`; the dashboard opens.
5. `/api/cron/trial-reminders` sends reminders and sets `EXPIRED` at the end; `accountBlock` makes the account
   read-only until a payment activates a plan.

## If something goes wrong

| Symptom | First place to look | Usual fix |
|---|---|---|
| "We couldn't send your confirmation email" | Admin → Errors (source `signup`); Supabase Auth email settings ([docs/EMAIL_SETUP.md](../../EMAIL_SETUP.md)) | Check the Supabase SMTP settings and sending limits. |
| Confirmation link says it expired (`/login?error=confirm`) | `app/auth/confirm/route.ts` | Ask the client to use **Resend** on the sign-up screen or sign in to get a new link. |
| Google sign-in sends the person back with "use password" | `allowGoogleSignIn` in `lib/account.ts` | The address was created with a password; sign in with it, or reset it. |
| Stuck on `/onboarding` step 4 | `finishOnboarding` in `app/onboarding/actions.ts`; `hasEssentials` in `lib/business-info/facts.ts` | Fill in opening hours, head office and a phone/WhatsApp. |
| "No plans are offered in your region yet" on `/start-trial` | Admin → Regions and Plans; `companyPlans` in `lib/region-prices.ts` | Give the company's region at least one plan with a price. |
| "Start my free trial" or the admin's Start trial refuses | The message from `beginTrial` in `lib/trial/start.ts` | Pick a plan sold in the company's region; an open invoice must be paid or cancelled first. |
| Trial ended but the client already paid | Admin → Payments; `processTrialReminders` in `lib/demo/trial-reminders.ts` | Approve the Mobile Money payment or check the Paddle webhook (see [Billing](17-billing-plans-and-usage.md)). |
| Teammate sees "Waiting for your company owner" | `app/account/waiting/page.tsx` | The owner or an admin must finish `/welcome` and `/onboarding`. |
| Invitation "expired" or "already used" | Settings → Team; `previewInvite` in `lib/team/service.ts` | Resend the invitation from the Team page. |

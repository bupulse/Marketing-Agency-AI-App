# Pricing page: the plan quiz and paying by Mobile Money

The public pricing page (`/pricing`) shows the plans and prices of the visitor's region. Two parts help a visitor
decide and pay without talking to anyone first:

- **Pick your plan in 30 seconds**: three questions, then one suggested plan with its price, and **Book a free demo**
  or **Sign up and pay now**.
- **Pay with MTN MoMo or Airtel Money**: the five steps of a Mobile Money payment, with the region's own prices.
  Shown only in regions that take Mobile Money (Rwanda today).

**Page:** `/pricing` (public, no sign-in). **Plans:** everyone sees it; the plans and prices are the visitor's
region's (`docs/REGIONS.md`).

## What the visitor sees

1. The plan cards (as before).
2. **Pick your plan in 30 seconds.** The questions appear one after the other:
   - *What do you want most?* Good posts and designs · Short videos and photos · Answer customers fast · Someone to do
     it all for me.
   - *How many posts a week?* 1 to 3 · 4 to 7 · More than one a day.
   - *Who will use BuPulse?* Just me · 2 or 3 people · 4 or more.
3. **Our suggestion**: the plan's name and monthly price, why it fits ("Up to 60 AI texts and 30 designs a month:
   enough for about 12 posts"), and the buttons:
   - a plan: **Book a free demo** and **Sign up and pay now** (both open sign-up; the plan is remembered, see below);
   - "Someone to do it all for me": **Done for you: Managed by BuPulse**, with **Book a free demo** and **See
     done-for-you**;
   - nothing on sale fits (for example 4 or more users when the biggest plan has 3): **A custom plan**, with **Request a
     custom plan**.
   - **Start again** clears the answers.
4. **Pay with MTN MoMo or Airtel Money** (Rwanda): sign up and choose a plan (the prices are listed) → choose Mobile
   Money → pay from the phone (Tap to dial, or Airtel with the reference) → **I have paid** with the transaction id and a
   screenshot → we confirm, usually within minutes. The MoMo Pay code and the reference are shown only inside the app,
   so nobody pays without a reference. Where card is also taken, a line says card is charged in US dollars and renews
   by itself.

## How the suggestion is chosen

- **Someone to do it all** → Managed by BuPulse (agreed in the demo).
- Otherwise the **cheapest plan on sale in the region** that has:
  - the feature the first answer needs (videos → the Videos feature; answering customers → Website chat);
  - at least as many AI texts **and** designs a month as posts (1 to 3 a week = 12, 4 to 7 = 30, more than one a day = 60);
  - at least as many users as answered (1, 3 or 4).
- The free trial is never suggested. Two plans at the same price: the one whose key comes first.
- Nothing is typed into the quiz: no price, plan name or limit. Change a plan in **Admin → Plans** or a price in
  **Admin → Regions and prices**, and the quiz follows within 30 seconds (the catalog cache).

With today's Rwanda plans: posts only, a few a week, one person → **Starter**; videos, website chat, a post a day or a
team of 2 to 3 → **Business**; 4 or more people → **custom plan**.

## After the quiz: the remembered plan

Pressing **Book a free demo** or **Sign up and pay now** on a suggested plan keeps its key in a small cookie
(`bp-plan-pick`, 30 days, only the plan key). After sign-up and onboarding, **Book your demo → Choose the plan** starts
on that plan with the badge **Suggested by your quiz** (only if the company's region offers it; otherwise the most
popular plan, as before). The owner can still pick another one. From the demo screen the owner can pay at once
("Pay for <plan>"), so "Sign up and pay now" needs no demo first.

## For developers

| | |
| --- | --- |
| Quiz rules (pure) | `lib/plan-quiz.ts`: `QUIZ_QUESTIONS`, `parseAnswers`, `recommendPlan(answers, plans)`, `POSTS_A_MONTH`, `USERS`, `GOAL_FEATURES`, `PLAN_PICK_COOKIE`, `pickedPlanKey` |
| Quiz (client) | `app/(marketing)/pricing/plan-quiz.tsx` (`PlanQuiz`): radio questions, the result, the cookie written on click |
| Mobile Money steps (server) | `app/(marketing)/pricing/momo-steps.tsx` (`MomoSteps`): hidden unless the region's `paymentMethods` has `momo` |
| Page | `app/(marketing)/pricing/page.tsx`: passes `getRegionPlans(region.key)` (the same list as the cards) to both |
| Remembered pick | `app/book-demo/page.tsx` reads `bp-plan-pick` with `cookies()`, keeps it only when `companyPlans()` offers it, and passes `suggested` to `components/demo/plan-choice.tsx` |
| Tests | `tests/pricing/plan-quiz.test.ts` (recommendations, trial never suggested, catalog-driven, cookie value check, both components rendered, no price typed in the source) |

No database table, no server action and no outgoing message: the quiz runs in the browser on the plans the page
already has.

## If something goes wrong

| Symptom | Where to look | Usual fix |
| --- | --- | --- |
| The quiz suggests a plan that is not on the cards | It cannot: both read the same `plans` prop. Check the plan's region price in Admin → Regions and prices | Clear the price or the plan's status |
| Always "A custom plan" | The region's plans lack the feature (Videos, Website chat) or enough designs or users | Admin → Plans: features and limits |
| The Mobile Money steps are missing | The region's payment methods (Admin → Regions) do not list Mobile Money | Tick Mobile Money for the region |
| Book your demo does not start on the quiz's plan | Cookies blocked, a plan the company's region does not offer, or more than 30 days since the quiz | Expected; the owner picks the plan |

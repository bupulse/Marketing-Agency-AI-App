# Revenue goal tracker (Admin)

The top of **Admin → Money → Revenue and profit** shows how far BuPulse is from its monthly income goal
(9,000,000 RWF a month by month 3 to 4 after launch, `docs/bizdev/PLAN.md`), whether this month is on the plan's pace,
and how many more paying clients it takes. Admin only; clients never see it.

**Page:** `/admin/revenue` (permission *Revenue and profit*). **Settings:** Admin → Settings → **Revenue goal**
(`/admin/settings#goal`, permission *System*).

## What the owner sees

- **Goal: 9,000,000 RWF a month** with a bar: MRR against the goal, in percent.
- **MRR now**, and how much is still to go.
- **Target for the end of month N**: the pace plan's MRR for this launch month (month 1: 19% of the goal, month 2:
  43%, month 3: 70%, month 4 and after: 100%), with **On track** in green or the amount **behind** in red.
- **New paying clients this month**: companies whose first payment ever came this month (Kigali time), and about how
  many a month are needed to reach the goal by the end of month 4.
- **More paying clients needed**: the gap divided by today's MRR per paying client.
- **How we calculate this** explains each number.

Before the launch month the targets show "Not started"; with no paying client yet the client counts show "n/a".

## Changing the goal

Admin → Settings → **Revenue goal**: the goal in RWF a month and the **launch month** (month 1, for example 2026-11).
Both are audited like every setting (`update_setting`). A goal of 0 hides the section.

The launch month is set to **November 2026** by default, a guess (`docs/bizdev/PLAN.md`, section 9): set it to the
month paid sales really started.

## Trial reminders and the rest of the sales numbers (already built)

Nothing new was needed here; for reference:

- Trial-end emails a day before and on the last day, then the trial ends and the account is read-only
  (`lib/demo/trial-reminders.ts`, hourly cron; `docs/REGIONS.md`, "Trial first").
- Mobile Money renewal reminders 5 days and 1 day before the end, 3 days of grace (`docs/MOMO.md`).
- Who is on a trial and whose trial ends soon: Admin → Clients → **Client health**; per agent: Admin → Sales →
  **My clients**; per month and plan: the rest of Revenue and profit; visit to sign-up to paying: Content → **Funnels**.

## For developers

| | |
| --- | --- |
| Maths (pure) | `lib/money/goal.ts`: `GOAL_PATH`, `goalProgress`, `mrrInRwf` (RWF paid exactly, the rest at the report's rate), `launchMonthNo` |
| View | `components/admin/money/goal-section.tsx` (`GoalSection`), rendered by `app/admin/(console)/(money)/revenue/page.tsx` above `RevenueView` |
| Inputs | `getMoneyReportCached` (MRR, its RWF part, paying clients, each client's first payment) and `getSettings()` |
| Settings | `revenueGoalRwf` (`sales.revenueGoalRwf`, default 9,000,000) and `goalStartMonth` (`sales.goalStartMonth`, default `2026-11`) in `lib/admin/settings.ts`; saved by `saveSettingsAction` (`NAMES`); the form panel `#goal` on the Settings page |
| Tests | `tests/money/goal.test.ts` |

No table, no migration, no cron.

## If something goes wrong

| Symptom | Where to look | Usual fix |
| --- | --- | --- |
| The section is missing | The goal is 0 in Settings | Set the goal |
| "Target: Not started" | The launch month is in the future | Set the real launch month |
| MRR differs from what clients paid this month | MRR counts recurring value (a yearly payment a twelfth), not cash received | Expected: the month's cash is in "This month" below |

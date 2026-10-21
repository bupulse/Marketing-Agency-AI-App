# Automations

> **Coming soon (owner decision, 21 October 2026).** Automations is switched off for now: the menu shows it as "Coming soon", its pages say it is on its way, and plans that include it keep it, dormant, until it is switched back on (`status` in `lib/features.ts`). The website chat still collects leads.

Automations answer messages, comments and Story mentions by themselves: send the price when someone comments PRICE,
greet first-time visitors with a menu, ask for a phone number and save the lead, have the AI answer questions from your
knowledge base, follow up the next day, and hand people to your team. You draw them on a canvas, step by step, or start
from a ready-made template.

**Pages:** `/dashboard/automations` (list and templates), `/dashboard/automations/<id>` (the canvas)
**Plans:** feature key `automations` (needs `inbox`): Pro; in Rwanda the "Social replies" add-on (seed price 25,000 RWF a
month with 1,000 chat replies, Admin → Add-on prices). Only Owners and Admins create and change automations.
**Channels:** the website chat now; Instagram and Facebook when an account has "Answer comments and messages" on
(guide page 24). WhatsApp and Telegram can be ticked already and work once they are connected.

## What you see

- **The list:** your automations with Live, Paused or Draft, "Unpublished changes", what starts them, their channels,
  and how many people started and finished them in the last 30 days. The ⋯ menu pauses, resumes, duplicates or deletes.
- **Templates:** Comment PRICE → DM, Welcome menu, Book a visit or appointment, Answer anything with AI, Giveaway,
  Follow up the next day, or a blank automation.
- **The canvas:** the steps as boxes joined by lines. Buttons above the canvas add a step: Send a message, Ask a
  question, AI conversation, Condition, Actions, Wait, Hand over to the team, End. A box with an orange dot needs
  attention. On the right, the settings of the selected step.
- **The top bar:** the name, the status, **Preview**, **Save draft**, **Publish** (or **Publish changes**) and **Pause**.
  A yellow box lists what must be fixed before publishing; click a point to jump to the step.
- **Preview:** a phone that plays the automation with a sample contact. Tap buttons, type answers, choose the path of a
  condition. Nothing is sent and no AI is used.

## How to use it

1. Open **Automations** and pick a template, for example **Comment PRICE, get the price in DM**.
2. Click each step and change the words: write your real price, address, opening hours. Use `{{first_name}}` to greet
   people by name.
3. To add a step, select the step it should follow and click a button above the canvas; it joins underneath. To join
   steps yourself, drag from a dot at the bottom of a box to the top of another. Each button and each answer of a
   question has its own dot.
4. Click **Preview** and try it like a customer would.
5. Click **Publish**. From now on it answers. Editing later changes the draft only: click **Publish changes** to use the
   new version (people already in the middle keep the old one until they finish).
6. Watch the conversations in the **Inbox**. When you answer someone yourself, automations pause in that conversation
   for 12 hours.

## Limits and settings

- Up to 100 automations per company and 60 steps per automation; a message has up to 3 buttons.
- When several automations could answer, the most specific wins: a keyword beats "first message", which beats "any
  message". Among equals, the one changed most recently.
- Comments: the first message goes to the person's DMs as a private reply when your account allows it; otherwise it is
  posted as a reply under the comment, and the automation goes on once they send a DM. Meta allows one private reply per
  comment, within 7 days, and replies only within 24 hours of the person's last message.
- Each AI reply uses one chat reply of the plan. With none left, the AI step is skipped and the automation goes on.
- A question is asked again up to twice when the answer does not fit (not a phone number, for example).

## For developers

See [docs/AUTOMATIONS.md](../../AUTOMATIONS.md): the graph, the step table, how a message picks an automation, comment
handling, runs and jobs, publishing, money, templates and the file list.

## If something goes wrong

| Symptom | Where to look | Usual fix |
|---|---|---|
| Publish is greyed out | The yellow box above the canvas. | Fix each point (click it to find the step). |
| An automation does not answer | Is it Live? Does the trigger's channel match? Is a more specific automation answering instead? Is the conversation paused ("Team answering")? | Check the trigger; resume automations in the Inbox. |
| Comments are not answered | The account's switch on Channels and Admin → Services (Instagram and Facebook replies); the Composio monthly budget. | Switch them on; wait for the next month or raise the budget (owner's decision). |
| A run shows "Failed" on the contact | The failed message in the Inbox says why (often the 24-hour window). | Usually nothing: the person can write again. |
| The AI step answers nothing | Chat replies left this month (Usage), the AI switch (Admin → Services). | Add chat replies or wait for the next month. |

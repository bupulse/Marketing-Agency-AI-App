# Quiz mode

Testers said the Business info sections and the campaign forms take too many steps and too much typing. Quiz mode asks
the same things as a short game. There is one question per screen, and you answer with one tap. BuPulse guesses first,
so the owner mostly confirms. Rounds earn points and end with a small celebration. Everything is saved into the same
records as the full forms, so nothing captured before is lost. The full forms stay one tap away.

Owner request (22 October 2026): "make it more interactive and less of a process and more fun, you can even make it a
quiz … fast and less boring, also able to capture all the information like before". The owner tests it on
test.bupulse.com first. The full forms stay as they are.

## Rules for every quiz

1. **One question per screen, one tap to answer.** Aim for under 10 seconds per question. Tiles (one answer) move on
   by themselves about 250 ms after the tap. Chips (several answers) have a Next button.
2. **BuPulse guesses first.** Every question opens with BuPulse's guess already picked and tagged "Our guess"
   (`GuessTag`). The guess comes from Business info, or from one AI call at the start of the quiz. The owner taps Next
   to keep it, or picks something else.
3. **Typing is optional.** Every text question has ideas to tap (`TextAnswer` suggestions, `KeepOrDrop`, `Chips` with
   `suggested`). "Add your own" or the field below is for the owner's own words.
4. **Anything can be skipped.** A skipped question leaves the stored value as it was. The full form shows it as
   missing, as it does today.
5. **Saved as you go.** Each round saves when it ends, before the "round done" screen. It saves through the same
   server actions and schemas as the full forms, so the checks stay the same. If a save fails, the error shows on the
   question and the quiz stays there.
6. **Fun, not childish.** Each round has an emoji, a pill and points (`lib/quiz/flow.ts`: 10 per answer, 25 per
   round). Confetti plays when a round ends. The finish screen shows a score ring ("BuPulse knows your business 86%")
   and what to do next. The wording is plain and warm, with no jargon.
7. **Mobile first.** The tap targets are big and the main button sits at the bottom where the thumb is. On a computer,
   the keys 1–9 pick a tile and Enter is Next. Reduced motion turns the confetti off.
8. **The full form is one tap away.** The quiz has a "Prefer to see every field at once? Open the full form" link, and
   the form pages link back to the quiz.

## The kit

| Piece | File | Use |
| --- | --- | --- |
| `useQuiz(steps)` | components/quiz/use-quiz.ts | Where the quiz is, the points, `next` / `skip` / `back`, `roundDone` between rounds |
| `QuizFrame` | components/quiz/frame.tsx | Round pills, points, progress bar, the question card, Back / Skip / Next, the full-form link |
| `QuestionHead` | frame.tsx | The kicker, the question in big type, and a hint |
| `RoundDone` | frame.tsx | Confetti, "Customers: done!", the points, and "Next: 🛍️ Products" |
| `Thinking` | frame.tsx | The wait while the AI reads the business, with lines that change |
| `Tiles` | components/quiz/answers.tsx | Big tiles with an emoji, one answer, keys 1–9 |
| `ThisOrThat` | answers.tsx | Two big cards |
| `Chips` | answers.tsx | Several answers; BuPulse's ideas first with a sparkle; "Add your own" |
| `TextAnswer` | answers.tsx | Ideas to tap, plus a field for your own words |
| `KeepOrDrop` | answers.tsx | BuPulse's lines (FAQs, highlights, rules) to keep, drop, change or add |
| `Slider` | answers.tsx | A number in big type with a verdict (pay: "Fair", "Generous") |
| `ScoreRing` | answers.tsx | The finish screen's score |

A quiz page is a client component. It owns its answers, defines `rounds` and `steps`, and renders
`<QuizFrame>` with `RoundDone` when `quiz.roundDone` is set, its finish screen when `quiz.finished` is set, and
otherwise the question for `quiz.step.id`.

## The quizzes

### A. Business info quiz: `/dashboard/knowledge/quiz`

The entry is a large card at the top of Business info: "Fill it in with a 5-minute quiz". It shows the overall % and
"Continue" when part is done. Each round reads the stored values first, so answering again shows what is saved. One AI
call at the start drafts the guesses from what BuPulse already knows: the name, industry, onboarding description and
audience, products, and website. A template answers when the AI is not available.

| Round | Asks (one screen each) | Saves to |
| --- | --- | --- |
| 🏠 You | Which tagline fits (3 ideas + your own); what you do (idea to confirm); team size (tiles); year founded; languages you talk to customers in (chips); your values (chips); mission (3 ideas) | `saveProfile` (Business.profile, name, sector) |
| 🛍️ What you sell | Which of these you sell (chips of guessed products + your own). For each new one: kind (tiles), price (number + "Ask for price"), and its best reason to buy (ideas) | `createProduct` (drafts if photos are missing) |
| 👥 Your customers | Who buys most (3 persona cards, pick 1–2); age (tiles); mostly women / men / any; where they are online (chips); what they need; what bugs them; what makes them buy (chips of ideas) | `createPersona` / `updatePersona` |
| ⭐ Why you | Who else they consider (chips + your own); why they choose you (ideas); which sentence sums you up (3 positioning ideas) | `createCompetitor`, `savePositioning` |
| 📋 Rules | How people pay (chips); delivery, returns, booking (tiles of common answers + your own); common questions (5 FAQ ideas to keep or drop, answers you can edit) | `savePolicies`, `createFaq` |
| 📍 Find us | Opening hours (presets: Mon–Fri 8–18, Mon–Sat 8–20, every day, 24/7, custom); phone / WhatsApp; where you are (address) | the Business info knowledge save (same as the Locations page) |
| 🎙️ Your voice | Three this-or-that questions (friendly / formal, emojis or not, short / detailed); then "Which post sounds like you?" (3 sample posts written in different voices) | `approveVoice` (the marketing profile; same as the interview) |
| 💬 Love notes | "Got a nice message from a customer? Paste it" (optional): name, where it came from (tiles), and whether they agreed to be quoted | `createReview` |

The finish screen shows the score ring with the overall Business info %, what got better ("Your posts now know your
prices, your customers and your voice"), and two buttons: "Make my first posts" and "Back to Business info".

#### What was built (Business info quiz)

| Part | File |
| --- | --- |
| The page: loads every stored value, leaves out the rounds the role or plan cannot edit (named under the quiz with a lock), `?round=` starts at a round | app/dashboard/knowledge/quiz/page.tsx |
| The quiz: the AI wait, the 8 rounds, the save at the end of each round, the errors on the question, the finish screen | components/knowledge/business-quiz.tsx |
| The rounds, the questions, the first answers (stored, else the guess, tagged "Our guess"), and each round's answers mapped to its action's input | lib/knowledge/quiz-map.ts |
| The guesses: the AI's schema, the sanitiser, the template per industry (food, beauty, fashion, tech, or general) | lib/knowledge/quiz-draft.ts |
| The one AI call, `draftBusinessQuiz` | lib/knowledge/quiz-ai.ts |
| `draftQuiz` (the guesses) and `quizScore` (the overall % after saving) | app/dashboard/knowledge/quiz/actions.ts |
| The entry card on Business info ("Start the quiz" / "Continue" at the first incomplete round / "Play again") and "Do it as a quiz" in each section's header | app/dashboard/knowledge/page.tsx, components/knowledge/quiz-link.tsx |
| Moving on safely (the move guard) | lib/knowledge/quiz-move.ts |
| Tests | tests/quiz/business-map.test.ts, business-draft.test.ts, business-ai.test.ts, business-move.test.ts |

**The AI.** One call when the quiz opens, on the cheap text model, through the cost ledger as feature `knowledgeQuiz`
(so the admin switch and the company's allowance apply), with a rate limit (8 an hour) and a daily cap (20 a day) per
company. Plans without AI writing (the `content` feature) get the template with no call. The owner's data is fenced in
the prompt as data, never instructions. What comes back must pass a strict schema (otherwise the template is used).
Then every line is cleaned and clipped to the limits the actions check, and **dropped when it carries a number or a
promise ("free", "discount", "guarantee", "%") that is not in the business data**. Every list is topped up from the
template. The call gives up after 22 seconds. The page starts with the template after 25 seconds, or at once with
"Don't wait, start now" (shown after 6 seconds). A draft from the AI is kept in sessionStorage for the tab, so a reload
does not pay again.

**Saving.** Each round saves when its last question is passed (Next or Skip), through the section's own actions. A
skipped question, an empty text or an empty list keeps the stored value. Products, competitors and FAQs that already
exist (matched by name or question) are never created twice. Nothing is deleted. The browser sends server actions one
at a time, so the rounds with several items (products, personas, competitors and positioning, policies and FAQs) send
one request (`saveQuizProducts`, `saveQuizPersonas`, `saveQuizWhy`, `saveQuizRules`) that runs the same section actions
side by side on the server. While a round saves, the card shows "Saving your products…". A save's problem shows under
the question, scrolled into view and focused.

**Moving on safely.** Every move names the question it was made for (lib/knowledge/quiz-move.ts): a tile's delayed
move, Next, Enter and Skip. A move for a question no longer on screen, a second move while one is saving, or Enter
together with the button's own click does nothing. The new products asked about are fixed when the quiz starts: the
page's props refresh after every save, and reading them live once made the saved products' questions drop out, so the
quiz (which keeps its place by number) landed two questions on, in Customers.

| Round | Saved with | Notes |
| --- | --- | --- |
| 🏠 You | `saveProfile` | The whole stored profile is sent, with the answers on top. A sign-up description too short for the check is filled from "what you do". |
| 🛍️ What you sell | `createProduct` | One question per new product (up to 6), starting with the first reason idea picked. Saved as drafts (no photos yet). No number typed means "Ask for price" (on request): a price is never guessed. Next checks the question with `productInputSchema` in the browser, so a problem shows at once. |
| 👥 Your customers | `updatePersona` / `createPersona` | The questions after the cards describe the first card picked. A second new card is saved as guessed. |
| ⭐ Why you | `createCompetitor`, `savePositioning` | |
| 📋 Rules | `savePolicies`, `createFaq` | Warranty and payment notes are kept. |
| 📍 Find us | `saveKnowledge` (the Locations page's save) | The whole stored card is sent, with the hours preset, the first phone row and the head office address on top. Skipped or unchanged: no save. |
| 🎙️ Your voice | `approveVoice(summary, "quiz", answers)` | A new `quiz` mode (lib/knowledge/interview-service.ts `saveQuizVoice`) approves the picked voice without an interview. The this-or-that answers become rules and are kept as the profile's answers. |
| 💬 Love notes | `createReview` | Only Owners and Admins are asked about consent (the action enforces it too). |

### B. Own campaign quiz: `/dashboard/knowledge/campaigns/new?who=me`

This replaces the long form as the default. `?form=1` opens the full form. There are 6 cards:

1. What kind? Tiles: Offer 🎁 / Event 📅 / Launch 🚀 / Promotion 📣 / Other ✨. Moves on after the tap.
2. What's it about? One line, plus product chips (the ones from the URL's `?product=` are picked).
3. When? Chips: Today, This weekend, Next week, This month, No dates, Pick dates. "Pick dates" shows two date
   fields. An Event needs a date.
4. The deal: 3 ideas from the AI built from the products' prices (e.g. "20% off all juices"), plus "No price or
   discount" and your own. BuPulse never invents a price that isn't in the data. Ideas must come from the owner's
   line or the stored prices.
5. Highlights: AI lines to keep or drop, edit and add.
6. Your campaign: the AI's name and description in one card. Tap a field to change it. Then "Add campaign".

After saving, a celebration offers "Make posts for it now", which goes to the campaign's page. One AI call
(`suggestOwnCampaign`) runs after card 2, through the ledger, the allowance and a rate limit, like
lib/creators/wizard-ai.ts. A template answers without the AI.

### C. Creator campaign quick mode: `/dashboard/creators/new`

The 12-step wizard stays as "Detailed setup". Quick mode is the default for a new campaign.

1. The idea: one line, plus product chips. Then `createDraftAction` makes the draft and the AI fills every step, as
   it does today. `Thinking` shows while it works.
2. Goal: tiles.
3. Creators: tiles for size (Anyone / 1k+ / 10k+ / 50k+), then chips for place and topics (the AI's picked).
4. Where: network tiles (TikTok, X and others say "Coming soon", as today); format chips.
5. When: chips (Starts today / next Monday / pick) and how long (1 week / 2 weeks / 1 month / pick); brief cadence
   tiles.
6. Pay: a slider for the price per 1,000 views, with the fair meter (`rateLevel`: too low is refused, Fair,
   Generous), the cost estimate, and the budget cap.
7. "We prepared the rest": one card each for Content (brief + tasks), Rules (do's and don'ts), Form (questions),
   Look (cover), each with what the AI wrote and "Looks good ✓" or "Change", which opens that step of the detailed
   wizard and comes back.
8. Files: the one must-do. Drop in the logo, product photos and example videos (the go-live checklist from
   `goLiveProblems` as ticks).
9. Ready: the summary card, then "Go live" or "Save as draft".

Each card saves with `saveStepAction` for its wizard step, so the data is the same as the detailed wizard's.

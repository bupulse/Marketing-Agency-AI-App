// What each step of the campaign wizard sends and the server accepts (docs/CREATOR_CAMPAIGN_WIZARD.md), and the
// plain helpers the steps share: the tasks made from step 5, the pay method, the cost estimate. Pure (no server
// imports), so the wizard checks the same rules as the server (saveStep in lib/creators/campaigns.ts) and the tests
// read them directly.
//
// Owner decisions (22 October 2026): the draft is saved after each step; while it is a draft, saving Content replaces
// the campaign's tasks with the ones on screen. Each step checks only its own answers; the whole campaign is checked
// (campaignSchema and goLiveProblems) when it goes live.

import { z } from "zod";
import { addDaysYmd } from "@/lib/demo/slots";
import { campaignSchema, firstProblem, isMention, PLATFORMS, taskSchema, taskSpans, TASK_MEDIA, type CampaignInput, type Platform, type TaskInput, type TaskRepeat } from "./company-forms";
import { applicationFormSchema, type ApplicationForm } from "./form-fields";
import { computePeriodPay, paysAnything, payRulesSchema, type PayRules } from "./pay";
import { rateProblem, RATE_VIEWS } from "./pay-floor";
import { daysInclusive, MAX_CAMPAIGN_DAYS } from "./periods";
import { requirementsSchema, type CreatorRequirements } from "./requirements";
import { BRIEF_EVERY, CAMPAIGN_GOALS, CAMPAIGN_KINDS, filesSchema, goLiveProblems, lookSchema, POST_FORMATS, WIZARD_STEPS, type ReadinessFacts, type BriefEvery, type CampaignFiles, type CampaignGoal, type CampaignKind, type CampaignLook, type PostFormat, type WizardStepId } from "./wizard";

export const KIND_VALUES = CAMPAIGN_KINDS.map((k) => k.value) as [CampaignKind, ...CampaignKind[]];
export const GOAL_VALUES = CAMPAIGN_GOALS.map((g) => g.value) as [CampaignGoal, ...CampaignGoal[]];
export const FORMAT_VALUES = POST_FORMATS.map((f) => f.value) as [PostFormat, ...PostFormat[]];
export const BRIEF_EVERY_VALUES = BRIEF_EVERY.map((b) => b.value) as [BriefEvery, ...BriefEvery[]];
export type TaskMedia = (typeof TASK_MEDIA)[number];

/** The most tasks the wizard makes (a new brief every day works for about 4 months). */
export const MAX_WIZARD_TASKS = 120;
export const MAX_RULE_LINES = 20;
export const MAX_IDEA = 300;

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date.");
const count = z.number().int().min(1, "Use a number above 0, or leave it empty.").max(1_000_000_000).nullable().optional();
const line = z.string().trim().min(2, "Write each line in a few words.").max(160, "Keep each line under 160 characters.");

/** A task as the Content step edits it: the task's fields, and its id once saved. */
export type WizardTask = TaskInput & { id?: string | null; /** Posts handed in for it (it cannot be deleted then). */ submissions?: number };

const wizardTaskSchema = z.looseObject({ id: z.string().max(60).nullish() }).transform((raw, ctx) => {
  const parsed = taskSchema.safeParse(raw);
  if (!parsed.success) {
    ctx.addIssue({ code: "custom", message: firstProblem(parsed.error) });
    return z.NEVER;
  }
  return { ...parsed.data, id: raw.id ?? null };
});

export const STEP_SCHEMAS = {
  idea: z
    .object({
      idea: z.string().trim().max(MAX_IDEA, `Keep it under ${MAX_IDEA} characters.`),
      name: z.string().trim().max(80, "Keep the name under 80 characters."),
      kind: z.enum(KIND_VALUES).nullable(),
      knowledgeCampaignId: z.string().min(1).max(60).nullable(),
      productIds: z.array(z.string().min(1).max(60)).max(30, "Pick at most 30 products."),
    })
    .superRefine((v, ctx) => {
      if (!v.idea && !v.name) ctx.addIssue({ code: "custom", path: ["idea"], message: "Write one line about the campaign." });
      if (v.name && v.name.length < 2) ctx.addIssue({ code: "custom", path: ["name"], message: "Give the campaign a name." });
    }),
  goal: z.object({ goal: z.enum(GOAL_VALUES, { error: "Pick what you want from the campaign." }) }),
  creators: z.object({ requirements: requirementsSchema }),
  where: z
    .object({
      platforms: z.array(z.enum(PLATFORMS)).min(1, "Pick at least one network.").max(PLATFORMS.length),
      platformMode: z.enum(["ALL", "ANY"]),
      formats: z.array(z.enum(FORMAT_VALUES)).max(FORMAT_VALUES.length),
      mentions: z.array(z.string().trim().min(2).max(200)).max(10, "Use at most 10 mentions."),
    })
    .superRefine((v, ctx) => {
      const bad = v.mentions.find((m) => !isMention(m));
      if (bad) ctx.addIssue({ code: "custom", path: ["mentions"], message: `"${bad}" is not a mention: use @yourhandle, #yourhashtag or a link.` });
    }),
  when: z
    .object({
      startsOn: ymd,
      endsOn: ymd,
      briefEvery: z.enum(BRIEF_EVERY_VALUES),
      postsPerDay: z.number().int().min(1, "At least 1 post a day.").max(10, "At most 10 posts a day."),
      mediaKind: z.enum(TASK_MEDIA),
    })
    .superRefine((v, ctx) => {
      const days = daysInclusive(v.startsOn, v.endsOn);
      if (!(days >= 1)) ctx.addIssue({ code: "custom", path: ["endsOn"], message: "The last day must be on or after the first day." });
      else if (days > MAX_CAMPAIGN_DAYS) ctx.addIssue({ code: "custom", path: ["endsOn"], message: "A campaign can run for a year at most." });
      else if (v.briefEvery === "DAY" && days > MAX_WIZARD_TASKS) ctx.addIssue({ code: "custom", path: ["briefEvery"], message: `A new brief every day works for up to ${MAX_WIZARD_TASKS} days. Pick every week instead.` });
    }),
  content: z.object({
    brief: z.string().trim().max(4000, "Keep the brief under 4,000 characters."),
    tasks: z.array(wizardTaskSchema).max(MAX_WIZARD_TASKS, `Use at most ${MAX_WIZARD_TASKS} tasks.`),
  }),
  rules: z.object({
    dos: z.array(line).max(MAX_RULE_LINES, `Use at most ${MAX_RULE_LINES} do's.`),
    donts: z.array(line).max(MAX_RULE_LINES, `Use at most ${MAX_RULE_LINES} don'ts.`),
    rules: z.string().trim().max(4000).nullable(),
  }),
  pay: z
    .object({
      currency: z.string().trim().regex(/^[A-Z]{3}$/, "Pick a currency."),
      payRules: z
        .looseObject({ milestones: z.array(z.looseObject({ views: z.unknown(), amount: z.unknown() })).optional() })
        .superRefine((r, ctx) => {
          const whole = (n: unknown) => typeof n === "number" && Number.isInteger(n) && n >= 1;
          if (r.milestones?.some((m) => !whole(m.views) || !whole(m.amount))) ctx.addIssue({ code: "custom", message: "Give each milestone both its views and what it pays, or remove it." });
        })
        .pipe(payRulesSchema),
      viewTargetPerCreator: count,
      viewTargetCampaign: count,
      budget: count,
    })
    .superRefine((v, ctx) => {
      if (!paysAnything(v.payRules)) ctx.addIssue({ code: "custom", path: ["payRules"], message: "Set how creators earn: a price per views, a fee per post or a milestone." });
      const rate = rateProblem(v.payRules, v.currency);
      if (rate) ctx.addIssue({ code: "custom", path: ["payRules"], message: rate });
      const ms = v.payRules.milestones ?? [];
      if (new Set(ms.map((m) => m.views)).size !== ms.length) ctx.addIssue({ code: "custom", path: ["payRules"], message: "Two milestones have the same number of views." });
    }),
  form: z.object({ applicationForm: applicationFormSchema }),
  files: z.object({ driveUrl: filesSchema.shape.driveUrl, exampleLinks: filesSchema.shape.exampleLinks }),
  look: z.object({ coverAssetId: lookSchema.shape.coverAssetId, listed: z.boolean(), acceptingApplications: z.boolean() }),
  review: z.object({}),
} satisfies Record<WizardStepId, z.ZodType>;

export type StepInput<S extends WizardStepId> = z.input<(typeof STEP_SCHEMAS)[S]>;
export type StepValues<S extends WizardStepId> = z.output<(typeof STEP_SCHEMAS)[S]>;

export const isStepId = (v: unknown): v is WizardStepId => typeof v === "string" && WIZARD_STEPS.some((s) => s.id === v);

/** The step's answers checked, or the first problem in words. */
export function checkStep<S extends WizardStepId>(step: S, data: unknown): { ok: true; data: StepValues<S> } | { ok: false; error: string } {
  const parsed = (STEP_SCHEMAS[step] as z.ZodType).safeParse(data);
  return parsed.success ? { ok: true, data: parsed.data as StepValues<S> } : { ok: false, error: firstProblem(parsed.error) };
}

/** Every answer of the wizard, as the steps show them (lib/creators/campaigns.ts getWizardCampaign reads them). */
export type WizardAnswers = {
  idea: string;
  name: string;
  kind: CampaignKind | null;
  knowledgeCampaignId: string | null;
  productIds: string[];
  goal: CampaignGoal | null;
  requirements: CreatorRequirements;
  platforms: Platform[];
  platformMode: "ALL" | "ANY";
  formats: PostFormat[];
  mentions: string[];
  startsOn: string;
  endsOn: string;
  briefEvery: BriefEvery | null;
  postsPerDay: number;
  mediaKind: TaskMedia;
  brief: string;
  tasks: WizardTask[];
  dos: string[];
  donts: string[];
  rules: string | null;
  currency: string;
  payRules: PayRules;
  viewTargetPerCreator: number | null;
  viewTargetCampaign: number | null;
  budget: number | null;
  applicationForm: ApplicationForm;
  files: CampaignFiles;
  look: CampaignLook;
  listed: boolean;
  acceptingApplications: boolean;
};

export const REPEAT_OF: Record<BriefEvery, TaskRepeat> = { MONTH: "none", WEEK: "week", DAY: "day" };

/** The day after `today` that is the next Monday (a week from today when today is Monday): when new drafts start. */
export function nextMonday(today: string): string {
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  return addDaysYmd(today, ((8 - weekday) % 7) || 7);
}

/** A name from the owner's line when they gave none: its first words, with a capital. */
export function nameFromIdea(idea: string): string {
  const words = idea.trim().replace(/\s+/g, " ").replace(/[.!?]+$/, "").split(" ").slice(0, 7).join(" ").slice(0, 60).trim();
  return words ? words[0].toUpperCase() + words.slice(1) : "";
}

/** "Your review (week 2)" → "Your review": a task's title without the label createTasks/planTasks gave it. */
export const baseTitle = (title: string) => title.replace(/\s+\((week \d+|\d{1,2} [A-Z][a-z]{2})\)$/, "");

const dayLabel = (ymdValue: string) => new Date(`${ymdValue}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/**
 * The tasks of step 6 from step 5: one for the whole span, one per week or one per day (taskSpans), with the texts
 * given in order. Fewer texts than tasks: they repeat, labelled "(week 2)" or with the day, as createTasks does.
 */
export function planTasks(p: {
  startsOn: string;
  endsOn: string;
  briefEvery: BriefEvery;
  postsPerDay: number;
  mediaKind: TaskMedia;
  platforms: Platform[];
  platformMode: "ALL" | "ANY";
  texts: { title: string; instructions: string }[];
}): WizardTask[] {
  const repeat = REPEAT_OF[p.briefEvery];
  const spans = taskSpans(p.startsOn, p.endsOn, repeat).slice(0, MAX_WIZARD_TASKS);
  const texts = p.texts.length ? p.texts : [{ title: "Your post", instructions: "Post about us in your own words and style." }];
  const repeated = texts.length < spans.length;
  return spans.map((s, i) => {
    const t = texts[i % texts.length];
    const label = !repeated ? t.title : repeat === "week" ? `${baseTitle(t.title)} (week ${i + 1})` : repeat === "day" ? `${baseTitle(t.title)} (${dayLabel(s.startsOn)})` : t.title;
    return { title: label.slice(0, 120), instructions: t.instructions, startsOn: s.startsOn, endsOn: s.endsOn, postsPerDay: p.postsPerDay, platforms: p.platforms, platformMode: p.platformMode, mediaKind: p.mediaKind };
  });
}

/** True when the tasks are exactly the spans step 5 makes (same days, in order): no need to plan them again. */
export function tasksMatchSpans(tasks: { startsOn: string; endsOn: string }[], startsOn: string, endsOn: string, briefEvery: BriefEvery): boolean {
  const spans = taskSpans(startsOn, endsOn, REPEAT_OF[briefEvery]);
  return spans.length === tasks.length && spans.every((s, i) => s.startsOn === tasks[i].startsOn && s.endsOn === tasks[i].endsOn);
}

/** The texts of the tasks, without repeats, to plan them again over new days. */
export function taskTexts(tasks: { title: string; instructions: string }[]): { title: string; instructions: string }[] {
  const seen = new Set<string>();
  const out: { title: string; instructions: string }[] = [];
  for (const t of tasks) {
    const title = baseTitle(t.title);
    const key = `${title}\u0000${t.instructions}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push({ title, instructions: t.instructions });
    }
  }
  return out;
}

/** What a new task's media is from the formats picked in step 4: photos only for photo posts and carousels. */
export function mediaFromFormats(formats: PostFormat[]): TaskMedia {
  if (formats.length === 0) return "VIDEO";
  const photo = formats.every((f) => f === "POST" || f === "CAROUSEL");
  const video = formats.every((f) => f === "REEL" || f === "LIVE" || f === "STORY");
  return photo ? "IMAGE" : video ? "VIDEO" : "ANY";
}

// ---- Pay ---------------------------------------------------------------------------------------------------------

export const PAY_METHODS = [
  { value: "VIEWS", label: "Per views", hint: "A price for every 1,000 or more views." },
  { value: "POST", label: "Per post", hint: "A fixed fee for every post handed in." },
  { value: "MILESTONES", label: "Milestones", hint: "A bonus when a post reaches a number of views." },
  { value: "MIX", label: "Mix", hint: "Any of these together." },
] as const;
export type PayMethod = (typeof PAY_METHODS)[number]["value"];

/** The method card the rules show as: one kind of pay, or Mix (none set yet: Per views). */
export function payMethodOf(rules: PayRules): PayMethod {
  const kinds = [rules.ratePerThousand ? "VIEWS" : null, rules.feePerPost ? "POST" : null, rules.milestones?.length ? "MILESTONES" : null].filter(Boolean) as PayMethod[];
  return kinds.length === 1 ? kinds[0] : kinds.length > 1 ? "MIX" : "VIEWS";
}

/** The rules kept when the owner switches method: only that kind of pay (caps stay). */
export function rulesForMethod(rules: PayRules, method: PayMethod): PayRules {
  if (method === "MIX") return rules;
  return {
    ...rules,
    ratePerThousand: method === "VIEWS" ? rules.ratePerThousand : null,
    feePerPost: method === "POST" ? rules.feePerPost : null,
    milestones: method === "MILESTONES" ? rules.milestones : [],
  };
}

export const isRateViews = (n: unknown): n is (typeof RATE_VIEWS)[number] => (RATE_VIEWS as readonly unknown[]).includes(n);

/**
 * About what the campaign costs in one 30-day period: `creators` creators, each making `viewsEach` views over
 * `postsEach` posts. Uses the real pay maths (computePeriodPay), so the targets, the caps and the budget count.
 */
export function costEstimate(p: { rules: PayRules; creators: number; viewsEach: number; postsEach: number; viewTargetPerCreator?: number | null; viewTargetCampaign?: number | null; budget?: number | null }): { perCreator: number; total: number } {
  const creators = Math.max(1, Math.min(200, Math.floor(p.creators)));
  const posts = Math.max(1, Math.min(300, Math.floor(p.postsEach)));
  // Every creator's views on their first post (whole numbers stay exact); the others earn their fee.
  const list = Array.from({ length: creators }, (_, c) => Array.from({ length: posts }, (_, i) => ({ postId: `${c}-${i}`, creatorId: String(c), status: "TRACKING", postedInPeriod: true, viewsAtStart: 0, viewsAtEnd: i === 0 ? Math.max(0, Math.floor(p.viewsEach)) : 0 }))).flat();
  const pay = computePeriodPay(p.rules, { viewTargetPerCreator: p.viewTargetPerCreator, viewTargetCampaign: p.viewTargetCampaign, budget: p.budget }, list);
  return { perCreator: creators ? Math.floor(pay.amount / creators) : 0, total: pay.amount };
}

// ---- Step 1: examples from the owner's industry ---------------------------------------------------------------

const IDEA_EXAMPLES: [RegExp, string[]][] = [
  [/food|restaurant|caf|juice|drink|bak|bar\b|coffee|kitchen|catering/i, ["Get people to film our new juice", "Film your first bite of our burger", "Show our lunch menu in 15 seconds"]],
  [/fashion|cloth|shoe|boutique|tailor|wear/i, ["Show our new dresses on the streets of Kigali", "Style one of our shirts three ways", "Unbox your order from our shop"]],
  [/beauty|salon|hair|spa|cosmetic|barber|nail|skin/i, ["Film your new hair look at our salon", "Try our face cream for a week and tell us", "Show your before and after"]],
  [/tech|phone|electronic|software|app|computer/i, ["Unbox our new phone", "Show how our app saves you time", "Three things you didn't know our laptop does"]],
  [/school|education|training|course|academy|tutor/i, ["Tell people what you learned in our course", "Invite friends to our open day", "A day in our classes"]],
  [/gym|fitness|sport|yoga|health/i, ["Take our 30-day fitness challenge", "Film your workout at our gym", "Show your progress after one month"]],
  [/travel|tour|hotel|lodge|safari|resort/i, ["Show a weekend at our hotel", "Film the view from our lodge", "Your best moment on our tour"]],
  [/farm|agri|seed|dairy/i, ["Show where our milk comes from", "Cook a meal with our vegetables", "A morning on our farm"]],
  [/shop|store|supermarket|retail|market/i, ["Show what 10,000 RWF buys at our shop", "Film your shopping haul", "Our best deal of the week"]],
];
const DEFAULT_IDEAS = ["Get people to film our new product", "Invite people to our open day", "Show why customers love us"];

/** Three lines the owner can tap on step 1, from their industry. */
export function ideaExamples(industry: string | null | undefined): string[] {
  const hit = IDEA_EXAMPLES.find(([re]) => industry && re.test(industry));
  return hit ? hit[1] : DEFAULT_IDEAS;
}

/** A Business info campaign's type as the wizard's kind. */
export function kindFromKnowledgeType(type: string | null | undefined): CampaignKind | null {
  return type === "EVENT" ? "EVENT" : type === "LAUNCH" ? "LAUNCH" : type === "PROMOTION" ? "PRODUCT_REVIEW" : type ? "OTHER" : null;
}

/** "Step 6 of 12 · Content". */
export function progressLabel(step: WizardStepId): string {
  const i = WIZARD_STEPS.findIndex((s) => s.id === step);
  return `Step ${i + 1} of ${WIZARD_STEPS.length} · ${WIZARD_STEPS[i].title}`;
}

/** The furthest step reached after saving step `n` (1-based) of a campaign at `setupStep` (null: set up already). */
export function reachedAfter(setupStep: number | null, n: number): number | null {
  if (setupStep === null) return null;
  return Math.min(WIZARD_STEPS.length, Math.max(setupStep, n + 1));
}

const STEP_OF_PATH: Record<string, string> = { name: "Idea", brief: "Content", rules: "Rules", platforms: "Where", mentions: "Where", startsOn: "When", endsOn: "When", currency: "Pay", payRules: "Pay", viewTargetPerCreator: "Pay", viewTargetCampaign: "Pay", budget: "Pay" };

/**
 * Everything missing before a wizard campaign goes live, one line each (empty: ready): goLiveProblems' list, then
 * what the full campaign check (campaignSchema) still refuses, each with the step to fix it in.
 */
export function readinessProblems(input: CampaignInput, facts: ReadinessFacts): string[] {
  const out = goLiveProblems(facts);
  const parsed = campaignSchema.safeParse(input);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "");
      if (key === "brief") continue; // goLiveProblems says it
      const step = STEP_OF_PATH[key];
      const message = step ? `${issue.message.replace(/\.$/, "")} (step ${step}).` : issue.message;
      if (!out.includes(message)) out.push(message);
    }
  }
  return out;
}

/** "<campaign> – Images", made unique among the company's folder names (any case) with " (2)", " (3)"…; under 60 characters. */
export function campaignFolderName(campaign: string, label: string, taken: string[]): string {
  const suffix = ` – ${label}`;
  const base = campaign.trim().slice(0, 60 - suffix.length - 5).trim();
  const used = new Set(taken.map((t) => t.toLowerCase()));
  for (let n = 1; ; n++) {
    const name = n === 1 ? `${base}${suffix}` : `${base}${suffix} (${n})`;
    if (!used.has(name.toLowerCase())) return name;
  }
}

/** What a step sends to the server (saveStep), from the answers on screen. */
export function stepInput(step: WizardStepId, a: WizardAnswers): unknown {
  switch (step) {
    case "idea":
      return { idea: a.idea, name: a.name, kind: a.kind, knowledgeCampaignId: a.knowledgeCampaignId, productIds: a.productIds };
    case "goal":
      return { goal: a.goal };
    case "creators":
      return { requirements: a.requirements };
    case "where":
      return { platforms: a.platforms, platformMode: a.platformMode, formats: a.formats, mentions: a.mentions };
    case "when":
      return { startsOn: a.startsOn, endsOn: a.endsOn, briefEvery: a.briefEvery ?? "MONTH", postsPerDay: a.postsPerDay, mediaKind: a.mediaKind };
    case "content":
      return { brief: a.brief, tasks: a.tasks.map((t) => ({ id: t.id ?? null, title: t.title, instructions: t.instructions, startsOn: t.startsOn, endsOn: t.endsOn, postsPerDay: t.postsPerDay, platforms: t.platforms, platformMode: t.platformMode, mediaKind: t.mediaKind })) };
    case "rules":
      return { dos: a.dos, donts: a.donts, rules: a.rules?.trim() || null };
    case "pay":
      return { currency: a.currency, payRules: a.payRules, viewTargetPerCreator: a.viewTargetPerCreator, viewTargetCampaign: a.viewTargetCampaign, budget: a.budget };
    case "form":
      // Empty answer boxes are left out, so a choice with too few answers says so in words.
      return { applicationForm: { ...a.applicationForm, fields: a.applicationForm.fields.map((f) => (f.options ? { ...f, options: f.options.map((x) => x.trim()).filter(Boolean) } : f)) } };
    case "files":
      return { driveUrl: a.files.driveUrl?.trim() || null, exampleLinks: a.files.exampleLinks };
    case "look":
      return { coverAssetId: a.look.coverAssetId ?? null, listed: a.listed, acceptingApplications: a.acceptingApplications };
    case "review":
      return {};
  }
}

/** The go-live list with each item ticked or not (goLiveProblems says only what is missing), and the step to fix it in. */
export function readinessChecklist(f: ReadinessFacts): { label: string; done: boolean; step: WizardStepId }[] {
  return [
    { label: "The brief", done: f.brief.trim().length >= 10, step: "content" },
    { label: "At least one task with instructions", done: f.tasks > 0, step: "content" },
    { label: "Do's and don'ts", done: f.dos.length > 0 && f.donts.length > 0, step: "rules" },
    { label: "Your logo and product photos (Images)", done: f.images > 0, step: "files" },
    { label: "An example video, or a link to a post you like", done: f.videos > 0 || f.exampleLinks > 0, step: "files" },
  ];
}

/** Documents worth adding to the Documents folder (optional). */
export const SUGGESTED_DOCUMENTS = ["Brand guidelines", "Product sheet and prices", "Logo pack", "A script or key messages", "Music you own", "How to show the product"] as const;

/** Step 1's line for a creator campaign made from a Business info campaign ("Get creators to post it"). */
export function ideaFromKnowledge(c: { type: string; name: string; highlights?: string[] }): string {
  const name = c.name.trim();
  const start = c.type === "EVENT" ? `Get people to come to ${name}` : c.type === "LAUNCH" ? `Show people our new ${name}` : c.type === "OFFER" ? `Tell people about ${name}` : `Get people talking about ${name}`;
  const extra = c.highlights?.find((h) => h.trim())?.trim();
  const line = extra ? `${start}: ${extra}` : start;
  return line.length > MAX_IDEA ? start.slice(0, MAX_IDEA) : line;
}

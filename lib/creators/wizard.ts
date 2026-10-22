// The 12 steps a company makes a creator campaign in (docs/CREATOR_CAMPAIGN_WIZARD.md). Pure: the steps, their
// answers' words and checks, and what must be ready before the campaign goes live, shared by the wizard, the server
// and the tests.
//
// Owner decisions (22 October 2026): one screen per step with a progress bar and Next / Back; the owner writes one
// line and the AI fills every step from it and Business info, the owner edits; the draft is saved after each step
// (the list shows "Continue: step 6 of 12"); Settings opens the same steps, any one at a time.

import { z } from "zod";

export const WIZARD_STEPS = [
  { id: "idea", title: "Idea", question: "What is the campaign about?" },
  { id: "goal", title: "Goal", question: "What do you want from it?" },
  { id: "creators", title: "Creators", question: "Who should post for you?" },
  { id: "where", title: "Where", question: "Where should they post?" },
  { id: "when", title: "When", question: "When does it run?" },
  { id: "content", title: "Content", question: "What should they post?" },
  { id: "rules", title: "Rules", question: "What's allowed and what isn't?" },
  { id: "pay", title: "Pay", question: "How do creators earn?" },
  { id: "form", title: "Form", question: "What do you ask when they apply?" },
  { id: "files", title: "Files", question: "What do creators need from you?" },
  { id: "look", title: "Look", question: "How does your application page look?" },
  { id: "review", title: "Review", question: "Is everything right?" },
] as const;
export type WizardStepId = (typeof WIZARD_STEPS)[number]["id"];
export const STEP_COUNT = WIZARD_STEPS.length;

/** The 1-based number of a step. */
export const stepNumber = (id: WizardStepId) => WIZARD_STEPS.findIndex((s) => s.id === id) + 1;
export const stepAt = (n: number) => WIZARD_STEPS[Math.min(STEP_COUNT, Math.max(1, Math.floor(n))) - 1];

export const CAMPAIGN_KINDS = [
  { value: "PRODUCT_REVIEW", label: "Product review", hint: "Creators try your product and say what they think." },
  { value: "CHALLENGE", label: "Challenge", hint: "A fun thing to copy: a dance, a trend, a hashtag." },
  { value: "UNBOXING", label: "Unboxing", hint: "Opening and showing a new product." },
  { value: "TUTORIAL", label: "How-to", hint: "Showing how to use or cook or wear something." },
  { value: "EVENT", label: "Event", hint: "Getting people to come to a day, a show or an opening." },
  { value: "LAUNCH", label: "Launch", hint: "Something new: a product, a branch, a menu." },
  { value: "TESTIMONIAL", label: "Testimonial", hint: "Real customers telling their story." },
  { value: "OTHER", label: "Other", hint: "Anything else." },
] as const;
export type CampaignKind = (typeof CAMPAIGN_KINDS)[number]["value"];

export const CAMPAIGN_GOALS = [
  { value: "VIEWS", label: "Get seen", hint: "As many people as possible see your brand." },
  { value: "SALES", label: "Sell more", hint: "People buy, order or book." },
  { value: "VISITS", label: "Visits", hint: "People come to your shop, event or website." },
  { value: "FOLLOWERS", label: "Followers", hint: "More people follow your own pages." },
  { value: "DOWNLOADS", label: "App downloads", hint: "People install your app." },
] as const;
export type CampaignGoal = (typeof CAMPAIGN_GOALS)[number]["value"];

export const POST_FORMATS = [
  { value: "REEL", label: "Reel / short video" },
  { value: "STORY", label: "Story" },
  { value: "POST", label: "Photo post" },
  { value: "CAROUSEL", label: "Carousel (several photos)" },
  { value: "LIVE", label: "Live video" },
] as const;
export type PostFormat = (typeof POST_FORMATS)[number]["value"];

/** How often creators get a new brief (a task): the owner's "one brief per month, week or day". */
export const BRIEF_EVERY = [
  { value: "MONTH", label: "One brief for the whole campaign" },
  { value: "WEEK", label: "A new brief every week" },
  { value: "DAY", label: "A new brief every day" },
] as const;
export type BriefEvery = (typeof BRIEF_EVERY)[number]["value"];

/** Quick picks for the Rules step (the AI adds its own from the brief). */
export const DO_SUGGESTIONS = [
  "Show the product in the first 3 seconds",
  "Say our name out loud",
  "Film in good light",
  "Use the campaign hashtag",
  "Tag our account",
  "Film vertically (9:16)",
  "Add captions to your video",
  "Be yourself: your own words and style",
] as const;
export const DONT_SUGGESTIONS = [
  "No other brands in view",
  "No bad language",
  "Keep it family friendly",
  "No false claims about the product",
  "Don't delete the post before the campaign ends",
  "No copyrighted music the platform doesn't allow",
  "Don't buy views or followers",
  "No alcohol or smoking in the video",
] as const;

/** Where the campaign's files are: Photos folders made for it, a shared Drive folder, links to posts the owner likes. */
export const filesSchema = z.object({
  imagesFolderId: z.string().max(40).nullish(),
  videosFolderId: z.string().max(40).nullish(),
  documentsFolderId: z.string().max(40).nullish(),
  /** A shared Google Drive folder (optional): https://drive.google.com/drive/folders/... */
  driveUrl: z
    .string()
    .trim()
    .max(500)
    .refine((v) => /^https:\/\/drive\.google\.com\//.test(v), "Paste the link of a shared Google Drive folder.")
    .nullish(),
  /** Posts the owner likes, as examples (the mood board). */
  exampleLinks: z.array(z.string().trim().url("Paste full links, starting with https://").max(500)).max(10).default([]),
});
export type CampaignFiles = z.infer<typeof filesSchema>;

export function readFiles(value: unknown): CampaignFiles {
  const parsed = filesSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : { exampleLinks: [] };
}

/** The application page's look: the brand's logo and colours always; a cover photo or video from Photos if picked. */
export const lookSchema = z.object({ coverAssetId: z.string().max(40).nullish() });
export type CampaignLook = z.infer<typeof lookSchema>;

export function readLook(value: unknown): CampaignLook {
  const parsed = lookSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : {};
}

/** The counts goLiveProblems needs, read by the server. */
export type ReadinessFacts = {
  brief: string;
  dos: string[];
  donts: string[];
  /** Tasks with instructions. */
  tasks: number;
  /** Files in the campaign's Images folder (logo and product photos). */
  images: number;
  /** Files in its Videos folder. */
  videos: number;
  exampleLinks: number;
};

/**
 * What is missing before the campaign can go live, one line each (empty: ready). Owner decision: the logo and
 * product photos, the brief, the do's and don'ts, example videos or a mood board, and the instructions (tasks).
 */
export function goLiveProblems(f: ReadinessFacts): string[] {
  const out: string[] = [];
  if (f.brief.trim().length < 10) out.push("Write the brief (step Content).");
  if (f.tasks === 0) out.push("Add at least one task with instructions (step Content).");
  if (f.dos.length === 0 || f.donts.length === 0) out.push("Add at least one do and one don't (step Rules).");
  if (f.images === 0) out.push("Add your logo and product photos to the Images folder (step Files).");
  if (f.videos === 0 && f.exampleLinks === 0) out.push("Add an example video or a link to a post you like (step Files).");
  return out;
}

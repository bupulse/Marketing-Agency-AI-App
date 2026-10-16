// The Autopilot playbook: proven post types ("ideas") that work for any small business.
// An idea says what the post is for, which networks and formats it suits, which free brand
// template its image uses, and how the AI should write it. Nothing here is specific to one
// business: industries are only soft tags (see industryTags), and ideas that need facts the
// business has not given (a project, an FAQ, opening hours, a holiday) are skipped for it.
import type { TemplateId } from "@/lib/designs/templates/registry";
import type { Network } from "@/lib/social/types";

export type Goal = "awareness" | "engagement" | "sales" | "trust";
export type AutopilotFormat = "POST" | "CAROUSEL" | "ARTICLE" | "SCRIPT";
export type IndustryTag =
  | "retail"
  | "food"
  | "beauty"
  | "health"
  | "education"
  | "construction"
  | "realestate"
  | "hospitality"
  | "fitness"
  | "professional";

/** Facts an idea needs before it can be written without inventing anything. */
export type Need = "project" | "faq" | "holiday" | "hours";

export interface Idea {
  id: string;
  name: string;
  goal: Goal;
  /** Industry tags it suits, or "all". */
  industries: IndustryTag[] | "all";
  /** The networks it suits and the format used on each. */
  formats: Partial<Record<Network, AutopilotFormat>>;
  /** Free brand template for the image, or null when the post has no image of its own. */
  template: TemplateId | null;
  /** English label above the headline on the image (the writer translates it). */
  kicker: string;
  needs: Need[];
  /** With needs "project": Project.type values that fit. Any type when omitted. */
  projectTypes?: string[];
  /** With needs "holiday": only days people shop or celebrate around. */
  commercialHoliday?: boolean;
  /** Instructions for the writer. */
  guidance: string;
  /** Relative chance before learning; 1 by default. */
  weight?: number;
}

const SOCIAL = { instagram: "POST", facebook: "POST", linkedin: "POST" } as const;
const VIDEO = { tiktok: "SCRIPT", youtube: "SCRIPT" } as const;

export const IDEAS: Idea[] = [
  // ---- Sales ----
  {
    id: "offer-promo",
    name: "Offer or promotion",
    goal: "sales",
    industries: "all",
    formats: { ...SOCIAL },
    template: "offer",
    kicker: "Special offer",
    needs: ["project"],
    projectTypes: ["offer", "product", "service"],
    guidance:
      "Promote the offer. State the price or discount exactly as written in the facts, say who it is for and why it is worth acting on, and end with one clear call to action. Mention a deadline only if the facts give one.",
  },
  {
    id: "new-arrival",
    name: "New arrival",
    goal: "sales",
    industries: "all",
    formats: { ...SOCIAL, instagram: "CAROUSEL" },
    template: "new-arrival",
    kicker: "New arrival",
    needs: ["project"],
    projectTypes: ["product"],
    guidance:
      "Announce something new. Lead with what it is and the one thing customers will like most, use only the listed features, and invite people to come and see it or get in touch.",
  },
  {
    id: "service-spotlight",
    name: "Service spotlight",
    goal: "sales",
    industries: "all",
    formats: { ...SOCIAL },
    template: "announcement",
    kicker: "Our service",
    needs: ["project"],
    projectTypes: ["service"],
    guidance:
      "Explain one service in plain words: who it helps, what they get and how to start. Use only the listed features. Finish with a friendly call to action.",
  },
  {
    id: "just-listed",
    name: "Just listed",
    goal: "sales",
    industries: ["realestate", "hospitality", "retail"],
    formats: { ...SOCIAL, instagram: "CAROUSEL", facebook: "CAROUSEL" },
    template: "just-listed",
    kicker: "Just listed",
    needs: ["project"],
    projectTypes: ["listing"],
    guidance:
      "Present the listing: what it is, where, the main selling points from the facts, and the price exactly as written. Invite people to ask for a viewing or more details.",
  },
  {
    id: "offer-last-chance",
    name: "Offer reminder",
    goal: "sales",
    industries: "all",
    formats: { instagram: "POST", facebook: "POST" },
    template: "offer",
    kicker: "Don't miss it",
    needs: ["project"],
    projectTypes: ["offer"],
    guidance:
      "A short, friendly reminder about an offer people may have missed. Do not invent a deadline or a stock level; only mention timing if the facts give it. One call to action.",
    weight: 0.7,
  },
  {
    id: "holiday-offer",
    name: "Holiday offer",
    goal: "sales",
    industries: "all",
    formats: { ...SOCIAL },
    template: "offer",
    kicker: "Special offer",
    needs: ["holiday", "project"],
    projectTypes: ["offer", "product", "service"],
    commercialHoliday: true,
    guidance:
      "Tie the offer to the occasion named in the facts with a warm, respectful greeting first. Use the offer details exactly as given and never invent a discount.",
  },
  {
    id: "buyer-guide",
    name: "Buyer's guide",
    goal: "trust",
    industries: ["retail", "realestate", "professional"],
    formats: { ...SOCIAL },
    template: "announcement",
    kicker: "Buyer's guide",
    needs: [],
    guidance:
      "Give three practical things to check before buying what this business sells. Use well-known, general advice only, with no statistics, prices or claims. Close by offering help.",
  },
  {
    id: "menu-special",
    name: "Today's special",
    goal: "sales",
    industries: ["food", "hospitality"],
    formats: { instagram: "CAROUSEL", facebook: "POST" },
    template: "new-arrival",
    kicker: "Today's special",
    needs: ["project"],
    projectTypes: ["product", "offer"],
    guidance:
      "Make the dish or drink sound delicious using only the listed details: what it is, what makes it good, the price as written. Invite people to come and try it.",
  },
  // ---- Trust ----
  {
    id: "project-showcase",
    name: "Finished project",
    goal: "trust",
    industries: "all",
    formats: { ...SOCIAL, instagram: "CAROUSEL", ...VIDEO },
    template: "project-done",
    kicker: "Project done",
    needs: ["project"],
    projectTypes: ["project"],
    guidance:
      "Show off finished work: what was done, for whom (only if given), and what the result is, using the listed features. Be proud but factual and invite people to ask for a quote.",
  },
  {
    id: "before-after",
    name: "Before and after",
    goal: "trust",
    industries: ["construction", "beauty", "fitness", "health", "professional"],
    formats: { instagram: "CAROUSEL", facebook: "CAROUSEL", linkedin: "POST", tiktok: "SCRIPT" },
    template: "project-done",
    kicker: "Before and after",
    needs: ["project"],
    projectTypes: ["project", "service"],
    guidance:
      "Tell the story of a transformation: how it started, what was done, how it turned out, using only the facts given. Never invent measurements or results. Invite people to start their own.",
  },
  {
    id: "customer-story",
    name: "Customer story",
    goal: "trust",
    industries: "all",
    formats: { ...SOCIAL },
    template: "project-done",
    kicker: "Customer story",
    needs: ["project"],
    projectTypes: ["project", "service"],
    guidance:
      "Tell the story of a piece of work from the customer's side, in the third person. NEVER invent a quote, a name, a review or a customer's words; only use what the facts say happened.",
  },
  {
    id: "faq-answer",
    name: "Question we get asked",
    goal: "trust",
    industries: "all",
    formats: { ...SOCIAL },
    template: "quote",
    kicker: "",
    needs: ["faq"],
    guidance:
      "Answer the question given in the facts, using that answer only. Open with the question, explain it simply in the business's voice and invite people to ask anything else. Add nothing the answer does not say.",
  },
  {
    id: "how-we-work",
    name: "How we work",
    goal: "trust",
    industries: "all",
    formats: { ...SOCIAL },
    template: "announcement",
    kicker: "How we work",
    needs: [],
    guidance:
      "Describe how a customer works with this business in three simple steps, drawing only on what the business description says it does. Do not invent processes, timings or guarantees.",
  },
  {
    id: "behind-the-scenes",
    name: "Behind the scenes",
    goal: "trust",
    industries: "all",
    formats: { ...SOCIAL, tiktok: "SCRIPT" },
    template: "announcement",
    kicker: "Behind the scenes",
    needs: [],
    guidance:
      "Give a human look at a normal day of this kind of business, based only on the business description. Warm and honest, no invented events, names or numbers. Ask followers what they would like to see.",
  },
  {
    id: "meet-the-team",
    name: "Meet the team",
    goal: "trust",
    industries: "all",
    formats: { ...SOCIAL },
    template: "announcement",
    kicker: "Meet the team",
    needs: [],
    guidance:
      "Introduce the people behind the business. Use the owner's name only if it is in the facts; never invent names, roles or backgrounds. Speak about the team in general terms and invite people to say hello.",
    weight: 0.8,
  },
  {
    id: "local-community",
    name: "Local pride",
    goal: "awareness",
    industries: "all",
    formats: { ...SOCIAL },
    template: "announcement",
    kicker: "Proud to serve",
    needs: [],
    guidance:
      "Celebrate the area the business serves and its customers. Use the area from the facts if given, otherwise keep it general. No invented landmarks, events or statistics.",
    weight: 0.8,
  },
  {
    id: "hours-visit",
    name: "Visit us",
    goal: "sales",
    industries: "all",
    formats: { instagram: "POST", facebook: "POST" },
    template: "announcement",
    kicker: "Visit us",
    needs: ["hours"],
    guidance:
      "Invite people to visit or get in touch, giving the opening hours exactly as written in the facts. Mention one reason to drop by, based on the business description.",
    weight: 0.7,
  },
  {
    id: "thank-you",
    name: "Thank you to customers",
    goal: "trust",
    industries: "all",
    formats: { ...SOCIAL },
    template: "announcement",
    kicker: "Thank you",
    needs: [],
    guidance:
      "A sincere thank-you to customers and followers. No invented numbers, milestones or years. Keep it short and personal.",
    weight: 0.7,
  },
  {
    id: "milestone",
    name: "Milestone",
    goal: "trust",
    industries: "all",
    formats: { ...SOCIAL },
    template: "announcement",
    kicker: "Milestone",
    needs: ["project"],
    projectTypes: ["milestone"],
    guidance:
      "Celebrate the milestone described in the facts, exactly as stated, thank the people who made it possible and look ahead without promising anything specific.",
  },
  {
    id: "myth-buster",
    name: "Myth or fact",
    goal: "engagement",
    industries: "all",
    formats: { ...SOCIAL },
    template: "quote",
    kicker: "",
    needs: [],
    guidance:
      "Pick one common misconception customers have about what this business does or sells and correct it with well-known, general knowledge. No statistics, studies or numbers. Friendly, never condescending.",
  },
  // ---- Engagement ----
  {
    id: "tip-how-to",
    name: "Quick tip",
    goal: "engagement",
    industries: "all",
    formats: { ...SOCIAL, tiktok: "SCRIPT" },
    template: "announcement",
    kicker: "Quick tip",
    needs: [],
    guidance:
      "Share one genuinely useful, practical tip related to what the business does, in 2 to 4 short steps. General, well-known advice only: no statistics, prices, dates or guarantees.",
    weight: 1.3,
  },
  {
    id: "did-you-know",
    name: "Did you know",
    goal: "engagement",
    industries: "all",
    formats: { ...SOCIAL },
    template: "quote",
    kicker: "",
    needs: [],
    guidance:
      "Share one interesting, widely known fact about the industry or the products and services here, with no numbers, dates or statistics. If unsure, share something true about the business from its description instead.",
    weight: 0.8,
  },
  {
    id: "poll-question",
    name: "Question for followers",
    goal: "engagement",
    industries: "all",
    formats: { instagram: "POST", facebook: "POST", linkedin: "POST" },
    template: "announcement",
    kicker: "Your turn",
    needs: [],
    guidance:
      "Ask followers one simple, fun question that is easy to answer in the comments, linked to what the business does. Offer two or three options to pick from. Invite replies, nothing else to promote.",
  },
  {
    id: "this-or-that",
    name: "This or that",
    goal: "engagement",
    industries: "all",
    formats: { instagram: "POST", facebook: "POST" },
    template: "announcement",
    kicker: "This or that?",
    needs: [],
    guidance:
      "A playful 'this or that' choice between two things relevant to the business's customers. One line of setup, ask people to comment A or B.",
    weight: 0.7,
  },
  {
    id: "local-event",
    name: "Event invitation",
    goal: "engagement",
    industries: "all",
    formats: { ...SOCIAL },
    template: "event",
    kicker: "You are invited",
    needs: ["project"],
    projectTypes: ["event"],
    guidance:
      "Invite people to the event. State the date, time and place only exactly as written in the facts, say what to expect from the listed features, and tell people how to join or ask questions.",
  },
  {
    id: "holiday-greeting",
    name: "Holiday greeting",
    goal: "awareness",
    industries: "all",
    formats: { ...SOCIAL },
    template: "announcement",
    kicker: "Warm wishes",
    needs: ["holiday"],
    guidance:
      "Wish customers well for the occasion named in the facts, warmly and respectfully, in the business's voice. Do not explain the holiday's history or invent traditions. If the business is closed or open that day is not known, so do not say either.",
    weight: 2,
  },
  {
    id: "seasonal",
    name: "Time of year",
    goal: "awareness",
    industries: "all",
    formats: { ...SOCIAL },
    template: "announcement",
    kicker: "This week",
    needs: [],
    guidance:
      "Connect the business to the time of year (use only the date given: the start of a month, mid-year, the end of the year). Do not assume the weather or the season in the customer's country. Offer something helpful or a friendly nudge.",
    weight: 0.6,
  },
  // ---- Industry-flavoured (soft tags) ----
  {
    id: "health-tip",
    name: "Wellbeing tip",
    goal: "trust",
    industries: ["health", "fitness", "beauty"],
    formats: { ...SOCIAL, tiktok: "SCRIPT" },
    template: "announcement",
    kicker: "Wellbeing tip",
    needs: [],
    guidance:
      "One simple, safe, widely accepted wellbeing tip for customers. No medical claims, cures, dosages or statistics. Suggest seeing a professional for personal advice.",
  },
  {
    id: "learning-tip",
    name: "Learning tip",
    goal: "trust",
    industries: ["education"],
    formats: { ...SOCIAL },
    template: "announcement",
    kicker: "Study tip",
    needs: [],
    guidance:
      "One practical learning or study tip for students or parents. General advice only, no statistics or guaranteed outcomes.",
  },
  {
    id: "safety-tip",
    name: "Safety first",
    goal: "trust",
    industries: ["construction", "health"],
    formats: { ...SOCIAL },
    template: "announcement",
    kicker: "Safety first",
    needs: [],
    guidance:
      "One practical, well-known safety reminder relevant to the work. No regulations, numbers or legal claims; suggest asking a professional for specifics.",
    weight: 0.8,
  },
  // ---- LinkedIn long-form ----
  {
    id: "li-thought-leadership",
    name: "Thought leadership article",
    goal: "trust",
    industries: "all",
    formats: { linkedin: "ARTICLE" },
    template: null,
    kicker: "",
    needs: [],
    guidance:
      "A blog-like article for LinkedIn, 350 to 600 words: a clear title, a short opening, three or four sections with plain headings, and a closing thought that invites conversation. Share an informed point of view about the industry, grounded in the business description. No invented statistics, case studies, quotes or client names.",
    weight: 1.2,
  },
  {
    id: "li-how-it-works",
    name: "Explainer article",
    goal: "awareness",
    industries: "all",
    formats: { linkedin: "ARTICLE" },
    template: null,
    kicker: "",
    needs: [],
    guidance:
      "A practical LinkedIn article, 300 to 500 words, explaining what working with this business is like and what a customer should prepare or ask. Title, short intro, numbered steps or short sections, closing call to action. Use only the business description; invent no processes, prices or promises.",
  },
  {
    id: "li-company-story",
    name: "Our story",
    goal: "trust",
    industries: "all",
    formats: { linkedin: "POST" },
    template: null,
    kicker: "",
    needs: [],
    guidance:
      "A professional, human post about why this business exists and who it serves, based only on the business description. Short paragraphs, one clear takeaway, an invitation to connect. No invented dates, founders or numbers.",
    weight: 0.8,
  },
  {
    id: "li-lessons",
    name: "Lessons learned",
    goal: "engagement",
    industries: "all",
    formats: { linkedin: "POST" },
    template: null,
    kicker: "",
    needs: [],
    guidance:
      "A reflective LinkedIn post sharing three practical lessons for customers or peers in this industry, written as advice, not as a claim about this business's history. No statistics. End with a question for the comments.",
  },
  // ---- Video scripts (TikTok, YouTube, Reels) ----
  {
    id: "reel-day-in-life",
    name: "Day in the life (video)",
    goal: "awareness",
    industries: "all",
    formats: { ...VIDEO, instagram: "SCRIPT" },
    template: null,
    kicker: "",
    needs: [],
    guidance:
      "A 30 to 45 second vertical video script showing a normal day at the business. Timestamped scenes, a shot direction and a voiceover line for each, a hook in the first 3 seconds. Use only filmable moments that any business of this kind has; invent no events or numbers.",
    weight: 0.6,
  },
  {
    id: "reel-quick-tip",
    name: "60-second tip (video)",
    goal: "engagement",
    industries: "all",
    formats: { ...VIDEO, instagram: "SCRIPT" },
    template: null,
    kicker: "",
    needs: [],
    guidance:
      "A 30 to 45 second vertical video script teaching one practical tip. Hook, 2 or 3 timestamped steps with shot directions and voiceover, and a closing call to follow or visit. General advice only, no statistics.",
    weight: 0.7,
  },
  {
    id: "reel-showcase",
    name: "Product or service demo (video)",
    goal: "sales",
    industries: "all",
    formats: { ...VIDEO, instagram: "SCRIPT" },
    template: null,
    kicker: "",
    needs: ["project"],
    projectTypes: ["product", "service", "offer", "project"],
    guidance:
      "A 30 to 45 second vertical video script showing off the item in the facts: hook, three timestamped scenes with shot directions and voiceover built from the listed features, and a call to action. Price only as written.",
    weight: 0.6,
  },
  {
    id: "reel-faq",
    name: "Answer a question (video)",
    goal: "trust",
    industries: "all",
    formats: { ...VIDEO, instagram: "SCRIPT" },
    template: null,
    kicker: "",
    needs: ["faq"],
    guidance:
      "A 30 second vertical video script where someone from the business answers the question in the facts, using that answer only. Hook with the question, answer in short beats with shot directions, end with an invitation to ask more.",
    weight: 0.6,
  },
  {
    id: "reel-myth-vs-fact",
    name: "Myth vs fact (video)",
    goal: "engagement",
    industries: "all",
    formats: { ...VIDEO, instagram: "SCRIPT" },
    template: null,
    kicker: "",
    needs: [],
    guidance:
      "A 30 second vertical video script that busts one common misconception in this industry with general, well-known knowledge. Hook, 'myth', 'fact', and a closing call to action. No statistics or studies.",
    weight: 0.5,
  },
];

export function getIdea(id: string | null | undefined): Idea | undefined {
  return IDEAS.find((i) => i.id === id);
}

// Business.industry is one of the site's industry names or free text; match it loosely.
const INDUSTRY_PATTERNS: [RegExp, IndustryTag][] = [
  [/shop|retail|store|electronic|phone|boutique|market|machinery|equipment|fashion|furniture/i, "retail"],
  [/restaurant|caf[eé]|bakery|food|coffee|catering|bar\b|kitchen|grill|pizza/i, "food"],
  [/beauty|salon|spa\b|hair|nail|cosmetic|barber|makeup/i, "beauty"],
  [/clinic|health|dental|dentist|pharmac|medical|doctor|hospital|therap/i, "health"],
  [/school|training|academy|college|universit|tutor|nursery|education|course/i, "education"],
  [/construction|builder|building|architect|plumb|electric|engineer|carpent|paint|renovat/i, "construction"],
  [/real estate|estate agent|property|realt|listing|rental/i, "realestate"],
  [/hotel|hospitality|travel|tour|lodge|guest ?house|resort|safari/i, "hospitality"],
  [/gym|fitness|sport|crossfit|yoga|martial|boxing|wellness/i, "fitness"],
  [/\bit\b|software|consult|law|legal|account|finance|insurance|marketing|agency|professional|service/i, "professional"],
];

/** Industry tags for a business's free-text industry (possibly several, possibly none). */
export function industryTags(industry: string | null | undefined): IndustryTag[] {
  if (!industry) return [];
  const tags = INDUSTRY_PATTERNS.filter(([re]) => re.test(industry)).map(([, tag]) => tag);
  return [...new Set(tags)];
}

/** The networks an idea can be written for. */
/**
 * The post types a week with products mixes (planner.ts): something new, a tip, an offer, in that order as the week
 * has room, each a designed picture. Each is a set of ideas; one of them is chosen as usual.
 */
export const POST_MIX: readonly (readonly string[])[] = [
  ["new-arrival", "just-listed", "menu-special", "service-spotlight"],
  ["tip-how-to", "did-you-know", "myth-buster", "health-tip", "learning-tip", "safety-tip", "faq-answer", "buyer-guide"],
  ["offer-promo", "offer-last-chance", "holiday-offer"],
];

/** Networks whose posts always show a picture (or a video BuPulse makes): never a script to film by hand. */
export const PICTURE_NETWORKS: ReadonlySet<Network> = new Set<Network>(["instagram", "facebook"]);

export function ideaNetworks(idea: Idea): Network[] {
  return Object.keys(idea.formats) as Network[];
}

/** A video idea has a TikTok or YouTube script (Instagram gets it as a Reels script). */
export function isVideoIdea(idea: Idea): boolean {
  return idea.formats.tiktok === "SCRIPT" || idea.formats.youtube === "SCRIPT";
}

/** Whether the idea suits a business with these industry tags. */
export function suitsIndustry(idea: Idea, tags: IndustryTag[]): boolean {
  return idea.industries === "all" || idea.industries.some((t) => tags.includes(t));
}

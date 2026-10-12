// The weekly planner: chooses what to post, on which accounts and when. It decides; it does not
// write text or draw images (writer.ts and images.ts do), and `buildWeekPlan` is pure so the
// distribution and the time slots can be tested without a database or the AI.
import { getProvider } from "@/lib/social/registry";
import type { Network } from "@/lib/social/types";
import type { Holiday } from "./calendar";
import {
  chooseIdea,
  preferredHours,
  preferredWeekdays,
  seededRandom,
  type LearningProfile,
} from "./learning";
import { ideaNetworks, isVideoIdea, suitsIndustry, type AutopilotFormat, type Idea, type IndustryTag, IDEAS } from "./playbook";
import type { AutopilotConfig } from "./settings";
import { DEFAULT_POSTING_TIMES } from "./settings";
import { localDateISO, minutesOf, weekDates, weekdayOfISO, zonedToUtc } from "./timezone";

export interface PlanConnection {
  id: string;
  network: Network;
}

/** A product or campaign Autopilot may post about (the name is from before the Knowledge base). */
export interface PlanProject {
  id: string;
  /** Whether `id` is a product's or a campaign's (posts and designs link to it). Older callers leave it out: product. */
  subject?: "product" | "campaign";
  /** The fenced data block for the writer (lib/knowledge/context.ts). */
  context?: string;
  title: string;
  type: string;
  price: string | null;
  features: string[];
  notes?: string;
  photoPaths: string[];
  createdAt: Date;
  /** Posts already made about it (any source); 0 means it was never posted. */
  postedCount: number;
  lastPostedAt: Date | null;
}

export interface PlanPhoto {
  id: string;
  path: string;
  folderId: string | null;
  mimeType: string;
  /** How often it was used in the last weeks. */
  recentUses: number;
}

export interface PlanFaq {
  question: string;
  answer: string;
}

export interface PlanInput {
  businessId: string;
  weekStart: Date;
  timeZone: string;
  country: string | null;
  industryTags: IndustryTag[];
  config: AutopilotConfig;
  connections: PlanConnection[];
  projects: PlanProject[];
  faqs: PlanFaq[];
  hasHours: boolean;
  /** Holidays of the week, already filtered for the owner's "skip religious holidays" choice. */
  holidays: Holiday[];
  photos: PlanPhoto[];
  /** Posts already scheduled in the week, so new ones do not clash with them. */
  existing: { connectionId: string | null; scheduledAt: Date }[];
  /** How often each idea was used in the last weeks. */
  recentIdeas: Map<string, number>;
  profile: LearningProfile;
  now: Date;
}

export interface PlannedPost {
  connectionId: string;
  network: Network;
  format: AutopilotFormat;
  scheduledAt: Date;
}

export interface PlannedGroup {
  groupId: string;
  idea: Idea;
  /** Local "YYYY-MM-DD". */
  day: string;
  project?: PlanProject;
  faq?: PlanFaq;
  holiday?: Holiday;
  /** First is the cover (drawn into the template); the rest join a carousel as they are. */
  photos: { path: string; fromProject: boolean; mimeType?: string }[];
  networks: Network[];
  posts: PlannedPost[];
}

export interface WeekPlan {
  groups: PlannedGroup[];
  notes: string[];
}

/** Minimum gap between two posts on one account. */
const MIN_GAP_MINUTES = 150;
const LEAD_MINUTES = 15;

/** Whether a network can publish a format in Stage 1 (SCRIPT is always allowed as a reminder). */
export function formatAllowed(network: Network, format: AutopilotFormat): boolean {
  if (format === "SCRIPT" || format === "POST") return true;
  return getProvider(network).rules.formats.includes(format);
}

interface Pool {
  projects: PlanProject[];
  faqs: PlanFaq[];
  photos: PlanPhoto[];
}

type Pick = { idea: Idea; project?: PlanProject; faq?: PlanFaq; holiday?: Holiday };

function eligible(
  idea: Idea,
  ctx: { networks: Set<Network>; tags: IndustryTag[]; pool: Pool; holidays: Holiday[]; hasHours: boolean },
): Pick[] {
  if (!ideaNetworks(idea).some((n) => ctx.networks.has(n))) return [];
  if (!suitsIndustry(idea, ctx.tags)) return [];
  if (idea.needs.includes("hours") && !ctx.hasHours) return [];
  if (idea.needs.includes("faq") && ctx.pool.faqs.length === 0) return [];
  const holidays = idea.needs.includes("holiday")
    ? ctx.holidays.filter((h) => !h.sensitive && (!idea.commercialHoliday || h.commercial))
    : [undefined];
  if (holidays.length === 0) return [];
  const projects = idea.needs.includes("project")
    ? ctx.pool.projects.filter((p) => !idea.projectTypes || idea.projectTypes.includes(p.type))
    : [undefined];
  if (projects.length === 0) return [];
  const faq = idea.needs.includes("faq") ? ctx.pool.faqs[0] : undefined;
  return projects.flatMap((project) => holidays.map((holiday) => ({ idea, project, faq, holiday })));
}

/** Newest never-posted projects first, then the ones posted longest ago. */
function projectRank(p: PlanProject): number {
  if (p.postedCount === 0) return 1e15 + p.createdAt.getTime();
  return -(p.lastPostedAt?.getTime() ?? 0);
}

/** Builds the week: which ideas, for which accounts, on which days and at what times. */
export function buildWeekPlan(input: PlanInput): WeekPlan {
  const { config, timeZone, profile, now } = input;
  const notes: string[] = [];
  const rng = seededRandom(`${input.businessId}|${input.weekStart.toISOString()}`);
  const dates = weekDates(input.weekStart, timeZone);
  const today = localDateISO(now, timeZone);

  const networks = new Set(input.connections.map((c) => c.network));
  if (networks.size === 0) return { groups: [], notes: ["No accounts are connected to Autopilot."] };

  // Remembrance days stay quiet; past days are gone.
  const quiet = new Set(input.holidays.filter((h) => h.sensitive).map((h) => h.date));
  const days = dates.filter((d) => !quiet.has(d) && d >= today);
  if (days.length === 0) return { groups: [], notes: ["There are no days left in this week to plan."] };

  const n = config.postsPerWeek;
  const pool: Pool = {
    projects: [...input.projects].sort((a, b) => projectRank(b) - projectRank(a)),
    faqs: [...input.faqs].sort(() => rng() - 0.5),
    photos: input.photos,
  };
  const ctx = { networks, tags: input.industryTags, pool, holidays: input.holidays.filter((h) => days.includes(h.date)), hasHours: input.hasHours };
  const hasFresh = input.projects.some((p) => p.postedCount === 0);

  const picks: Pick[] = [];
  const chosenIds = new Set<string>();
  const chosenGoals: Idea["goal"][] = [];
  const covered = new Set<Network>();

  const take = (pick: Pick) => {
    picks.push(pick);
    chosenIds.add(pick.idea.id);
    chosenGoals.push(pick.idea.goal);
    for (const net of ideaNetworks(pick.idea)) if (networks.has(net)) covered.add(net);
    if (pick.project) pool.projects = pool.projects.filter((p) => p !== pick.project);
    if (pick.faq) pool.faqs = pool.faqs.filter((f) => f !== pick.faq);
  };

  // Video scripts are reminders for the owner to film: a few a week, not most of the plan, unless
  // the only accounts are video ones.
  const onlyVideo = [...networks].every((x) => x === "tiktok" || x === "youtube");
  const videoCap = onlyVideo ? n : Math.max(1, Math.floor(n / 4));
  const videoCount = () => picks.filter((p) => isVideoIdea(p.idea)).length;

  const candidates = (filter: (idea: Idea) => boolean = () => true): Pick[] =>
    IDEAS.filter((i) => !chosenIds.has(i.id) && filter(i) && !(isVideoIdea(i) && videoCount() >= videoCap)).flatMap((idea) => eligible(idea, ctx));

  // Choose among candidates by idea, then take a concrete project/holiday for it.
  const chooseFrom = (list: Pick[]): Pick | null => {
    if (list.length === 0) return null;
    const byIdea = new Map<string, Pick[]>();
    for (const p of list) byIdea.set(p.idea.id, [...(byIdea.get(p.idea.id) ?? []), p]);
    const weighted = [...byIdea.values()].map((ps) => {
      const idea = ps[0].idea;
      const boost = hasFresh && ps.some((p) => p.project?.postedCount === 0) ? 2 : 1;
      // An idea that serves more of the connected accounts makes the week go further.
      const reach = ideaNetworks(idea).filter((x) => networks.has(x)).length / networks.size;
      return { ...idea, weight: (idea.weight ?? 1) * boost * (0.4 + 0.6 * reach) };
    });
    const idea = chooseIdea(weighted, { profile, rng, recent: input.recentIdeas, chosenGoals });
    const options = byIdea.get(idea.id)!;
    return options.find((p) => p.project?.postedCount === 0) ?? options[Math.floor(rng() * options.length)];
  };

  // 1. Holidays in the week come first (at most one per three posts, at least one if there is room).
  const holidayCap = Math.max(1, Math.floor(n / 3));
  const usedHolidayDays = new Set<string>();
  const holidayRank = (h: Holiday) => (h.commercial ? 2 : 0) + (h.scope === "national" ? 1 : 0);
  const dayHolidays = [...ctx.holidays].filter((h) => !h.sensitive).sort((a, b) => holidayRank(b) - holidayRank(a));
  for (const holiday of dayHolidays) {
    if (picks.length >= Math.min(holidayCap, n)) break;
    if (usedHolidayDays.has(holiday.date)) continue;
    const offer = holiday.commercial ? candidates((i) => i.id === "holiday-offer").filter((p) => p.holiday === holiday) : [];
    const greeting = candidates((i) => i.id === "holiday-greeting").filter((p) => p.holiday === holiday);
    const pick = offer.length > 0 && rng() < 0.5 ? offer[0] : greeting[0];
    if (!pick) continue;
    usedHolidayDays.add(holiday.date);
    take(pick);
  }
  const pinned = new Map<Pick, string>(picks.map((p) => [p, p.holiday!.date]));

  // 2. Every connected network gets at least one post, and LinkedIn some long-form.
  const need: ((idea: Idea) => boolean)[] = [];
  const wantsArticle = networks.has("linkedin") && n >= 3 && !picks.some((p) => p.idea.formats.linkedin === "ARTICLE");
  const order: Network[] = ["tiktok", "youtube", "linkedin", "instagram", "facebook"];
  for (const net of order) {
    // An article covers LinkedIn by itself.
    if (net === "linkedin" && wantsArticle) continue;
    if (networks.has(net) && !covered.has(net)) need.push((i) => ideaNetworks(i).includes(net));
  }
  if (wantsArticle) need.push((i) => i.formats.linkedin === "ARTICLE");
  for (const filter of need) {
    if (picks.length >= n) break;
    // Skip when an earlier pick already satisfied it.
    const satisfied = picks.some((p) => filter(p.idea));
    if (satisfied) continue;
    const pick = chooseFrom(candidates((i) => filter(i) && !i.needs.includes("holiday")));
    if (pick) take(pick);
  }

  // 3. The rest by exploiting what works and exploring the rest.
  while (picks.length < n) {
    const pick = chooseFrom(candidates((i) => !i.needs.includes("holiday")));
    if (!pick) break;
    take(pick);
  }
  if (picks.length < n) {
    notes.push(`Only ${picks.length} of ${n} post ideas fit your accounts and details this week. Add a product, offer or photos to get more variety.`);
  }

  // 4. Days: spread the posts over the week, holiday posts on the day itself.
  const dayLoad = new Map<string, number>();
  const chosenDays: string[] = [];
  const dayOf = new Map<Pick, string>();
  for (const [pick, date] of pinned) {
    dayOf.set(pick, date);
    dayLoad.set(date, (dayLoad.get(date) ?? 0) + 1);
    chosenDays.push(date);
  }
  const rest = picks.filter((p) => !pinned.has(p));
  const hardest = [...rest].sort((a, b) => ideaNetworks(a.idea).length - ideaNetworks(b.idea).length);
  for (const pick of hardest) {
    const nets = ideaNetworks(pick.idea).filter((x) => networks.has(x));
    const scored = days.map((date) => {
      const wd = weekdayOfISO(date);
      const pref =
        nets.reduce((sum, net) => {
          const idx = preferredWeekdays(profile, net).indexOf(wd);
          return sum + (idx < 0 ? 0 : 2 - Math.min(idx, 4) * 0.25);
        }, 0) / Math.max(1, nets.length);
      const spacing = chosenDays.length === 0 ? 2 : Math.min(3, Math.min(...chosenDays.map((d) => Math.abs(weekdayOfISO(d) - wd))));
      const crowd = (dayLoad.get(date) ?? 0) * 4;
      return { date, score: pref + spacing - crowd + rng() * 0.5 };
    });
    scored.sort((a, b) => b.score - a.score);
    const date = scored[0].date;
    dayOf.set(pick, date);
    dayLoad.set(date, (dayLoad.get(date) ?? 0) + 1);
    chosenDays.push(date);
  }

  // 5. Photos: unused ones first, varying folders.
  const photoPool = [...input.photos].sort((a, b) => a.recentUses - b.recentUses || rng() - 0.5);
  const usedPhotos = new Set<string>();
  let lastFolder: string | null | undefined;
  const nextPhoto = (templateSafe: boolean): PlanPhoto | undefined => {
    const fresh = photoPool.filter((p) => !usedPhotos.has(p.id) && (!templateSafe || /^image\/(jpeg|png)$/.test(p.mimeType)));
    const other = fresh.find((p) => p.folderId !== lastFolder && p.recentUses === (fresh[0]?.recentUses ?? 0)) ?? fresh[0];
    if (!other) return undefined;
    usedPhotos.add(other.id);
    lastFolder = other.folderId;
    return other;
  };

  // 6. Posts and times, in day order so clashes resolve predictably.
  const clashes: Map<string, Date[]> = new Map();
  const noteTime = (connectionId: string | null, at: Date) => {
    if (!connectionId) return;
    clashes.set(connectionId, [...(clashes.get(connectionId) ?? []), at]);
  };
  for (const e of input.existing) noteTime(e.connectionId, e.scheduledAt);

  const postingPool = config.postingTimes.filter((t) => minutesOf(t) !== null);
  const baseTimes = postingPool.length > 0 ? postingPool : DEFAULT_POSTING_TIMES;

  // The owner's posting times are local wall-clock times in the business's zone ("09:00" in Africa/Kigali is 07:00
  // UTC). They are the times Autopilot MAY post at: what the learning profile knows (the best local hours of past
  // posts) only decides which of them is tried first, it never adds hours of its own. (Learned hours used to come
  // first, so a history that did well at 11:00 local made the planner ignore a 09:00 setting and post two hours late.)
  const slot = (connectionId: string, network: Network, date: string): Date | null => {
    const hours = preferredHours(profile, network);
    const closeness = (t: string) => Math.min(...hours.map((h, i) => Math.abs((minutesOf(t) ?? 0) / 60 - h) + i / 100));
    const ordered = [...baseTimes].sort((a, b) => closeness(a) - closeness(b));
    // Only when every posting time clashes on this account: half-hour slots through the day, nearest to the preferred hour first.
    const fallback: string[] = [];
    for (let h = 8; h <= 21; h++) for (const m of ["00", "30"]) fallback.push(`${String(h).padStart(2, "0")}:${m}`);
    fallback.sort((a, b) => closeness(a) - closeness(b));
    const earliest = now.getTime() + LEAD_MINUTES * 60_000;
    for (const t of [...new Set([...ordered, ...fallback])]) {
      const at = zonedToUtc(date, t, timeZone);
      if (at.getTime() < earliest) continue;
      const others = clashes.get(connectionId) ?? [];
      if (others.every((o) => Math.abs(o.getTime() - at.getTime()) >= MIN_GAP_MINUTES * 60_000)) return at;
    }
    return null;
  };

  const groups: PlannedGroup[] = [];
  const ordered = [...picks].sort((a, b) => dayOf.get(a)!.localeCompare(dayOf.get(b)!));
  for (const pick of ordered) {
    const { idea } = pick;
    const date = dayOf.get(pick)!;
    const wantsImage = idea.template !== null;
    const projectPhotos = (pick.project?.photoPaths ?? []).map((path) => ({ path, fromProject: true }));
    const carousel = Object.values(idea.formats).includes("CAROUSEL");
    const photos: PlannedGroup["photos"] = [...projectPhotos.slice(0, carousel ? 3 : 1)];
    if (wantsImage) {
      const needed = carousel ? 3 : 1;
      while (photos.length < needed) {
        const photo = nextPhoto(photos.length === 0);
        if (!photo) break;
        photos.push({ path: photo.path, fromProject: false, mimeType: photo.mimeType });
      }
    }

    const posts: PlannedPost[] = [];
    for (const connection of input.connections) {
      const format = idea.formats[connection.network];
      if (!format) continue;
      // A carousel needs at least two pictures; otherwise it is one image post.
      const effective: AutopilotFormat = format === "CAROUSEL" && (photos.length < 2 || !formatAllowed(connection.network, "CAROUSEL")) ? "POST" : format;
      const at = slot(connection.id, connection.network, date);
      if (!at) {
        notes.push(`Skipped one ${connection.network} post on ${date}: no free time slot.`);
        continue;
      }
      noteTime(connection.id, at);
      posts.push({ connectionId: connection.id, network: connection.network, format: effective, scheduledAt: at });
    }
    if (posts.length === 0) continue;
    groups.push({
      groupId: globalThis.crypto.randomUUID(),
      idea,
      day: date,
      project: pick.project,
      faq: pick.faq,
      holiday: pick.holiday,
      photos: wantsImage ? photos : [],
      networks: [...new Set(posts.map((p) => p.network))],
      posts,
    });
  }

  return { groups, notes };
}

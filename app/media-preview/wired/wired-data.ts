// Made-up rows in the shapes the wired pages get (ContentPost, CalendarPost, ProductCard, CampaignRow, StudioDesign),
// for the wired preview (app/media-preview/wired). Example businesses and BuPulse's own media: no client data.
import type { ContentPost } from "@/lib/content-board/queries";
import type { CampaignRow } from "@/lib/creators/campaigns";
import type { ProductCard } from "@/lib/knowledge/service";
import type { ComposerContext } from "@/lib/publishing/types";
import type { StudioDesign } from "@/components/designs/design-studio";

const P = "/marketing/posts/";
const W = "/marketing/week/";
const NOW = Date.parse("2026-11-12T10:00:00Z");
const at = (h: number) => new Date(NOW + h * 3_600_000).toISOString();

export const ZONE = "Africa/Kigali";
export const TODAY = "2026-11-12";
export const NOW_ISO = new Date(NOW).toISOString();

export const CONTEXT: ComposerContext = {
  accounts: [
    { id: "a1", network: "instagram", label: "Instagram", displayName: "kigalicafe", avatarUrl: `${P}cafe.webp`, accountType: null, notify: false, usable: true },
    { id: "a2", network: "facebook", label: "Facebook Page", displayName: "Kigali Café", avatarUrl: `${P}cafe.webp`, accountType: null, notify: false, usable: true },
  ],
  rules: {},
  timezone: ZONE,
  slotTimes: ["12:30"],
};

type Over = Partial<ContentPost> & Pick<ContentPost, "id" | "network" | "status">;
const post = (o: Over): ContentPost => ({
  groupId: null,
  connectionId: "a1",
  accountName: "Kigali Café",
  accountAvatar: `${P}cafe.webp`,
  notify: false,
  format: "POST",
  source: "DAILY",
  title: null,
  text: "",
  hashtags: [],
  link: null,
  mediaPaths: [],
  media: [],
  scheduledAt: null,
  publishedAt: null,
  permalink: null,
  lastError: null,
  subjectId: null,
  contentId: null,
  reviewNote: null,
  autoScheduledAt: null,
  remindOnly: false,
  createdAt: at(-20),
  kind: "post",
  excerpt: o.text ?? "",
  poster: null,
  subject: null,
  idea: null,
  contest: null,
  plannedDay: null,
  carryCount: 0,
  ...o,
});
const img = (name: string) => ({ path: `media/${name}`, url: name.startsWith("/") ? name : `${P}${name}` });

export const BOARD: ContentPost[] = [
  post({ id: "b1", groupId: "g1", network: "instagram", status: "PENDING_APPROVAL", scheduledAt: at(26), text: "Weekend brunch is back! Eggs, fresh bread and our house coffee, Saturday and Sunday from 9 am to noon. Kids eat free before 10.", hashtags: ["brunch", "kigali"], media: [img("cafe.webp")], idea: "Offer of the week", subject: { kind: "campaign", id: "c1", name: "Weekend brunch" } }),
  post({ id: "b2", groupId: "g1", network: "facebook", status: "SCHEDULED", scheduledAt: at(27), autoScheduledAt: at(-2), text: "Weekend brunch is back at Kigali Café. Saturday and Sunday, 9 am to noon, from 6,000 RWF.", hashtags: ["brunch"], media: [img("cafe.webp")], subject: { kind: "campaign", id: "c1", name: "Weekend brunch" } }),
  post({ id: "b3", network: "instagram", status: "PUBLISHED", publishedAt: at(-3), accountName: "Amahoro Salon", accountAvatar: `${W}salon-logo.webp`, kind: "carousel", text: "A week of looks from our chairs. Swipe to see Monday to Thursday!", hashtags: ["salon", "braids"], media: ["mon", "tue", "wed", "thu"].map((d) => img(`${W}${d}-600.webp`)), source: "AUTOPILOT" }),
  post({ id: "b4", network: "instagram", status: "DRAFT", kind: "video", text: "Fresh braids for the weekend.", excerpt: "Fresh braids for the weekend. Book your Saturday spot on WhatsApp.", accountName: "Amahoro Salon", accountAvatar: `${W}salon-logo.webp`, media: [{ path: "media/salon.mp4", url: "/marketing/avatar/ugc-salon-360.mp4" }], carryCount: 1 }),
  post({ id: "b5", network: "linkedin", status: "FAILED", scheduledAt: at(-30), lastError: "LinkedIn asked to connect again.", accountName: "Bright Builders Ltd", accountAvatar: null, text: "Project complete: three floors handed over on time in Kicukiro.", hashtags: ["construction"], media: [img("construction.webp")], source: "MANUAL" }),
  post({ id: "b6", network: "tiktok", status: "SCHEDULED", scheduledAt: at(50), notify: true, remindOnly: true, kind: "video", accountName: "Kigali Fit", accountAvatar: `${P}gym.webp`, text: "New morning class at 6:30 am.", media: [{ path: "media/fit.mp4", url: "/marketing/avatar/ugc-autopilot-360.mp4" }] }),
  post({ id: "b7", network: "instagram", status: "EXPIRED", scheduledAt: at(-80), carryCount: 3, text: "Enrolment for next term is open.", accountName: "Green School", accountAvatar: `${P}school.webp`, media: [img("school.webp")] }),
  post({ id: "b8", network: "facebook", status: "PENDING_APPROVAL", scheduledAt: at(30), text: "", media: [], setMaking: true, groupId: "g9", accountName: "Nyamirambo Hardware", accountAvatar: `${P}hardware-logo.webp` }),
];

export const PRODUCTS: ProductCard[] = [
  { id: "p1", kind: "PHYSICAL", name: "Weekend brunch", category: "Food", summary: "Eggs, fresh bread and house coffee, Saturday and Sunday mornings.", price: "From 6,000 RWF", status: "ACTIVE", thumb: "/marketing/photos/industry-restaurants-480.webp", photoCount: 6, contentCount: 14, ready: true, missing: [], syncedFrom: null },
  { id: "p2", kind: "SERVICE", name: "Knotless braids", category: "Beauty", summary: "Light, neat braids that last six weeks.", price: "25,000 RWF", status: "ACTIVE", thumb: "/marketing/photos/industry-beauty-480.webp", photoCount: 3, contentCount: 8, ready: true, missing: [], syncedFrom: "shopify" },
  { id: "p3", kind: "PHYSICAL", name: "Cement 50 kg", category: "Building", summary: "Delivered across Kigali the same day.", price: "11,500 RWF each", status: "DRAFT", thumb: "/marketing/photos/industry-construction-480.webp", photoCount: 1, contentCount: 0, ready: false, missing: ["a price note"], syncedFrom: null },
  { id: "p4", kind: "SERVICE", name: "Phone repair", category: null, summary: "Screens, batteries and charging ports.", price: "Price on request", status: "ARCHIVED", thumb: null, photoCount: 0, contentCount: 2, ready: false, missing: ["a photo"], syncedFrom: null },
];

export const CREATOR_CAMPAIGNS: CampaignRow[] = [
  { id: "cc1", name: "Show us your brunch", slug: "brunch", status: "LIVE", setupStep: null, startsOn: "2026-11-10", endsOn: "2026-11-27", platforms: ["instagram", "tiktok"], acceptingApplications: true, listed: true, hidden: false, tasks: 3, applied: 2, joined: 8 },
  { id: "cc2", name: "Braids review week", slug: "braids", status: "DRAFT", setupStep: 4, startsOn: "2026-11-20", endsOn: "2026-11-30", platforms: ["instagram"], acceptingApplications: true, listed: true, hidden: false, tasks: 0, applied: 0, joined: 0 },
  { id: "cc3", name: "Back to school", slug: "school", status: "ENDED", setupStep: null, startsOn: "2026-09-01", endsOn: "2026-09-30", platforms: ["facebook"], acceptingApplications: false, listed: false, hidden: true, tasks: 2, applied: 0, joined: 5 },
];

export const DESIGNS: StudioDesign[] = ["cafe", "clinic", "construction", "gym", "phones-story", "salon"].map((n, i) => ({ id: `d${i}`, url: `${P}${n}.webp`, kind: "AI", aspectRatio: n.endsWith("story") ? "9:16" : "4:5", template: null, createdAt: at(-i * 20) }));

export const TILES = [
  { url: "/marketing/photos/industry-retail-480.webp", name: "shop-front.jpg" },
  { url: "/marketing/photos/industry-electronics-480.webp", name: "phones-wall.jpg" },
  { url: "/marketing/avatar/ugc-salon-360.mp4", kind: "video", name: "salon-clip.mp4", durationMs: 12_500 },
  { url: "/marketing/photos/feature-business-480.webp", name: "team.jpg" },
  { url: "/marketing/photos/agency-480.webp", name: "office.jpg" },
];

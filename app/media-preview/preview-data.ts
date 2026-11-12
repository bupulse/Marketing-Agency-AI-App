// Made-up data for the media cards preview (app/media-preview). Example businesses and BuPulse's own marketing media
// from public/marketing: no client data.
import type { PostDetailView } from "@/components/media-cards";
import type { LibraryVideo } from "@/lib/video-library/service";

const P = "/marketing/posts/";
const W = "/marketing/week/";
const V = "/marketing/avatar/";

const HOUR = 3_600_000;
// A fixed "now", so the server and the browser render the same dates.
const NOW = Date.parse("2026-11-12T10:00:00Z");
const at = (hoursFromNow: number) => new Date(NOW + hoursFromNow * HOUR).toISOString();

export const PREVIEW_VIDEOS: LibraryVideo[] = [
  { key: "studio:v1", id: "v1", source: "studio", title: "Who's real? Our AI presenter", engine: "seedance", ratio: "9:16", durationMs: 30_000, createdAt: at(-30), videoUrl: `${V}whos-real-540.mp4`, downloadUrl: `${V}whos-real-540.mp4`, posterUrl: null, caption: "Every person in this ad is made by AI. Can you tell? #bupulse #kigali #ai", isNew: true, posts: { count: 0, next: null }, postHref: null },
  { key: "studio:v2", id: "v2", source: "studio", title: "Salon: book your Saturday", engine: "motion", ratio: "9:16", durationMs: 12_500, createdAt: at(-52), videoUrl: `${V}ugc-salon-360.mp4`, downloadUrl: `${V}ugc-salon-360.mp4`, posterUrl: null, caption: "Fresh braids for the weekend. Book on WhatsApp. #salon #kigali", isNew: false, posts: { count: 2, next: at(26) }, postHref: null },
  { key: "upload:v3", id: "v3", source: "upload", title: "Site visit, three floors done", engine: "upload", ratio: "9:16", durationMs: 12_500, createdAt: at(-80), videoUrl: `${V}ugc-construction-360.mp4`, downloadUrl: `${V}ugc-construction-360.mp4`, posterUrl: null, caption: "Handed over on time. Free site visit this month.", isNew: false, posts: { count: 1, next: null }, postHref: null },
  { key: "slideshow:v4", id: "v4", source: "slideshow", title: "Autopilot posts while you work", engine: null, ratio: "9:16", durationMs: 12_500, createdAt: at(-120), videoUrl: `${V}ugc-autopilot-360.mp4`, downloadUrl: null, posterUrl: null, caption: "Your posts go out every day at the best time.", isNew: false, posts: { count: 1, next: null }, postHref: "/dashboard/content" },
  { key: "studio:v5", id: "v5", source: "studio", title: "The reveal", engine: "premium3d", ratio: "9:16", durationMs: 12_500, createdAt: at(-150), videoUrl: `${V}ugc-reveal-360.mp4`, downloadUrl: `${V}ugc-reveal-360.mp4`, posterUrl: null, caption: "", isNew: false, posts: { count: 0, next: null }, postHref: null },
];

const cafe = { name: "Kigali Café", avatarUrl: `${P}cafe.webp`, handle: "@kigalicafe" };
const salon = { name: "Amahoro Salon", avatarUrl: `${W}salon-logo.webp`, handle: "@amahorosalon" };
const hardware = { name: "Nyamirambo Hardware", avatarUrl: `${P}hardware-logo.webp`, handle: "@nyamihardware" };

export const PREVIEW_POSTS: PostDetailView[] = [
  {
    id: "p1",
    platform: "instagram",
    account: cafe,
    timeLabel: "Tomorrow 12:30",
    media: [{ kind: "image", url: `${P}cafe.webp`, alt: "Weekend brunch from 6,000 RWF" }],
    caption: "Weekend brunch is back! Eggs, fresh bread and our house coffee, Saturday and Sunday from 9 am to noon. Bring the whole family, kids eat free before 10. #KigaliEats",
    hashtags: ["brunch", "kigali", "coffee", "KigaliEats"],
    status: "scheduled",
    subject: { kind: "campaign", name: "Weekend brunch" },
    variants: [
      { platform: "facebook", caption: "Weekend brunch is back at Kigali Café. Saturday and Sunday, 9 am to noon, from 6,000 RWF. Kids eat free before 10!", hashtags: ["brunch", "kigali"], status: "scheduled" },
      { platform: "linkedin", caption: "Our weekend brunch returns: a relaxed place for teams and families to meet in Kigali. Saturday and Sunday, 9 am to noon.", hashtags: ["kigali"], status: "draft" },
    ],
    details: [
      { label: "Scheduled", value: "Fri 14 Nov, 12:30" },
      { label: "Apps", value: "Instagram, Facebook, LinkedIn" },
      { label: "Campaign", value: "Weekend brunch" },
      { label: "Made by", value: "Daily posts" },
    ],
    dateLine: "Scheduled for Friday 14 November, 12:30",
  },
  {
    id: "p2",
    platform: "instagram",
    account: salon,
    timeLabel: "3h",
    media: ["mon", "tue", "wed", "thu"].map((d) => ({ kind: "image" as const, url: `${W}${d}-600.webp` })),
    caption: "A week of looks from our chairs. Swipe to see Monday to Thursday, and tell us your favourite in the comments!",
    hashtags: ["salon", "braids", "kigali"],
    status: "posted",
    subject: { kind: "product", name: "Knotless braids" },
    details: [
      { label: "Posted", value: "Today, 09:12" },
      { label: "Apps", value: "Instagram" },
      { label: "Product", value: "Knotless braids" },
    ],
    dateLine: "Posted 3 hours ago",
  },
  {
    id: "p3",
    platform: "instagram",
    account: salon,
    timeLabel: "Sat 11:30",
    media: [{ kind: "video", url: `${V}ugc-salon-360.mp4`, durationMs: 12_500 }],
    caption: "Fresh braids for the weekend. Book your Saturday spot on WhatsApp.",
    hashtags: ["reels", "salon"],
    status: "pending",
    subject: { kind: "product", name: "Knotless braids" },
    details: [{ label: "Waiting", value: "Your approval" }],
    dateLine: "Goes out Saturday 15 November, 11:30 after you approve it",
  },
  {
    id: "p4",
    platform: "facebook",
    account: hardware,
    timeLabel: "Yesterday",
    media: [{ kind: "image", url: `${P}hardware.webp` }],
    caption: "New stock in: cement, iron sheets and paint at the best prices in Nyamirambo. Delivery across Kigali the same day when you order before noon.",
    hashtags: ["construction", "kigali"],
    status: "posted",
    subject: { kind: "product", name: "Cement 50 kg" },
    dateLine: "Posted yesterday at 12:05",
  },
  {
    id: "p5",
    platform: "linkedin",
    account: { name: "Bright Builders Ltd", avatarUrl: null },
    timeLabel: "2d",
    media: [{ kind: "image", url: `${P}construction.webp` }],
    caption: "Project complete: three floors handed over on time in Kicukiro. Thank you to our team and our client for the trust.",
    hashtags: ["construction", "rwanda"],
    status: "failed",
    statusLabel: "Failed: reconnect LinkedIn",
    dateLine: "Tried 10 November at 12:30",
  },
  {
    id: "p6",
    platform: "twitter",
    account: { name: "Smart Phones RW", avatarUrl: `${P}phones.webp`, handle: "@smartphonesrw" },
    timeLabel: "In 20 min",
    media: [{ kind: "image", url: `${P}phones.webp` }],
    caption: "New phones just landed in Kigali. Trade in your old one and save up to 30%. Visit us on KN 4 Ave or order on WhatsApp.",
    hashtags: ["kigali"],
    status: "scheduled",
    dateLine: "Scheduled for today, 12:50",
  },
  {
    id: "p7",
    platform: "tiktok",
    account: { name: "Kigali Fit", avatarUrl: `${P}gym.webp`, handle: "@kigalifit" },
    timeLabel: "Draft",
    media: [{ kind: "video", url: `${V}ugc-autopilot-360.mp4`, durationMs: 12_500 }],
    caption: "New morning class at 6:30 am. Strength and stretch, all levels welcome.",
    hashtags: ["fitness", "kigali"],
    status: "draft",
    dateLine: "Draft, not scheduled yet",
  },
  {
    id: "p8",
    platform: "instagram",
    account: { name: "Green School", avatarUrl: `${P}school.webp` },
    timeLabel: "Mon 12:30",
    media: [{ kind: "image", url: `${P}school.webp` }],
    caption: "Enrolment for next term is open.",
    hashtags: ["school", "education"],
    status: "reminder",
    dateLine: "We email you Monday at 12:30 to post it yourself",
  },
];

export const PREVIEW_CREDITS = { used: 3, limit: 10, resetsAt: at(12 * 24) };

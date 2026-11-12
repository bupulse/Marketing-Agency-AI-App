// Made-up data for the client preview (app/preview-c): placeholder names and numbers only, never real people.
import type { InboxLead } from "@/components/leads/format";

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

export const SAMPLE_LEADS: InboxLead[] = [
  { id: "l1", name: "Eric Mugisha", email: "eric@example.com", phone: "+250 700 000 001", interest: "Price of 20 litres of passion juice for a wedding", message: null, source: "website_chat", status: "NEW", notes: null, pageUrl: "https://example.com/menu", createdAt: ago(12) },
  { id: "l2", name: "Claudine Uwimana", email: null, phone: "+250 700 000 002", interest: "Delivery to Kicukiro on Saturday", message: null, source: "website_chat", status: "NEW", notes: null, pageUrl: null, createdAt: ago(95) },
  { id: "l3", name: "Jean Bosco", email: "jb@example.com", phone: null, interest: "Office smoothies every Monday", message: null, source: "contact_form", status: "CONTACTED", notes: "Called, sends the list tomorrow.", pageUrl: null, createdAt: ago(60 * 26) },
  { id: "l4", name: "Diane Ishimwe", email: "diane@example.com", phone: "+250 700 000 004", interest: "Birthday party, 40 cups", message: null, source: "instagram", status: "WON", notes: null, pageUrl: null, createdAt: ago(60 * 24 * 3) },
  { id: "l5", name: null, email: "visitor@example.com", phone: null, interest: null, message: "Are you open on Sunday?", source: "website_chat", status: "LOST", notes: null, pageUrl: null, createdAt: ago(60 * 24 * 9) },
];

export const SAMPLE_LEAD_COUNTS = { ALL: 5, NEW: 2, CONTACTED: 1, WON: 1, LOST: 1 };

type Ch = "WEBSITE" | "WHATSAPP" | "INSTAGRAM" | "FACEBOOK";
export const SAMPLE_CONTACTS = [
  { id: "c1", name: "Eric Mugisha", email: "eric@example.com", phone: "+250 700 000 001", channels: ["WEBSITE", "WHATSAPP"] as Ch[], tags: ["wedding", "big order"], lastSeenAt: ago(12) },
  { id: "c2", name: "Claudine Uwimana", email: null, phone: "+250 700 000 002", channels: ["INSTAGRAM"] as Ch[], tags: ["delivery"], lastSeenAt: ago(95) },
  { id: "c3", name: "Jean Bosco", email: "jb@example.com", phone: null, channels: ["FACEBOOK"] as Ch[], tags: [], lastSeenAt: ago(60 * 30) },
  { id: "c4", name: "@diane.rw", email: null, phone: null, channels: ["INSTAGRAM"] as Ch[], tags: ["regular"], lastSeenAt: ago(60 * 24 * 4) },
];
export const SAMPLE_TAGS = [
  { id: "t1", name: "wedding", count: 4 },
  { id: "t2", name: "delivery", count: 9 },
  { id: "t3", name: "regular", count: 15 },
  { id: "t4", name: "big order", count: 2 },
];
export const SAMPLE_CONVERSATIONS = [
  { id: "v1", channel: "INSTAGRAM" as const, status: "OPEN" as const, unread: 2, preview: "How much is the 1 litre passion juice?", lastMessageAt: ago(4), botPaused: false, assignee: null, contact: { id: "c2", name: "Claudine Uwimana", avatarUrl: null } },
  { id: "v2", channel: "WEBSITE" as const, status: "OPEN" as const, unread: 0, preview: "Thank you, see you on Saturday!", lastMessageAt: ago(50), botPaused: true, assignee: { id: "me", name: "Aline" }, contact: { id: "c1", name: "Eric Mugisha", avatarUrl: null } },
  { id: "v3", channel: "FACEBOOK" as const, status: "OPEN" as const, unread: 1, preview: "Do you deliver to Kicukiro?", lastMessageAt: ago(60 * 5), botPaused: false, assignee: null, contact: { id: "c3", name: "Jean Bosco", avatarUrl: null } },
];

export const SAMPLE_BIO_SETTINGS = { enabled: true, slug: "inzozi", tagline: "", whatsapp: "+250700000000", message: "", phone: null, location: "KN 5 Rd, Kigali", landmark: "", showHours: true, links: ["instagram" as const], productIds: ["p1", "p2"] };
export const SAMPLE_BIO_SOURCE = {
  name: "Inzozi Juice Bar",
  defaultTagline: "Fresh juice and smoothies in Kimihurura, delivery in Kigali",
  accent: "#2f6bff",
  logoUrl: null,
  whatsappNumbers: [{ value: "+250700000000", display: "+250 700 000 000" }],
  phoneNumbers: [{ value: "+250700000000", display: "+250 700 000 000" }, { value: "+250700000009", display: "+250 700 000 009" }],
  locations: [{ address: "KN 5 Rd, Kigali", label: "Main shop", text: "KN 5 Rd, Kimihurura, Kigali", mapsUrl: "https://maps.example.com" }],
  hours: { lines: ["Mon–Sat 08:00–20:00", "Sun 10:00–18:00"], status: "Open now until 20:00", open: true },
  links: [{ type: "instagram" as const, href: "https://instagram.com/example", display: "@inzozi" }, { type: "website" as const, href: "https://inzozi.example.com", display: "inzozi.example.com" }],
  products: [
    { id: "p1", name: "Passion juice 1 litre", price: "RWF 3,000", summary: "", photoUrl: null },
    { id: "p2", name: "Mango smoothie", price: "RWF 2,500", summary: "", photoUrl: null },
    { id: "p3", name: "Avocado shake", price: "RWF 2,800", summary: "", photoUrl: null },
    { id: "p4", name: "Party pack, 20 cups", price: "RWF 35,000", summary: "", photoUrl: null },
  ],
};
export const SAMPLE_BIO_DAYS = Array.from({ length: 30 }, (_, i) => ({ date: new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10), views: (i * 7) % 23, whatsapp: (i * 3) % 5, calls: i % 3 === 0 ? 1 : 0 }));

export const SAMPLE_AUTOMATIONS = [
  { id: "a1", name: "Comment PRICE, get the price in DM", status: "LIVE" as const, trigger: "comment_keyword" as string | null, keywords: ["price", "how much"], channels: ["INSTAGRAM"], updatedAt: ago(60 * 30), changed: false, runs: { started: 48, finished: 45, waiting: 2, failed: 1 } },
  { id: "a2", name: "Welcome menu", status: "LIVE" as const, trigger: "keyword" as string | null, keywords: [], channels: ["WEBSITE", "INSTAGRAM"], updatedAt: ago(60 * 24 * 3), changed: true, runs: { started: 120, finished: 118, waiting: 0, failed: 0 } },
  { id: "a3", name: "Follow up the next day", status: "DRAFT" as const, trigger: null as string | null, keywords: [], channels: [], updatedAt: ago(60 * 2), changed: false, runs: { started: 0, finished: 0, waiting: 0, failed: 0 } },
];

export const SAMPLE_FIELDS = [{ id: "f1", key: "district", label: "District", type: "choice", options: ["Gasabo", "Kicukiro", "Nyarugenge"] }];

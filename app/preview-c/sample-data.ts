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

export const SAMPLE_FIELDS =[{ id: "f1", key: "district", label: "District", type: "choice", options: ["Gasabo", "Kicukiro", "Nyarugenge"] }];

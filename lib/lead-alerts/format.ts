import { telHref, whatsappHref } from "@/lib/quote/phone";

// What an instant lead alert says, whichever channel carries it (channels.ts): a quote request from the website, a
// message from the Contact or Done-for-you form (lib/contact.ts), a visitor who started a help chat on BuPulse's own
// marketing site, or a chat (any surface) that waits for a person after the AI handed it over (lib/support/lead-alert.ts).
// Written so the owner can act from a phone screen in seconds: who, the number as a tap-to-call link and a WhatsApp
// link, the company, what they wrote, where they came from and when (Kigali time). Pure, so every channel and the
// tests share it.

export type LeadAlertKind = "quote" | "contact" | "support_chat" | "support_waiting";

export type LeadAlert = {
  kind: LeadAlertKind;
  name: string;
  /** E.164 when known ("+250788123456"); null when the person left none. */
  phone: string | null;
  email: string | null;
  company: string | null;
  /** The quote's note, the contact form's message, or the chat's first (or, waiting, last) message. */
  note: string | null;
  /** "instagram", "website"... (quotes); the form ("contact", "done_for_you") for contact alerts; null for chats. */
  source: string | null;
  /** The page it was sent from, a full address. */
  page: string | null;
  at: Date;
  /** Where the owner opens it: Admin -> Quote requests, or the chat in the support app. */
  openUrl: string | null;
  /** The signed "✅ Called" link of a stored quote request (called-link.ts); stops the reminders. */
  calledUrl?: string | null;
  /** Set on a reminder: which one of how many (reminders.ts). */
  reminder?: { n: number; of: number } | null;
  /** support_waiting: the chat's number, why the AI handed it over, and whether the team is away (it became a ticket). */
  chat?: { number: number; reason: string; away: boolean } | null;
};

const KIGALI_TIME = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Africa/Kigali",
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** "Sat, 31 Oct 2026, 14:05 (Kigali time)". */
export function kigaliTime(at: Date): string {
  return `${KIGALI_TIME.format(at).replace(/ at /, ", ")} (Kigali time)`;
}

/** A source tag as people say it: "instagram" -> "Instagram", "quote_page" -> "Quote page". */
export function sourceLabel(source: string | null): string | null {
  if (!source) return null;
  const words = source.replace(/[_-]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : null;
}

const who = (a: LeadAlert) => a.name.trim() || a.email || "someone";

/** The form a contact alert came from, by its source tag. */
const formName = (a: LeadAlert) => (a.source === "done_for_you" ? "Done for you" : "Contact");

/** " #1042" for a waiting chat with a number. */
const chatNo = (a: LeadAlert) => (a.chat ? ` #${a.chat.number}` : "");

/** "New quote request: Sample Shop Ltd — call Test Person now". */
export function alertSubject(a: LeadAlert): string {
  const company = a.company?.trim() || who(a);
  if (a.kind === "support_waiting") {
    return a.chat?.away ? `Chat${chatNo(a)} left for the team: ${company} — reply when you are back` : `Chat${chatNo(a)} is waiting for a person: ${company} — reply to ${who(a)} now`;
  }
  const what = a.kind === "quote" ? "New quote request" : a.kind === "contact" ? `New ${formName(a).toLowerCase()} request` : "New website chat";
  const act = a.phone ? `call ${who(a)} now` : `reply to ${who(a)} now`;
  return `${what}: ${company} — ${act}`;
}

/** One line under the subject: what happened, in a sentence. */
export function alertIntro(a: LeadAlert): string {
  if (a.kind === "quote") return `${who(a)} asked for a free quote on the BuPulse website. They expect a call shortly.`;
  if (a.kind === "contact") return `${who(a)} filled in the ${formName(a)} form on the BuPulse website.`;
  if (a.kind === "support_waiting") {
    const why = a.chat?.reason ? ` (${a.chat.reason})` : "";
    return a.chat?.away
      ? `${who(a)} needs a person in the chat${why}, outside team hours. They were told the team replies by email; answer in the support app.`
      : `${who(a)} is waiting for a person in the chat${why}. The AI stepped back; reply in the support app.`;
  }
  return `${who(a)} started a chat on the BuPulse website. The AI is answering; a quick call or WhatsApp can win them.`;
}

/** The label of what the person wrote. */
const noteLabel = (a: LeadAlert) => (a.kind === "quote" ? "Note" : a.kind === "contact" ? "Message" : a.kind === "support_waiting" ? "Last message" : "First message");

export type AlertField = { label: string; value: string; href?: string };

/** The details, in the order the owner needs them. Empty values are left out. */
export function alertFields(a: LeadAlert): AlertField[] {
  const fields: (AlertField | null)[] = [
    { label: "Name", value: a.name.trim() || "Not given" },
    a.phone ? { label: "Phone", value: a.phone, href: telHref(a.phone) } : null,
    a.phone ? { label: "WhatsApp", value: whatsappHref(a.phone), href: whatsappHref(a.phone) } : null,
    a.email ? { label: "Email", value: a.email, href: `mailto:${a.email}` } : null,
    a.company?.trim() ? { label: "Company", value: a.company.trim() } : null,
    a.note?.trim() ? { label: noteLabel(a), value: a.note.trim() } : null,
    sourceLabel(a.source) ? { label: "Source", value: sourceLabel(a.source)! } : null,
    a.page ? { label: "Page", value: a.page, href: a.page } : null,
    { label: "Time", value: kigaliTime(a.at) },
  ];
  return fields.filter((f): f is AlertField => f !== null);
}

/** Telegram's HTML mode needs only these three escaped. */
export function escapeTelegramHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Telegram allows 4096 characters a message; a long note is cut well before that. */
const TELEGRAM_NOTE_MAX = 1500;

/**
 * The first line, which is what a phone shows in Telegram's pop-up before the app is opened:
 * "Aline Uwase from Kigali Tech Hub just requested a quote". The name as they typed it: the form asks no title, and
 * guessing Mr or Mrs from a name would get people wrong.
 */
export function alertHeadline(a: LeadAlert): string {
  const company = a.company?.trim();
  const from = company ? ` from ${company}` : "";
  if (a.kind === "quote") return `${who(a)}${from} just requested a quote`;
  if (a.kind === "contact") return `${who(a)}${from} sent the ${formName(a)} form`;
  if (a.kind === "support_waiting") {
    return a.chat?.away ? `${who(a)}${from} left a message for the team (chat${chatNo(a)}, outside hours)` : `${who(a)}${from} is waiting for a person (chat${chatNo(a)})`;
  }
  return `${who(a)}${from} started a chat on the website`;
}

/**
 * The Telegram message (parse_mode HTML). The headline and what they wrote come first, so the pop-up on the owner's
 * phone already says who it is and what they want; the details follow. The Call, WhatsApp and Admin links are buttons
 * under the message (telegramButtons).
 */
export function telegramText(a: LeadAlert): string {
  const e = escapeTelegramHtml;
  const note = a.note?.trim();
  const lines = [a.reminder ? `⏰ <b>${e(reminderHeadline(a))}</b>` : `🔔 <b>${e(alertHeadline(a))}</b>`];
  if (note) lines.push(`“${e(note.length > TELEGRAM_NOTE_MAX ? `${note.slice(0, TELEGRAM_NOTE_MAX)}…` : note)}”`);
  if (a.kind === "support_waiting" && a.chat?.reason) lines.push(`<i>Why: ${e(a.chat.reason)}</i>`);
  lines.push("");
  for (const f of alertFields(a)) {
    if (f.label === "WhatsApp" || f.label === noteLabel(a)) continue;
    if (f.label === "Page" && /^https?:/.test(f.value)) lines.push(`<b>Page:</b> <a href="${e(f.value)}">${e(f.value)}</a>`);
    else lines.push(`<b>${e(f.label)}:</b> ${e(f.value)}`);
  }
  return lines.join("\n");
}

/** "Still waiting (2 of 5): call Aline Uwase from Kigali Tech Hub", the first line of a reminder. */
export function reminderHeadline(a: LeadAlert): string {
  const company = a.company?.trim();
  const step = a.reminder ? ` (${a.reminder.n} of ${a.reminder.of})` : "";
  return `Still waiting${step}: call ${who(a)}${company ? ` from ${company}` : ""}`;
}

export type TelegramButton = { text: string; url: string };

/**
 * The buttons under the alert. Telegram buttons only open web addresses, not "tel:", so Call goes through the site's
 * /call/<number> page, which hands the number straight to the phone's dialer.
 */
export function telegramButtons(a: LeadAlert, siteUrl: string): TelegramButton[][] {
  const rows: TelegramButton[][] = [];
  if (a.phone) {
    const first = who(a).split(/\s+/)[0];
    rows.push([{ text: `📞 Call ${first}`, url: `${siteUrl.replace(/\/$/, "")}/call/${a.phone.replace(/\D/g, "")}` }]);
    rows.push([{ text: "💬 WhatsApp", url: whatsappHref(a.phone) }]);
  }
  if (a.calledUrl) rows.push([{ text: "✅ Called (stop reminders)", url: a.calledUrl }]);
  if (a.openUrl) rows.push([{ text: a.kind === "quote" || a.kind === "contact" ? "Open in Admin" : "Open the chat", url: a.openUrl }]);
  return rows;
}

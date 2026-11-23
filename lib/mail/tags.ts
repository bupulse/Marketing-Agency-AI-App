// Automatic tags and the Important mark for incoming mail: free rules (sender domains and words), no AI (owner's
// choice, 23 Nov 2026: rules first, AI later). Pure: the inbound route and the tests use it. Copy rules (bank, invoices,
// payments, receipts into accounting@) read these tags.

export const TAGS = ["bank", "invoices", "payments", "receipts", "leads", "support", "partners", "updates"] as const;
export type Tag = (typeof TAGS)[number];

export const TAG_LABEL: Record<Tag, string> = {
  bank: "Bank",
  invoices: "Invoices",
  payments: "Payments",
  receipts: "Receipts",
  leads: "Leads",
  support: "Support",
  partners: "Partners",
  updates: "Updates",
};

export type TagInput = {
  fromAddress: string;
  fromName: string;
  subject: string;
  text: string;
  /** The mailbox it arrived in (sales@ mail leans to leads, support@ to support). */
  mailboxAddress: string | null;
  attachmentNames: string[];
};

// Sender domains (or parts of them) of Rwandan banks and payment services. Matched against the domain only.
const BANK_DOMAINS = ["imbank", "bk.rw", "bankofkigali", "equitybank", "equity.rw", "ecobank", "accessbank", "gtbank", "ncba", "cogebanque", "bpr.rw", "kcb", "stanbic", "absa", "bnr.rw", "urwegobank", "zigama", "unguka"];
const PAYMENT_DOMAINS = ["irembopay", "irembo", "mtn.co.rw", "momo", "airtel", "paypal", "stripe", "paddle", "flutterwave", "dpo", "pesapal", "wise.com", "kpay", "spenn"];

const has = (hay: string, words: RegExp) => words.test(hay);

const WORDS = {
  bank: /\b(bank|account statement|statement of account|debit card|credit card|current account|savings account|swift|iban|branch)\b/i,
  invoices: /\b(invoice|inv[-\s]?\d+|facture|bill (for|no)|amount due|due date|proforma|pro-forma|quotation)\b/i,
  payments: /\b(payment|paid|transfer|transaction|mobile money|momo|remittance|refund|charge(d)?|payout|settlement)\b/i,
  receipts: /\b(receipt|re[cç]u|payment received|you received|confirmation of payment|ebm|proof of payment)\b/i,
  leads: /\b(quote|quotation request|price|pricing|how much|cost|interested in|would like (to|a)|book a (call|demo)|package)\b/i,
  support: /\b(help|not working|problem|issue|error|can'?t|cannot|did not|didn'?t|bug|broken|support|password|login)\b/i,
  partners: /\b(partnership|partner|collaborat|sponsor|proposal|mou|memorandum)\b/i,
  updates: /\b(newsletter|unsubscribe|no-?reply|notification|verify your|verification|security alert|webinar|digest|weekly update)\b/i,
};

const domainOf = (address: string) => address.slice(address.lastIndexOf("@") + 1).toLowerCase();
const anyIn = (domain: string, list: string[]) => list.some((d) => domain.includes(d));

/** The tags for a message, most specific first, at most three. */
export function tagsFor(m: TagInput): Tag[] {
  const domain = domainOf(m.fromAddress);
  const head = `${m.subject}\n${m.fromName}`;
  const body = `${m.subject}\n${m.text.slice(0, 4000)}\n${m.attachmentNames.join(" ")}`;
  const out = new Set<Tag>();
  if (anyIn(domain, BANK_DOMAINS) || has(head, WORDS.bank)) out.add("bank");
  if (has(body, WORDS.receipts)) out.add("receipts");
  if (has(body, WORDS.invoices) || m.attachmentNames.some((n) => /invoice|facture|inv[-_ ]?\d/i.test(n))) out.add("invoices");
  if (anyIn(domain, PAYMENT_DOMAINS) || (has(head, WORDS.payments) && !out.has("receipts"))) out.add("payments");
  const box = (m.mailboxAddress ?? "").toLowerCase();
  if (!out.size) {
    if (box.startsWith("sales@") || has(head, WORDS.leads)) out.add("leads");
    else if (box.startsWith("support@") || has(head, WORDS.support)) out.add("support");
    else if (has(head, WORDS.partners)) out.add("partners");
  }
  if (!out.size && (has(`${m.fromAddress} ${m.subject}`, WORDS.updates) || /^(no-?reply|notifications?|news|info|hello|team)@/i.test(m.fromAddress))) out.add("updates");
  return [...out].slice(0, 3);
}

/** Important: money and banking, a person writing to sales@/support@ for the first time, or words that ask for action. */
export function isImportant(m: TagInput, tags: Tag[]): boolean {
  if (tags.includes("bank") || tags.includes("invoices")) return true;
  if (tags.includes("updates")) return false;
  if (tags.includes("leads")) return true;
  return /\b(urgent|asap|today|deadline|overdue|final notice|action required|important)\b/i.test(`${m.subject} ${m.text.slice(0, 600)}`);
}

// Pulls contact details out of what a visitor typed, and decides when to ask for them.
// Pure functions: the AI also reports what it detected, and the two are merged.

export interface Detected {
  name?: string;
  email?: string;
  phone?: string;
  interest?: string;
}

const EMAIL = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/i;
const PHONE = /(?<![\w.])\+?\(?\d[\d\s().-]{6,20}\d(?![\w])/g;

export function cleanEmail(value: string | undefined | null): string | undefined {
  const v = value?.trim().toLowerCase();
  return v && v.length <= 200 && /^[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(v) ? v : undefined;
}

export function cleanPhone(value: string | undefined | null): string | undefined {
  const v = value?.trim();
  if (!v || v.length > 40 || !/^[+\d\s().-]+$/.test(v)) return undefined;
  const digits = v.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15 ? v : undefined;
}

export function findEmail(text: string): string | undefined {
  return cleanEmail(EMAIL.exec(text)?.[0]);
}

/** A phone number needs a "+", a leading 0 or separators, so a price such as 1200000 is not taken for one. */
export function findPhone(text: string): string | undefined {
  for (const match of text.replace(EMAIL, " ").matchAll(PHONE)) {
    const raw = match[0].trim();
    const digits = raw.replace(/\D/g, "");
    if (digits.length < 8 || digits.length > 15) continue;
    if (raw.startsWith("+") || raw.startsWith("0") || /[\s().-]/.test(raw)) return cleanPhone(raw);
  }
  return undefined;
}

function text(value: string | undefined | null, max: number): string | undefined {
  const v = value?.replace(/\s+/g, " ").trim().slice(0, max);
  return v || undefined;
}

/** Details typed in the message win over (and complete) what the AI reported; invalid ones are dropped. */
export function mergeDetected(message: string, ai?: Detected | null): Detected {
  return {
    name: text(ai?.name, 80),
    email: findEmail(message) ?? cleanEmail(ai?.email),
    phone: findPhone(message) ?? cleanPhone(ai?.phone),
    interest: text(ai?.interest, 200),
  };
}

export function hasContact(d: Detected): boolean {
  return Boolean(d.email || d.phone);
}

// Words that show buying interest, in the languages BuPulse supports most. The AI is the main
// judge (wantsContact); this is the safety net.
const INTEREST =
  /(?<![\p{L}])(price|prices|pricing|cost|how much|quote|quotation|book|booking|reserve|appointment|buy|purchase|order|available|availability|discount|deposit|prix|tarif|devis|réserver|reserver|rendez-vous|acheter|commander|disponible|precio|cuánto|cuanto|cotización|reservar|comprar|cita|preço|orçamento|preis|kosten|buchen|kaufen|bestellen|prezzo|preventivo|prenotare|comprare|bei|gharama|nunua|bei gani|igiciro|amafaranga|kugura|gura|سعر|كم|حجز)(?![\p{L}])/iu;

export function showsInterest(message: string): boolean {
  return INTEREST.test(message);
}

export const ASK_AFTER_MESSAGES = 3;

/** Whether the chat should show the contact card after this reply. */
export function shouldAskContact(input: {
  aiWantsContact: boolean;
  /** Visitor messages so far, including this one. */
  visitorMessages: number;
  message: string;
  leadCaptured: boolean;
  /** The AI could not be used (limit, error): always collect details. */
  unanswered?: boolean;
}): boolean {
  if (input.leadCaptured) return false;
  if (input.unanswered || input.aiWantsContact) return true;
  return showsInterest(input.message) || input.visitorMessages >= ASK_AFTER_MESSAGES;
}

// What the widget remembers on the device. localStorage: the visitor key and when they last chatted (the 7-day greeting
// rule). sessionStorage: this visit's page count, whether the greeting was seen, and unsent messages. Private windows
// and blocked storage fall back to memory, so the chat still works for that page.
const memory = new Map<string, string>();

type Area = "local" | "session";

function area(a: Area): Storage | null {
  try {
    return a === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

export function read(a: Area, key: string): string | null {
  try {
    const v = area(a)?.getItem(key);
    if (v !== null && v !== undefined) return v;
  } catch {
    // fall through to memory
  }
  return memory.get(`${a}:${key}`) ?? null;
}

export function write(a: Area, key: string, value: string | null) {
  if (value === null) memory.delete(`${a}:${key}`);
  else memory.set(`${a}:${key}`, value);
  try {
    if (value === null) area(a)?.removeItem(key);
    else area(a)?.setItem(key, value);
  } catch {
    // memory keeps it for this page
  }
}

export const KEYS = {
  visitor: "bp-sc-key",
  lastChat: "bp-sc-last-chat",
  pages: "bp-sc-pages",
  page: "bp-sc-page",
  landing: "bp-sc-landing",
  greetingSeen: "bp-sc-greeting",
  outbox: "bp-sc-outbox",
  visitToken: "bp-sc-visit",
} as const;

const KEY_SHAPE = /^[A-Za-z0-9_-]{16,64}$/;

/** A random key for this browser (visitBody.visitorKey), made once. */
export function visitorKey(): string {
  const old = read("local", KEYS.visitor);
  if (old && KEY_SHAPE.test(old)) return old;
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  const key = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  write("local", KEYS.visitor, key);
  return key;
}

export function lastChatAt(): number | null {
  const n = Number(read("local", KEYS.lastChat));
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function markChatted(now = Date.now()) {
  write("local", KEYS.lastChat, String(now));
}

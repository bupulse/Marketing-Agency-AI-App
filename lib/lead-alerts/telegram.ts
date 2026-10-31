// Telegram's Bot API (free): sendMessage for the owner's instant lead alerts, getUpdates to find the owner's chat when
// they connect, getMe for Admin -> Services' "Test now". The bot's token is TELEGRAM_BOT_TOKEN (pasted in Admin ->
// Services, which puts it in process.env); the chat it writes to is saved by Admin -> Settings, "Lead alerts"
// (telegram-settings.ts). No token or no chat: nothing is sent and nothing fails. The token is part of the request
// path, so it is never written to a log or an error message.

export const TELEGRAM_TOKEN_ENV = "TELEGRAM_BOT_TOKEN";
const API = "https://api.telegram.org";
const TIMEOUT_MS = 8_000;

type Fetch = typeof fetch;

export type TelegramResult = { ok: true } | { ok: false; skipped?: true; error: string };

/** The bot token, or null when none is set. */
export function telegramToken(env: Record<string, string | undefined> = process.env): string | null {
  const token = env[TELEGRAM_TOKEN_ENV]?.trim();
  return token ? token : null;
}

/** "123456789:AA..." is what @BotFather gives; anything else is not a bot token. */
export const looksLikeBotToken = (token: string) => /^\d{5,16}:[A-Za-z0-9_-]{30,64}$/.test(token);

/** Telegram's error text without anything that could carry the token. */
function cleanError(description: unknown, status: number): string {
  const text = typeof description === "string" ? description.replace(/bot\d+:[A-Za-z0-9_-]+/g, "bot<token>").slice(0, 200) : "";
  return text ? `Telegram said: ${text}` : `Telegram returned ${status}.`;
}

async function call<T>(token: string, method: string, body: Record<string, unknown> | null, fetchImpl: Fetch): Promise<{ ok: true; result: T } | { ok: false; error: string }> {
  try {
    const res = await fetchImpl(`${API}/bot${token}/${method}`, {
      method: body ? "POST" : "GET",
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const json = (await res.json().catch(() => null)) as { ok?: boolean; result?: T; description?: string } | null;
    if (!res.ok || !json?.ok) return { ok: false, error: cleanError(json?.description, res.status) };
    return { ok: true, result: json.result as T };
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    return { ok: false, error: timedOut ? "Telegram did not answer in time." : "Telegram could not be reached." };
  }
}

/**
 * Sends one message (HTML formatting). Without a token or a chat id it does nothing and says so (skipped), so the
 * callers never need to check first.
 */
export async function sendTelegramMessage(
  args: { chatId: string | null | undefined; text: string; token?: string | null; buttons?: { text: string; url: string }[][] },
  fetchImpl: Fetch = fetch,
): Promise<TelegramResult> {
  const token = args.token === undefined ? telegramToken() : args.token;
  if (!token) return { ok: false, skipped: true, error: `${TELEGRAM_TOKEN_ENV} is not set.` };
  if (!args.chatId) return { ok: false, skipped: true, error: "No Telegram chat is connected." };
  const body: Record<string, unknown> = { chat_id: args.chatId, text: args.text, parse_mode: "HTML", link_preview_options: { is_disabled: true } };
  if (args.buttons?.length) body.reply_markup = { inline_keyboard: args.buttons };
  const r = await call(token, "sendMessage", body, fetchImpl);
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

export type TelegramChat = { id: string; name: string };

type Update = {
  update_id?: number;
  message?: { date?: number; chat?: { id?: number | string; type?: string; first_name?: string; last_name?: string; username?: string } };
};

/**
 * The private chat that wrote to the bot most recently (the owner's "/start"), from getUpdates' list. Groups and
 * channels are skipped: alerts with a client's phone number go to one person, not to a group anyone could join.
 */
export function latestPrivateChat(updates: unknown): TelegramChat | null {
  if (!Array.isArray(updates)) return null;
  let best: { chat: TelegramChat; at: number } | null = null;
  for (const u of updates as Update[]) {
    const chat = u?.message?.chat;
    if (!chat || chat.type !== "private" || chat.id === undefined || !/^-?\d{1,20}$/.test(String(chat.id))) continue;
    const at = Number(u.message?.date ?? 0) * 1000 + Number(u.update_id ?? 0) / 1e6;
    const name = [chat.first_name, chat.last_name].filter(Boolean).join(" ") || (chat.username ? `@${chat.username}` : "Telegram user");
    if (!best || at >= best.at) best = { chat: { id: String(chat.id), name: chat.username && !name.includes("@") ? `${name} (@${chat.username})` : name }, at };
  }
  return best?.chat ?? null;
}

/** The messages people sent the bot in the last day (Telegram keeps them 24 hours until they are read). */
export async function getTelegramUpdates(token: string, fetchImpl: Fetch = fetch): Promise<{ ok: true; updates: unknown[] } | { ok: false; error: string }> {
  const r = await call<unknown[]>(token, "getUpdates", { allowed_updates: ["message"], limit: 100 }, fetchImpl);
  return r.ok ? { ok: true, updates: Array.isArray(r.result) ? r.result : [] } : r;
}

/** The bot's own name, which proves the token works (Admin -> Services, "Test now"). */
export async function getTelegramBot(token: string, fetchImpl: Fetch = fetch): Promise<{ ok: true; username: string } | { ok: false; error: string }> {
  const r = await call<{ username?: string }>(token, "getMe", null, fetchImpl);
  return r.ok ? { ok: true, username: r.result?.username ?? "your bot" } : r;
}

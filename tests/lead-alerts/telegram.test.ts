import { describe, expect, it, vi } from "vitest";
import { getTelegramBot, latestPrivateChat, looksLikeBotToken, sendTelegramMessage, telegramToken } from "@/lib/lead-alerts/telegram";

// A made-up token in the shape @BotFather gives.
const TOKEN = "123456789:AAtest_placeholder_token_000000000000";

const reply = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));

describe("sendTelegramMessage", () => {
  it("skips quietly without a token, and never calls Telegram", async () => {
    const fetchImpl = vi.fn();
    const r = await sendTelegramMessage({ chatId: "42", text: "hi", token: null }, fetchImpl as unknown as typeof fetch);
    expect(r).toMatchObject({ ok: false, skipped: true });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reads the token from TELEGRAM_BOT_TOKEN when none is passed", async () => {
    expect(telegramToken({})).toBeNull();
    expect(telegramToken({ TELEGRAM_BOT_TOKEN: "  " })).toBeNull();
    expect(telegramToken({ TELEGRAM_BOT_TOKEN: TOKEN })).toBe(TOKEN);
    const before = process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_BOT_TOKEN;
    try {
      const fetchImpl = vi.fn();
      expect(await sendTelegramMessage({ chatId: "42", text: "hi" }, fetchImpl as unknown as typeof fetch)).toMatchObject({ ok: false, skipped: true });
      expect(fetchImpl).not.toHaveBeenCalled();
    } finally {
      if (before !== undefined) process.env.TELEGRAM_BOT_TOKEN = before;
    }
  });

  it("skips without a connected chat", async () => {
    const fetchImpl = vi.fn();
    expect(await sendTelegramMessage({ chatId: null, text: "hi", token: TOKEN }, fetchImpl as unknown as typeof fetch)).toMatchObject({ ok: false, skipped: true });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("posts the message as HTML to the bot's sendMessage", async () => {
    const fetchImpl = reply({ ok: true, result: { message_id: 1 } });
    expect(await sendTelegramMessage({ chatId: "42", text: "<b>New</b>", token: TOKEN }, fetchImpl as unknown as typeof fetch)).toEqual({ ok: true });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://api.telegram.org/bot${TOKEN}/sendMessage`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toMatchObject({ chat_id: "42", text: "<b>New</b>", parse_mode: "HTML" });
  });

  it("reports Telegram's refusal without the token in it", async () => {
    const fetchImpl = reply({ ok: false, description: `Unauthorized for bot${TOKEN}` }, 401);
    const r = await sendTelegramMessage({ chatId: "42", text: "hi", token: TOKEN }, fetchImpl as unknown as typeof fetch);
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.error).toContain("Unauthorized");
    expect(JSON.stringify(r)).not.toContain(TOKEN.split(":")[1]);
  });

  it("turns a network failure into a message, never a throw", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    expect(await sendTelegramMessage({ chatId: "42", text: "hi", token: TOKEN }, fetchImpl as unknown as typeof fetch)).toEqual({ ok: false, error: "Telegram could not be reached." });
  });
});

describe("finding the owner's chat", () => {
  const msg = (update_id: number, date: number, chat: Record<string, unknown>) => ({ update_id, message: { date, chat } });

  it("takes the private chat that wrote most recently", () => {
    const updates = [
      msg(1, 100, { id: 111, type: "private", first_name: "Old" }),
      msg(2, 300, { id: -100222, type: "supergroup", title: "A group" }),
      msg(3, 200, { id: 333, type: "private", first_name: "Test", last_name: "Owner", username: "test_owner" }),
    ];
    expect(latestPrivateChat(updates)).toEqual({ id: "333", name: "Test Owner (@test_owner)" });
  });

  it("finds nothing in groups, channels or an empty list", () => {
    expect(latestPrivateChat([])).toBeNull();
    expect(latestPrivateChat(null)).toBeNull();
    expect(latestPrivateChat([msg(1, 1, { id: -5, type: "group" }), { update_id: 2, channel_post: {} }])).toBeNull();
  });

  it("checks the token's shape and the bot's name", async () => {
    expect(looksLikeBotToken(TOKEN)).toBe(true);
    expect(looksLikeBotToken("not a token")).toBe(false);
    const fetchImpl = reply({ ok: true, result: { username: "bupulse_test_bot" } });
    expect(await getTelegramBot(TOKEN, fetchImpl as unknown as typeof fetch)).toEqual({ ok: true, username: "bupulse_test_bot" });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => {
  const rows = new Map<string, unknown>();
  const adminSetting = {
    findUnique: vi.fn(async ({ where }: { where: { key: string } }) => (rows.has(where.key) ? { key: where.key, value: rows.get(where.key) } : null)),
    upsert: vi.fn(async ({ where, create }: { where: { key: string }; create: { value: unknown } }) => {
      rows.set(where.key, create.value);
      return {};
    }),
    deleteMany: vi.fn(async ({ where }: { where: { key: string } }) => {
      rows.delete(where.key);
      return { count: 1 };
    }),
  };
  const tx = { adminSetting, auditLog: { create: vi.fn() } };
  return { rows, adminSetting, tx, prisma: { adminSetting, $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)) }, writeAudit: vi.fn(async () => {}) };
});

vi.mock("@/lib/db", () => ({ prisma: m.prisma }));
vi.mock("@/lib/admin/audit", () => ({ writeAudit: m.writeAudit }));
vi.mock("@/lib/admin/switch", () => ({ isServiceEnabled: vi.fn(async () => true) }));

import { connectTelegram, disconnectTelegram, readTelegramChat, sendTelegramTestAlert, TELEGRAM_CHAT_SETTING } from "@/lib/lead-alerts/telegram-settings";
import { AdminError, consoleContext } from "@/lib/admin/types";

const TOKEN = "123456789:AAtest_placeholder_token_000000000000";
const ctx = consoleContext("127.0.0.1");

type Call = [string, RequestInit];
/** A fake Bot API: getUpdates gives `updates`, sendMessage succeeds. */
function bot(updates: unknown[]) {
  return vi.fn(async (url: string) => {
    const method = url.split("/").pop();
    const result = method === "getUpdates" ? updates : { message_id: 1 };
    return new Response(JSON.stringify({ ok: true, result }), { status: 200 });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  m.rows.clear();
  process.env.TELEGRAM_BOT_TOKEN = TOKEN;
});

describe("Admin -> Settings, Lead alerts: Connect", () => {
  it("saves the private chat that sent /start, audits it and says hello there", async () => {
    const fetchImpl = bot([
      { update_id: 7, message: { date: 1_700_000_000, chat: { id: -1001, type: "group", title: "Team" } } },
      { update_id: 8, message: { date: 1_700_000_100, chat: { id: 4242, type: "private", first_name: "Test", last_name: "Owner" } } },
    ]);
    const chat = await connectTelegram(ctx, fetchImpl as unknown as typeof fetch);
    expect(chat).toEqual({ id: "4242", name: "Test Owner" });
    expect(await readTelegramChat()).toMatchObject({ chatId: "4242", name: "Test Owner" });
    expect(m.writeAudit).toHaveBeenCalledWith(m.tx, ctx, "update_setting", `setting:${TELEGRAM_CHAT_SETTING}`, null, { chatId: "4242", name: "Test Owner" });
    const hello = fetchImpl.mock.calls.find((c) => String(c[0]).endsWith("/sendMessage")) as unknown as Call;
    expect(JSON.parse(String(hello[1].body))).toMatchObject({ chat_id: "4242", text: expect.stringContaining("connected") });
  });

  it("asks for the token first when none is saved", async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    const fetchImpl = bot([]);
    await expect(connectTelegram(ctx, fetchImpl as unknown as typeof fetch)).rejects.toThrow(/Services/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("asks for /start when the bot has no private message", async () => {
    const err = await connectTelegram(ctx, bot([{ update_id: 1, message: { date: 1, chat: { id: -5, type: "group" } } }]) as unknown as typeof fetch).catch((e) => e);
    expect(err).toBeInstanceOf(AdminError);
    expect(err.message).toMatch(/send \/start/);
    expect(m.adminSetting.upsert).not.toHaveBeenCalled();
  });

  it("passes on Telegram's refusal of the token", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: false, description: "Unauthorized" }), { status: 401 }));
    await expect(connectTelegram(ctx, fetchImpl as unknown as typeof fetch)).rejects.toThrow(/Unauthorized/);
  });
});

describe("Send test alert and Disconnect", () => {
  it("sends a sample alert with placeholder details to the saved chat", async () => {
    m.rows.set(TELEGRAM_CHAT_SETTING, { chatId: "4242", name: "Test Owner", connectedAt: "2026-10-31T00:00:00.000Z" });
    const fetchImpl = bot([]);
    expect(await sendTelegramTestAlert(fetchImpl as unknown as typeof fetch)).toEqual({ name: "Test Owner" });
    const body = JSON.parse(String((fetchImpl.mock.calls[0] as unknown as Call)[1].body));
    expect(body.chat_id).toBe("4242");
    expect(body.text).toContain("test alert");
  });

  it("needs a connected chat before a test", async () => {
    await expect(sendTelegramTestAlert(bot([]) as unknown as typeof fetch)).rejects.toThrow(/Connect a Telegram chat first/);
  });

  it("forgets the chat, audited", async () => {
    m.rows.set(TELEGRAM_CHAT_SETTING, { chatId: "4242", name: "Test Owner", connectedAt: "" });
    expect(await disconnectTelegram(ctx)).toEqual({ name: "Test Owner" });
    expect(await readTelegramChat()).toBeNull();
    expect(m.writeAudit).toHaveBeenCalledWith(m.tx, ctx, "update_setting", `setting:${TELEGRAM_CHAT_SETTING}`, { chatId: "4242", name: "Test Owner" }, null);
  });
});

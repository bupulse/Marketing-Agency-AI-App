import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOutbox, isRetryable, lastMessageId, mergeMessages, retryDelay, type Outgoing } from "@/lib/support/client/outbox";
import type { MessageView } from "@/lib/support/contract";

const msg = (id: string, at: string, extra: Partial<MessageView> = {}): MessageView => ({
  id,
  author: "VISITOR",
  kind: "TEXT",
  body: id,
  agentName: null,
  sources: null,
  actions: null,
  attachment: null,
  createdAt: at,
  clientMsgId: null,
  ...extra,
});

describe("merging messages", () => {
  it("adds new ones in time order and replaces known ones", () => {
    const a = msg("a", "2026-10-23T10:00:00Z");
    const b = msg("b", "2026-10-23T10:01:00Z");
    const merged = mergeMessages([b], [a, { ...b, body: "edited" }]);
    expect(merged.map((m) => m.id)).toEqual(["a", "b"]);
    expect(merged[1].body).toBe("edited");
    expect(lastMessageId(merged)).toBe("b");
    expect(lastMessageId([])).toBeUndefined();
  });

  it("keeps one copy of a message the server sent twice under the same clientMsgId", () => {
    const first = msg("m1", "2026-10-23T10:00:00Z", { clientMsgId: "c-1" });
    const again = msg("m2", "2026-10-23T10:00:00Z", { clientMsgId: "c-1" });
    expect(mergeMessages([first], [again]).map((m) => m.id)).toEqual(["m2"]);
  });
});

describe("retry rules", () => {
  it("retries lost answers and server errors, not refusals", () => {
    expect(isRetryable({ status: 0 })).toBe(true);
    expect(isRetryable({ status: 503 })).toBe(true);
    expect(isRetryable({ status: 429 })).toBe(true);
    expect(isRetryable({ status: 400 })).toBe(false);
    expect(isRetryable({ status: 413 })).toBe(false);
    expect(isRetryable(new Error("x"))).toBe(true);
  });

  it("backs off 1, 2, 4 … 30 seconds", () => {
    expect([1, 2, 3, 4, 5, 6, 9].map(retryDelay)).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000]);
  });
});

describe("the outbox", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("sends in order, one at a time, with the same clientMsgId on every try", async () => {
    const sent: string[] = [];
    let fail = 2;
    const box = createOutbox({
      onChange: () => {},
      deliver: async (item) => {
        sent.push(`${item.text}:${item.clientMsgId}`);
        if (item.text === "one" && fail-- > 0) throw { status: 0 };
      },
    });
    box.add({ clientMsgId: "id-one-0001", text: "one" });
    box.add({ clientMsgId: "id-two-0002", text: "two" });
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toEqual(["one:id-one-0001"]);
    expect(box.list().map((i) => i.status)).toEqual(["waiting", "waiting"]);
    await vi.advanceTimersByTimeAsync(1000); // first retry, fails again
    await vi.advanceTimersByTimeAsync(2000); // second retry, goes
    expect(sent).toEqual(["one:id-one-0001", "one:id-one-0001", "one:id-one-0001", "two:id-two-0002"]);
    expect(box.list()).toEqual([]);
  });

  it("stops on a refusal until the visitor taps retry, and holds the messages after it", async () => {
    const sent: string[] = [];
    let refuse = true;
    const changes: Outgoing[][] = [];
    const box = createOutbox({
      onChange: (i) => changes.push(i),
      describe: () => "Too big",
      deliver: async (item) => {
        sent.push(item.text!);
        if (refuse) throw { status: 413 };
      },
    });
    box.add({ text: "photo" });
    box.add({ text: "after" });
    await vi.advanceTimersByTimeAsync(5000);
    expect(sent).toEqual(["photo"]);
    expect(box.list()[0]).toMatchObject({ status: "failed", error: "Too big" });
    refuse = false;
    box.retry(box.list()[0].clientMsgId);
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toEqual(["photo", "photo", "after"]);
    expect(box.list()).toEqual([]);
  });

  it("waits while offline and goes on flush", async () => {
    let online = false;
    const sent: string[] = [];
    const box = createOutbox({ onChange: () => {}, isOnline: () => online, deliver: async (i) => void sent.push(i.text!) });
    box.add({ text: "hello" });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sent).toEqual([]);
    expect(box.list()[0].status).toBe("waiting");
    online = true;
    box.flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toEqual(["hello"]);
  });

  it("ignores the same clientMsgId added twice, and drops what the server already has", async () => {
    const box = createOutbox({ onChange: () => {}, isOnline: () => false });
    box.add({ clientMsgId: "same-id-0001", text: "a" });
    box.add({ clientMsgId: "same-id-0001", text: "a" });
    box.add({ clientMsgId: "other-id-002", text: "b" });
    expect(box.list()).toHaveLength(2);
    box.settle([msg("m1", "2026-10-23T10:00:00Z", { clientMsgId: "same-id-0001" })]);
    expect(box.list().map((i) => i.clientMsgId)).toEqual(["other-id-002"]);
  });

  it("does not upload a file again when only the message failed", async () => {
    let uploads = 0;
    let sends = 0;
    const box = createOutbox({
      onChange: () => {},
      deliver: async (item) => {
        if (!item.attachment?.attachmentId) {
          uploads++;
          box.uploaded(item.clientMsgId, "att-1");
        }
        if (sends++ === 0) throw { status: 502 };
      },
    });
    box.add({ attachment: { kind: "image", blob: new Blob(["x"]), mime: "image/jpeg", fileName: "a.jpg", bytes: 1, durationSec: null, previewUrl: null } });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(uploads).toBe(1);
    expect(sends).toBe(2);
    expect(box.list()).toEqual([]);
  });

  it("uses the sender swapped in later", async () => {
    const box = createOutbox({ onChange: () => {} });
    const sent: string[] = [];
    box.add({ text: "early" });
    await vi.advanceTimersByTimeAsync(0);
    expect(box.list()[0].status).toBe("waiting");
    box.setDeliver(async (i) => void sent.push(i.text!));
    box.flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toEqual(["early"]);
  });
});

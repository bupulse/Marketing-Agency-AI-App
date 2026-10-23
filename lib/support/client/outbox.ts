// The visitor's outgoing messages. Each has a clientMsgId made once, so a retry after a lost answer never posts it
// twice (the server ignores a clientMsgId it already has). Messages go out one at a time and in order; network errors
// wait and retry by themselves, refusals wait for a tap. Nothing here touches the page, so it is tested in node.
import type { MessageView } from "../contract";
import type { UploadKind } from "./uploads";

export type OutgoingStatus = "sending" | "waiting" | "failed";

export type LocalAttachment = {
  kind: UploadKind;
  blob: Blob;
  mime: string;
  fileName: string | null;
  bytes: number;
  durationSec: number | null;
  /** Object URL to show the photo or play the note before the server has it. */
  previewUrl: string | null;
  /** Set once the upload finished, so a retry only re-sends the message. */
  attachmentId?: string;
};

export type Outgoing = {
  clientMsgId: string;
  text?: string;
  attachment?: LocalAttachment;
  createdAt: string;
  status: OutgoingStatus;
  tries: number;
  error?: string;
};

export function newClientMsgId(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  const b = new Uint8Array(16);
  c.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

/** Adds new messages and replaces known ones (by id, or by clientMsgId for our own), oldest first. */
export function mergeMessages(current: MessageView[], incoming: MessageView[]): MessageView[] {
  if (!incoming.length) return current;
  const byKey = new Map<string, MessageView>();
  for (const m of current) byKey.set(m.id, m);
  for (const m of incoming) {
    if (m.clientMsgId) {
      for (const [k, old] of byKey) if (old.clientMsgId === m.clientMsgId && k !== m.id) byKey.delete(k);
    }
    byKey.set(m.id, m);
  }
  return [...byKey.values()].sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
}

/** The newest message id, for GET …/messages?after=. */
export function lastMessageId(messages: MessageView[]): string | undefined {
  return messages.length ? messages[messages.length - 1].id : undefined;
}

/** An error from the API client: status 0 when the request never got an answer. */
export type SendError = { status: number; code?: string; message?: string };

/** No answer, a timeout, too many requests or a server error: worth trying again by itself. */
export function isRetryable(err: unknown): boolean {
  const status = typeof err === "object" && err && "status" in err ? Number((err as SendError).status) : 0;
  return status === 0 || status === 408 || status === 425 || status === 429 || status >= 500;
}

/** 1 s, 2 s, 4 s … at most 30 s. */
export function retryDelay(tries: number): number {
  return Math.min(30_000, 1000 * 2 ** Math.max(0, tries - 1));
}

type Timers = { set: (fn: () => void, ms: number) => unknown; clear: (id: unknown) => void };
const realTimers: Timers = { set: (fn, ms) => setTimeout(fn, ms), clear: (id) => clearTimeout(id as ReturnType<typeof setTimeout>) };

export type OutboxOptions = {
  /** Sends one message (uploading its attachment first); resolves when the server has it. Can be swapped (setDeliver). */
  deliver?: (item: Outgoing) => Promise<void>;
  onChange: (items: Outgoing[]) => void;
  isOnline?: () => boolean;
  timers?: Timers;
  /** A refusal's message for the bubble ("That file is bigger than 10 MB"). */
  describe?: (err: unknown) => string | undefined;
};

export function createOutbox(o: OutboxOptions) {
  const timers = o.timers ?? realTimers;
  const online = o.isOnline ?? (() => true);
  let deliver = o.deliver ?? (() => Promise.reject({ status: 0 }));
  let items: Outgoing[] = [];
  let busy = false;
  let timer: unknown = null;
  let stopped = false;

  const emit = () => o.onChange(items.slice());
  const update = (id: string, patch: Partial<Outgoing>) => {
    items = items.map((i) => (i.clientMsgId === id ? { ...i, ...patch } : i));
  };

  const schedule = (ms: number) => {
    if (timer !== null) timers.clear(timer);
    timer = timers.set(() => {
      timer = null;
      void pump();
    }, ms);
  };

  async function pump(): Promise<void> {
    if (busy || stopped) return;
    // Strictly in order: a failed message holds the ones after it (the first one may be what opens the chat).
    const next = items.find((i) => i.status !== "failed");
    const blocked = items.findIndex((i) => i.status === "failed");
    if (!next || (blocked !== -1 && items.indexOf(next) > blocked)) return;
    if (!online()) {
      if (next.status !== "waiting") {
        update(next.clientMsgId, { status: "waiting" });
        emit();
      }
      return;
    }
    busy = true;
    const tries = next.tries + 1;
    update(next.clientMsgId, { status: "sending", tries, error: undefined });
    emit();
    try {
      await deliver(items.find((i) => i.clientMsgId === next.clientMsgId) ?? next);
      items = items.filter((i) => i.clientMsgId !== next.clientMsgId);
      emit();
      busy = false;
      void pump();
    } catch (err) {
      busy = false;
      if (isRetryable(err)) {
        update(next.clientMsgId, { status: "waiting" });
        emit();
        schedule(retryDelay(tries));
      } else {
        update(next.clientMsgId, { status: "failed", error: o.describe?.(err) });
        emit();
      }
    }
  }

  return {
    /** The sender to use from now on (the page swaps it when the client or the conversation changes). */
    setDeliver(fn: (item: Outgoing) => Promise<void>) {
      deliver = fn;
    },
    add(item: { clientMsgId?: string; text?: string; attachment?: LocalAttachment; createdAt?: string }) {
      const full: Outgoing = {
        clientMsgId: item.clientMsgId ?? newClientMsgId(),
        text: item.text,
        attachment: item.attachment,
        createdAt: item.createdAt ?? new Date().toISOString(),
        status: "waiting",
        tries: 0,
      };
      if (items.some((i) => i.clientMsgId === full.clientMsgId)) return full.clientMsgId;
      items = [...items, full];
      emit();
      void pump();
      return full.clientMsgId;
    },
    /** Remembers the uploaded attachment so the next try does not upload it again. */
    uploaded(clientMsgId: string, attachmentId: string) {
      items = items.map((i) => (i.clientMsgId === clientMsgId && i.attachment ? { ...i, attachment: { ...i.attachment, attachmentId } } : i));
    },
    retry(clientMsgId: string) {
      update(clientMsgId, { status: "waiting", error: undefined });
      emit();
      void pump();
    },
    /** Everything that failed, again (the visitor just filled the form the server asked for). */
    retryFailed() {
      items = items.map((i) => (i.status === "failed" ? { ...i, status: "waiting" as const, error: undefined } : i));
      emit();
      void pump();
    },
    /** Back online, or the panel opened again: try now instead of waiting for the timer. */
    flush() {
      if (timer !== null) timers.clear(timer);
      timer = null;
      void pump();
    },
    /** Messages the server already shows (seen over REST) need no more sending. */
    settle(messages: MessageView[]) {
      const known = new Set(messages.map((m) => m.clientMsgId).filter(Boolean));
      const before = items.length;
      items = items.filter((i) => !known.has(i.clientMsgId) || i.status === "sending");
      if (items.length !== before) emit();
    },
    remove(clientMsgId: string) {
      items = items.filter((i) => i.clientMsgId !== clientMsgId);
      emit();
    },
    list: () => items.slice(),
    /** Starts again after stop() (React mounts twice in development). */
    start() {
      stopped = false;
      void pump();
    },
    stop() {
      stopped = true;
      if (timer !== null) timers.clear(timer);
      timer = null;
    },
  };
}

export type Outbox = ReturnType<typeof createOutbox>;

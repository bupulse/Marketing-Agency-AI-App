"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SupportApiError, type Me, type RealtimeStatus, type SupportClient, type Visit } from "@/lib/support/client/api";
import { COPY } from "@/lib/support/client/copy";
import { createOutbox, lastMessageId, mergeMessages, type LocalAttachment, type Outgoing } from "@/lib/support/client/outbox";
import { createPathReporter, createThrottle, reportablePath, reportableReferrer } from "@/lib/support/client/paths";
import { KEYS, markChatted, read, visitorKey, write } from "@/lib/support/client/storage";
import type { ConversationView, MessageView, RealtimeEvent, Surface } from "@/lib/support/contract";

export type Conversation = Omit<ConversationView, "messages">;
export type Typing = { who: "ai" | "agent" } | null;
export type Connection = "ok" | "reconnecting" | "offline";

const HEARTBEAT_MS = 45_000;
const POLL_MS = 5_000;
const TYPING_SHOW_MS = 6_000;
const AI_WAIT_MS = 25_000;

const meta = (c: ConversationView): Conversation => {
  const { messages: _m, ...rest } = c;
  void _m;
  return rest;
};

/** Text-only messages that did not go out survive a reload (sessionStorage); files cannot. */
function savedOutbox(): { clientMsgId: string; text: string; createdAt: string }[] {
  try {
    const v = JSON.parse(read("session", KEYS.outbox) ?? "[]") as unknown;
    return Array.isArray(v) ? v.filter((x) => x && typeof x.clientMsgId === "string" && typeof x.text === "string").slice(0, 20) : [];
  } catch {
    return [];
  }
}

/**
 * The visitor chat's state: the visit, the conversation and its messages, the outbox, real time while the panel is
 * open (polling every 5 s while the socket is down), heartbeats while the tab is visible, and page changes.
 */
export function useSupportChat({ client, surface, pathname, open, challenge, onUnread }: {
  client: SupportClient | null;
  surface: Surface;
  pathname: string;
  open: boolean;
  /** Turnstile, when the server asks for it; null when there is no key or no answer. */
  challenge: (siteKey: string) => Promise<string | null>;
  /** The heartbeat found new agent messages (a reply, or an agent started a chat) while the panel was closed. */
  onUnread?: () => void;
}) {
  const [visit, setVisit] = useState<Visit | null>(null);
  const [failed, setFailed] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const [conv, setConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<MessageView[]>([]);
  const [outgoing, setOutgoing] = useState<Outgoing[]>([]);
  const [rt, setRt] = useState<RealtimeStatus>("down");
  const [pollFailing, setPollFailing] = useState(false);
  const [online, setOnline] = useState(true);
  const [typing, setTyping] = useState<Typing>(null);
  const [unread, setUnread] = useState(false);
  const [ended, setEnded] = useState(false);

  const convRef = useRef<Conversation | null>(null);
  const messagesRef = useRef<MessageView[]>([]);
  const visitRef = useRef<Visit | null>(null);
  const openRef = useRef(open);
  const pathRef = useRef(pathname);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    openRef.current = open;
  }, [open]);

  const showTyping = useCallback((t: Typing, ms: number) => {
    if (typingTimer.current) clearTimeout(typingTimer.current);
    setTyping(t);
    typingTimer.current = t ? setTimeout(() => setTyping(null), ms) : null;
  }, []);

  // New messages from anyone but the visitor: the typing dots stop, and a closed panel gets a dot on the button.
  const take = useCallback(
    (incoming: MessageView[], c?: Partial<Conversation>) => {
      const before = new Set(messagesRef.current.map((m) => m.id));
      const fresh = incoming.filter((m) => !before.has(m.id) && m.author !== "VISITOR");
      messagesRef.current = mergeMessages(messagesRef.current, incoming);
      setMessages(messagesRef.current);
      if (c && convRef.current) {
        convRef.current = { ...convRef.current, ...c };
        setConv(convRef.current);
        if (c.status === "CLOSED") setEnded(true);
      }
      if (fresh.length) {
        showTyping(null, 0);
        if (!openRef.current) setUnread(true);
      }
    },
    [showTyping],
  );

  const applyConversation = useCallback(
    (cv: ConversationView) => {
      if (!convRef.current || convRef.current.id !== cv.id) {
        convRef.current = meta(cv);
        setConv(convRef.current);
      }
      take(cv.messages, meta(cv));
    },
    [take],
  );

  // ---- the outbox: its sender is swapped in below, so it always uses the current client and conversation ----
  const [box] = useState(() =>
    createOutbox({
      onChange: (items) => {
        setOutgoing(items);
        write("session", KEYS.outbox, JSON.stringify(items.filter((i) => i.text && !i.attachment).map((i) => ({ clientMsgId: i.clientMsgId, text: i.text, createdAt: i.createdAt }))));
      },
      isOnline: () => typeof navigator === "undefined" || navigator.onLine !== false,
      describe: (err) =>
        err instanceof SupportApiError
          ? err.status === 413
            ? COPY.tooBig
            : err.status === 415
              ? COPY.badType
              : err.code === "challenge_required" || err.code === "challenge_failed"
                ? COPY.challenge
                : err.status === 403 || err.status === 409
                  ? err.message || undefined
                  : undefined
          : undefined,
    }),
  );
  useEffect(() => {
    box.start();
    return () => box.stop();
  }, [box]);

  const withChallenge = useCallback(
    async <T,>(fn: (token?: string) => Promise<T>): Promise<T> => {
      try {
        return await fn();
      } catch (err) {
        const key = visitRef.current?.turnstileSiteKey;
        if (err instanceof SupportApiError && err.code === "challenge_required" && key) {
          const token = await challenge(key);
          if (token) return fn(token);
        }
        throw err;
      }
    },
    [challenge],
  );

  useEffect(() => {
    box.setDeliver(async (item) => {
      if (!client) throw new SupportApiError(0, "network", "No client");
      const c = convRef.current;
      let attachmentId = item.attachment?.attachmentId;
      if (item.attachment && !attachmentId) {
        if (!c) throw new SupportApiError(400, "no_conversation", COPY.attachFirst);
        const a = item.attachment;
        const r = await client.upload(c.id, a.blob, { mime: a.mime, fileName: a.fileName ?? undefined, durationSec: a.durationSec ?? undefined });
        attachmentId = r.attachmentId;
        box.uploaded(item.clientMsgId, attachmentId);
      }
      const body = { text: item.text || undefined, attachmentId, clientMsgId: item.clientMsgId };
      // The AI's answer comes back in this very response: show it is on it meanwhile.
      if (!c || c.aiActive) showTyping({ who: "ai" }, AI_WAIT_MS);
      let res;
      try {
        res = await withChallenge((turnstileToken) => (c ? client.send(c.id, { ...body, turnstileToken }) : client.start({ ...body, turnstileToken })));
      } catch (err) {
        showTyping(null, 0);
        // The server wants the form first (public and bio pages): show it; the message goes once it is sent.
        if (err instanceof SupportApiError && err.code === "form_required") setMe((m) => (m ? { ...m, needsForm: true } : m));
        throw err;
      }
      applyConversation(res.conversation);
      markChatted();
      // Still no answer in the response (the AI is slow, or a person answers): real time or the next poll brings it.
      const last = res.conversation.messages[res.conversation.messages.length - 1];
      if (!res.conversation.aiActive || (last && last.author !== "VISITOR")) showTyping(null, 0);
    });
    box.flush();
  }, [client, box, applyConversation, withChallenge, showTyping]);

  // ---- the visit: POST /visit on every page load (with the token we have), and again when the server lost it ----
  const applyVisit = useCallback(
    (v: Visit) => {
      visitRef.current = v;
      setVisit(v);
      setMe(v.me);
      // A chat the visitor did not know about yet (an agent's invite), or the one open in another tab.
      if (v.conversation && (!convRef.current || convRef.current.id !== v.conversation.id)) {
        convRef.current = meta(v.conversation);
        setConv(convRef.current);
        messagesRef.current = mergeMessages([], v.conversation.messages);
        setMessages(messagesRef.current);
        setEnded(v.conversation.status === "CLOSED");
      }
    },
    [],
  );
  const visitBodyNow = useCallback(
    () => ({
      visitorKey: visitorKey(),
      surface,
      path: reportablePath(pathRef.current),
      title: document.title.slice(0, 300) || undefined,
      referrer: reportableReferrer(document.referrer),
      screenW: window.screen?.width || undefined,
      // Global Privacy Control: the server stores no IP, city or page list, and shows no greeting.
      optOut: (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true || undefined,
    }),
    [surface],
  );
  const revisit = useCallback(async () => {
    if (!client) return;
    try {
      applyVisit(await client.visit(visitBodyNow()));
    } catch {
      // the next heartbeat tries again
    }
  }, [client, applyVisit, visitBodyNow]);

  useEffect(() => {
    if (!client) return;
    let gone = false;
    client
      .visit(visitBodyNow())
      .then((v) => {
        if (gone) return;
        applyVisit(v);
        // Messages typed before a reload go out again with the same clientMsgId (the server ignores repeats).
        for (const s of savedOutbox()) box.add(s);
      })
      .catch(() => {
        if (!gone) setFailed(true);
      });
    return () => {
      gone = true;
    };
  }, [client, box, applyVisit, visitBodyNow]);

  // ---- fetching new messages ----
  const inflight = useRef<Promise<void> | null>(null);
  const again = useRef(false);
  const full = useRef(false);
  /** New messages since the last one we have; `all` fetches the newest 60 again (which also marks them seen). */
  const refresh = useCallback(async (all = false): Promise<void> => {
    if (!client || !convRef.current) return;
    if (all) full.current = true;
    if (inflight.current) {
      again.current = true;
      return inflight.current;
    }
    inflight.current = (async () => {
      do {
        again.current = false;
        const c = convRef.current;
        if (!c) break;
        try {
          const everything = full.current;
          full.current = false;
          const r = await client.messages(c.id, everything ? undefined : lastMessageId(messagesRef.current));
          take(r.messages, { status: r.status, aiActive: r.aiActive, agent: r.agent });
          box.settle(messagesRef.current);
          setPollFailing(false);
        } catch {
          setPollFailing(true);
        }
      } while (again.current);
      inflight.current = null;
    })();
    return inflight.current;
  }, [client, take, box]);

  // ---- real time, only while the panel is open ----
  const topic = conv?.topic ?? visit?.topic ?? null;
  const onEvent = useCallback(
    (e: RealtimeEvent) => {
      if (e.type === "typing") {
        if (e.who === "agent" || e.who === "ai") showTyping({ who: e.who }, e.who === "ai" ? AI_WAIT_MS : TYPING_SHOW_MS);
        return;
      }
      if (e.type === "message.created" || e.type === "conversation.updated" || e.type === "handover") {
        // An agent's invite opens a conversation the widget does not know yet: the next /visit would bring it.
        if (!convRef.current || e.conversationId !== convRef.current.id) {
          if (!convRef.current) setUnread(true);
          return;
        }
        void refresh();
      }
    },
    [refresh, showTyping],
  );

  useEffect(() => {
    if (!client || !open || !topic) return;
    const stop = client.subscribe(topic, onEvent, (s) => {
      setRt(s);
      // Back on the socket: catch up on what was missed meanwhile.
      if (s === "live") void refresh();
    });
    return () => {
      stop();
      setRt("down");
    };
  }, [client, open, topic, onEvent, refresh]);

  // Polling every 5 s, only while the panel is open and the socket is down.
  useEffect(() => {
    if (!open || !conv || rt === "live") return;
    const t = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(t);
  }, [open, conv, rt, refresh]);

  // Opening the panel: catch up at once (all of it, so the server marks the agent's messages seen) and try any waiting
  // message.
  useEffect(() => {
    if (!open) return;
    void refresh(true);
    box.flush();
  }, [open, refresh, box]);

  // ---- online / offline ----
  useEffect(() => {
    const up = () => {
      setOnline(true);
      box.flush();
      void refresh();
    };
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, [box, refresh]);

  // ---- heartbeats and page changes ----
  const ready = !!visit;
  const lastUnread = useRef(0);
  const onUnreadRef = useRef(onUnread);
  useEffect(() => {
    onUnreadRef.current = onUnread;
  }, [onUnread]);
  const beat = useCallback(
    (path: string, title?: string) => {
      if (!client) return;
      void client
        .heartbeat(path, title)
        .then(async (r) => {
          if (!r) return;
          if (!r.ok) {
            if (r.error === "expired" || r.error === "unknown") await revisit();
            return;
          }
          const n = r.unread ?? lastUnread.current;
          const more = n > lastUnread.current;
          lastUnread.current = n;
          if (!more || openRef.current) return;
          // An agent wrote: make sure the chat is known (an invite opens a new one), then show it.
          if (!convRef.current) await revisit();
          setUnread(true);
          onUnreadRef.current?.();
        })
        .catch(() => {});
    },
    [client, revisit],
  );
  const reporter = useRef<ReturnType<typeof createPathReporter> | null>(null);
  useEffect(() => {
    if (!ready) return;
    const r = createPathReporter(beat);
    r.seed(window.location.pathname);
    reporter.current = r;
    let lastAt = Date.now();
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      lastAt = Date.now();
      beat(reportablePath(pathRef.current), document.title);
    };
    const t = setInterval(tick, HEARTBEAT_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - lastAt > HEARTBEAT_MS / 2) tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
      r.cancel();
      reporter.current = null;
    };
  }, [ready, beat]);

  useEffect(() => {
    pathRef.current = pathname;
    reporter.current?.push(pathname, document.title);
  }, [pathname]);

  // ---- the typing draft (1 per second, only with the panel open and a conversation) ----
  const draftThrottle = useRef<ReturnType<typeof createThrottle<string>> | null>(null);
  useEffect(() => {
    if (!client) return;
    const t = createThrottle<string>((text) => {
      const c = convRef.current;
      if (c && openRef.current) void client.typing(c.id, text).catch(() => {});
    }, 1000);
    draftThrottle.current = t;
    return () => {
      t.cancel();
      draftThrottle.current = null;
    };
  }, [client]);

  // ---- actions ----
  const actions = useMemo(
    () => ({
      send(text: string) {
        const t = text.trim();
        if (!t) return;
        box.add({ text: t });
      },
      attach(attachment: LocalAttachment, text?: string) {
        box.add({ attachment, text });
      },
      retry: (id: string) => box.retry(id),
      discard: (id: string) => box.remove(id),
      draft: (text: string) => draftThrottle.current?.call(text),
      async prechat(body: { name: string; email: string; business: string; whatsapp?: string }) {
        if (!client) throw new SupportApiError(0, "network", "No client");
        const r = await withChallenge((turnstileToken) => client.prechat({ ...body, turnstileToken }));
        setMe(r.me);
        // Messages the server held back for the form go now.
        box.retryFailed();
      },
      async human() {
        if (!client) return;
        const c = convRef.current;
        if (!c) {
          // No chat yet: the request itself opens it, then the hand-over.
          box.add({ text: COPY.talkToPerson });
          return;
        }
        try {
          applyConversation((await client.human(c.id)).conversation);
        } catch {
          box.add({ text: COPY.talkToPerson });
        }
      },
      async end() {
        const c = convRef.current;
        setEnded(true);
        if (client && c) await client.end(c.id).catch(() => {});
      },
      async rate(score: 1 | -1, comment: string, sendTranscript: boolean) {
        const c = convRef.current;
        if (!client || !c) return;
        await client.rate(c.id, { score, comment: comment.trim() || undefined, sendTranscript });
      },
      newChat() {
        convRef.current = null;
        messagesRef.current = [];
        setConv(null);
        setMessages([]);
        setEnded(false);
        showTyping(null, 0);
      },
      seen: () => setUnread(false),
    }),
    [box, client, withChallenge, applyConversation, showTyping],
  );

  const connection: Connection = !online
    ? "offline"
    : outgoing.some((o) => o.status === "waiting" && o.tries > 0) || (open && !!conv && rt !== "live" && pollFailing)
      ? "reconnecting"
      : "ok";

  return { visit, failed, me, conv, messages, outgoing, typing, unread, ended, connection, actions };
}

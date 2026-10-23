// A pretend support server for the widget's tests (tests/support-widget). Nothing in the app imports it, so it never
// ships.
// The AI answers a few topics, "Talk to a person" brings in "Jean M.", uploads become object URLs. In memory only.
import type { ConversationView, MessageView, RealtimeEvent, Surface } from "../contract";
import type { Me, MessagesResponse, RealtimeStatus, SupportClient, Visit } from "./api";

type Timer = (fn: () => void, ms: number) => void;

export function createMockClient(opts: { delay?: Timer; socket?: "live" | "down"; greetingDelaySec?: number } = {}): SupportClient {
  const later: Timer = opts.delay ?? ((fn, ms) => void setTimeout(fn, ms));
  const listeners = new Set<(e: RealtimeEvent) => void>();
  let surface: Surface = "public";
  let me: Me = { name: null, email: null, signedIn: false, businessName: null, needsForm: true };
  let conv: ConversationView | null = null;
  let seq = 0;
  let number = 41;

  const now = () => new Date(Date.now() + seq).toISOString();
  const emit = (e: RealtimeEvent) => listeners.forEach((l) => l(e));
  const snapshot = (): ConversationView => ({ ...conv!, messages: conv!.messages.slice() });

  function add(m: Partial<MessageView> & Pick<MessageView, "author" | "body">): MessageView {
    seq++;
    const msg: MessageView = { id: `m${seq}`, kind: "TEXT", agentName: null, sources: null, actions: null, attachment: null, createdAt: now(), clientMsgId: null, ...m };
    conv!.messages.push(msg);
    return msg;
  }

  function aiAnswer(text: string): Pick<MessageView, "body" | "sources" | "actions"> {
    const t = text.toLowerCase();
    if (/price|cost|plan|pay|momo|trial/.test(t))
      return {
        body: "BuPulse has three plans, all with a free trial. In Billing choose Mobile Money, send the amount to the number shown, then type the transaction ID. The team confirms it during opening hours.",
        sources: [{ title: "Billing, plans and usage", href: "/pricing" }],
        actions: [{ label: "See prices", href: "/pricing" }],
      };
    if (/instagram|facebook|tiktok|post|connect/.test(t))
      return {
        body: "Your posts go out through Channels. If a connection expired, tap Reconnect next to it and the waiting posts will go out by themselves.",
        sources: [{ title: "Social connections", href: null }],
        actions: [{ label: "Open Channels", href: "/dashboard/connections" }],
      };
    if (/page like this|bio|link/.test(t))
      return {
        body: "Every BuPulse plan includes a free link-in-bio page like this one: your logo, a WhatsApp button, your prices and opening hours. You set it up in a few minutes after signing up.",
        sources: [{ title: "Link in bio", href: null }],
        actions: [{ label: "Start free trial", href: "/signup" }],
      };
    return {
      body: "BuPulse writes your posts, designs your graphics and answers your website visitors, in your brand voice. Want me to explain a feature, or should I bring in a person?",
      sources: [{ title: "Getting started", href: null }],
      actions: null,
    };
  }

  function reply(text: string) {
    const c = conv!;
    if (c.status === "CLOSED") return;
    if (c.aiActive) {
      emit({ type: "typing", conversationId: c.id, who: "ai" });
      later(() => {
        const m = add({ author: "AI", ...aiAnswer(text) });
        emit({ type: "message.created", conversationId: c.id, messageId: m.id });
      }, 1200);
    } else if (c.agent) {
      later(() => emit({ type: "typing", conversationId: c.id, who: "agent" }), 600);
      later(() => {
        const m = add({ author: "AGENT", agentName: "Jean M.", body: "Thanks, let me check that for you." });
        emit({ type: "message.created", conversationId: c.id, messageId: m.id });
      }, 2600);
    }
  }

  function visitorMessage(body: { text?: string; attachmentId?: string; clientMsgId: string }) {
    const known = conv!.messages.find((m) => m.clientMsgId === body.clientMsgId);
    if (known) return; // the same clientMsgId twice: idempotent, like the real server
    const file = body.attachmentId ? uploads.get(body.attachmentId) : null;
    add({ author: "VISITOR", kind: file ? (file.attachment.durationSec !== null ? "VOICE" : "FILE") : "TEXT", body: body.text ?? "", clientMsgId: body.clientMsgId, attachment: file?.attachment ?? null });
    reply(body.text ?? (file?.attachment.transcript ?? "a file"));
  }

  const uploads = new Map<string, { attachment: NonNullable<MessageView["attachment"]> }>();

  return {
    async visit(body) {
      surface = body.surface;
      if (surface === "dashboard" || surface === "creator") me = { name: "Aline", email: "aline@example.com", signedIn: true, businessName: surface === "dashboard" ? "Sample Beauty Salon" : null, needsForm: false };
      const pricing = /^\/(pricing|signup)(\/|$)/.test(body.path);
      const greeting =
        surface === "bio"
          ? null
          : {
              text: pricing ? "Questions about plans? Ask me anything about BuPulse." : "Hi! Questions about BuPulse? Ask me anything.",
              delaySec: opts.greetingDelaySec ?? (pricing ? 30 : 15),
              quickReplies: pricing ? ["Which plan fits me?", "How does the trial work?"] : ["What does BuPulse do?", "How much does it cost?"],
            };
      const v: Visit = {
        visitToken: "mock-visit",
        me,
        hours: { open: true, opensAt: null, closesAt: "20:00", timezone: "Africa/Kigali", label: "team open until 20:00" },
        greeting,
        conversation: conv && conv.status !== "CLOSED" ? snapshot() : null,
        realtime: { url: "mock", anonKey: "mock" },
        topic: "sv:mock",
        whatsapp: "+250700000000",
        turnstileSiteKey: null,
      };
      return v;
    },
    async prechat(body) {
      me = { name: body.name, email: body.email, signedIn: false, businessName: body.business, needsForm: false };
      return { me };
    },
    async start(body) {
      number++;
      conv = { id: `c${number}`, number, status: "AI", aiActive: true, agent: null, topic: "sv:mock", rating: null, messages: [] };
      visitorMessage(body);
      return { conversation: snapshot() };
    },
    async send(_id, body) {
      visitorMessage(body);
      return { conversation: snapshot() };
    },
    async messages(_id, after): Promise<MessagesResponse> {
      const all = conv?.messages ?? [];
      const i = after ? all.findIndex((m) => m.id === after) : -1;
      return { messages: all.slice(i + 1), status: conv?.status ?? "AI", aiActive: conv?.aiActive ?? true, agent: conv?.agent ?? null };
    },
    async typing() {},
    async human() {
      const c = conv!;
      add({ author: "AI", body: "Sure, I’m passing you to the team now. They usually reply within 2 minutes.", sources: null });
      c.status = "WAITING";
      later(() => {
        c.status = "OPEN";
        c.aiActive = false;
        c.agent = { name: "Jean M.", department: "Billing" };
        const e = add({ author: "SYSTEM", kind: "EVENT", body: "Jean joined · the AI stepped back" });
        emit({ type: "message.created", conversationId: c.id, messageId: e.id });
        emit({ type: "typing", conversationId: c.id, who: "agent" });
      }, 2500);
      later(() => {
        const m = add({ author: "AGENT", agentName: "Jean M.", body: `Hi${me.name ? ` ${me.name}` : ""}, I’m Jean from the BuPulse team. How can I help?` });
        emit({ type: "message.created", conversationId: c.id, messageId: m.id });
      }, 4500);
      return { conversation: snapshot() };
    },
    async upload(_id, file, meta) {
      seq++;
      const id = `a${seq}`;
      const url = typeof URL !== "undefined" && "createObjectURL" in URL ? URL.createObjectURL(file) : null;
      const voice = meta.mime.startsWith("audio/");
      uploads.set(id, {
        attachment: { id, mime: meta.mime, fileName: meta.fileName ?? null, bytes: file.size, url, durationSec: voice ? (meta.durationSec ?? 0) : null, transcript: voice ? "Murakoze cyane! That’s all." : null },
      });
      return { attachmentId: id };
    },
    async rate(_id, body) {
      if (conv) conv.rating = body.score;
    },
    async end() {
      if (conv) conv.status = "CLOSED";
    },
    async heartbeat() {
      return null;
    },
    subscribe(_topic, onEvent, onStatus: (s: RealtimeStatus) => void) {
      if (opts.socket === "down") {
        onStatus("down");
        return () => {};
      }
      listeners.add(onEvent);
      later(() => onStatus("live"), 50);
      return () => listeners.delete(onEvent);
    },
  };
}

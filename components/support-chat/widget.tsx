"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { SupportClient } from "@/lib/support/client/api";
import { COPY } from "@/lib/support/client/copy";
import { fromAdOrBio, greetingMode } from "@/lib/support/client/greeting";
import { isPhoneWidth } from "@/lib/support/client/mount";
import { KEYS, lastChatAt, read, write } from "@/lib/support/client/storage";
import { whatsappLink } from "@/lib/content/contact";
import type { Surface } from "@/lib/support/contract";
import { cn } from "@/lib/cn";
import { Composer } from "./composer";
import { EndScreen } from "./end-screen";
import { CloseIcon, PulseIcon, WhatsAppIcon } from "./icons";
import { Launcher } from "./launcher";
import { makeClient } from "./load";
import { useTurnstile } from "./media";
import { MessageList } from "./messages";
import { PrechatForm } from "./prechat-form";
import { useSupportChat } from "./use-support-chat";

export type WidgetProps = {
  surface: Surface;
  pathname: string;
  /** floating: the corner button and its panel. page: the full-page chat (/help-chat), always open. */
  mode: "floating" | "page";
  /** The button was tapped before the chat had loaded. */
  initialOpen?: boolean;
  /** page mode: what the close button does. */
  onLeave?: () => void;
};

const onResize = (cb: () => void) => {
  window.addEventListener("resize", cb);
  return () => window.removeEventListener("resize", cb);
};

/** Above the button, on the same corner (the desktop panel). */
const ABOVE = "fixed right-4 bottom-[calc(var(--bp-bottom-bar,0px)+5.5rem)] sm:right-6 sm:bottom-[calc(var(--bp-bottom-bar,0px)+6.25rem)]";
/** The greeting: also above the WhatsApp button when the page has one (--bp-fab-stack, app/globals.css). */
const ABOVE_ALL =
  "fixed right-4 bottom-[calc(var(--bp-bottom-bar,0px)+var(--bp-fab-stack,0px)+5.5rem)] sm:right-6 sm:bottom-[calc(var(--bp-bottom-bar,0px)+var(--bp-fab-stack,0px)+6.25rem)]";
const ICON_BTN = "inline-flex size-9 flex-none cursor-pointer items-center justify-center rounded-full border-0 bg-bg text-muted hover:text-text";

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([tabindex="-1"]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

function initials(name: string) {
  return name
    .replace(/\./g, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

export function Widget({ surface, pathname, mode, initialOpen = false, onLeave }: WidgetProps) {
  const [client, setClient] = useState<SupportClient | null>(null);
  useEffect(() => {
    let gone = false;
    void makeClient().then((c) => !gone && setClient(c));
    return () => {
      gone = true;
    };
  }, []);

  const page = mode === "page";
  const [open, setOpen] = useState(page || initialOpen);
  const isPhone = useSyncExternalStore(onResize, () => isPhoneWidth(window.innerWidth), () => false);
  const { box: tsBox, visible: tsVisible, token: tsToken } = useTurnstile();
  const chat = useSupportChat({ client, surface, pathname, open, challenge: tsToken });
  const { visit, me, conv, actions } = chat;

  const launcher = useRef<HTMLButtonElement | null>(null);
  const panel = useRef<HTMLElement | null>(null);
  const firstField = useRef<HTMLInputElement | null>(null);
  const composer = useRef<HTMLTextAreaElement | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** A greeting quick reply tapped before the form: sent once the form is done. */
  const queued = useRef<string | null>(null);

  // ---- this visit's pages, for "never on the first page of a visit from an ad or a bio link" ----
  const pageIndex = useRef(0);
  useEffect(() => {
    const n = Number(read("session", KEYS.pages)) || 0;
    // The same page again (a reload, or React's second run in development) is not a new page.
    if (n > 0 && read("session", KEYS.page) === pathname) {
      pageIndex.current = n - 1;
      return;
    }
    if (n === 0) write("session", KEYS.landing, fromAdOrBio(window.location.search, document.referrer) ? "1" : "0");
    write("session", KEYS.pages, String(n + 1));
    write("session", KEYS.page, pathname);
    pageIndex.current = n;
  }, [pathname]);

  // ---- the greeting: once per visit, after the page's delay ----
  const [greeting, setGreeting] = useState<"bubble" | "dot" | null>(null);
  const chatting = !!conv && conv.status !== "CLOSED";
  useEffect(() => {
    if (page || !visit?.greeting) return;
    const show = greetingMode({
      greeting: visit.greeting,
      surface,
      isPhone,
      now: Date.now(),
      lastChatAt: lastChatAt(),
      pageIndex: pageIndex.current,
      landedFromAdOrBio: read("session", KEYS.landing) === "1",
      chatting,
      panelOpen: open,
      seenThisVisit: read("session", KEYS.greetingSeen) === "1",
    });
    if (!show) return;
    const t = setTimeout(() => {
      write("session", KEYS.greetingSeen, "1");
      setGreeting(show);
    }, visit.greeting.delaySec * 1000);
    return () => clearTimeout(t);
  }, [page, visit, surface, isPhone, chatting, open, pathname]);

  const openPanel = useCallback(() => {
    setOpen(true);
    setGreeting(null);
    actions.seen();
  }, [actions]);

  const closePanel = useCallback(() => {
    if (page) return onLeave?.();
    setOpen(false);
    requestAnimationFrame(() => launcher.current?.focus());
  }, [page, onLeave]);

  // ---- phones: the panel is a full-screen sheet; Back closes it, and the page behind does not scroll ----
  const sheet = open && isPhone && !page;
  useEffect(() => {
    if (!sheet) return;
    const path = window.location.pathname;
    window.history.pushState({ ...(window.history.state ?? {}), bpSupportChat: true }, "");
    let popped = false;
    const onPop = () => {
      popped = true;
      setOpen(false);
    };
    window.addEventListener("popstate", onPop);
    const overflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => {
      window.removeEventListener("popstate", onPop);
      document.documentElement.style.overflow = overflow;
      // Closed with the X: take our history entry back off (unless the visitor already moved to another page).
      if (!popped && window.location.pathname === path && window.history.state?.bpSupportChat) window.history.back();
    };
  }, [sheet]);

  // ---- focus: into the panel when it opens (not the keyboard on phones), kept inside, Esc closes ----
  const needsForm = !!me?.needsForm && !conv;
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      const field = needsForm ? firstField.current : composer.current;
      if (!isPhone && field) field.focus();
      else panel.current?.focus();
    }, 30);
    return () => clearTimeout(t);
  }, [open, needsForm, isPhone]);

  // The page's own WhatsApp button hides while the panel is open, and takes the corner when the chat could not start.
  useEffect(() => {
    if (page || !open) return;
    document.documentElement.setAttribute("data-support-chat-open", "");
    return () => document.documentElement.removeAttribute("data-support-chat-open");
  }, [page, open]);
  useEffect(() => {
    if (page || !chat.failed) return;
    document.documentElement.setAttribute("data-support-chat-off", "");
    return () => document.documentElement.removeAttribute("data-support-chat-off");
  }, [page, chat.failed]);

  // Esc closes from anywhere (focus can drop to the page when a part of the panel goes away).
  useEffect(() => {
    if (!open || page) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) closePanel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, page, closePanel]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "Tab" || !panel.current) return;
    const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const ask = (text: string) => {
    openPanel();
    if (me?.needsForm && !conv) queued.current = text;
    else actions.send(text);
  };

  if (chat.failed && !page) return null;

  const agent = conv && !conv.aiActive ? conv.agent : null;
  const ended = chat.ended;
  const whatsappHref = whatsappLink(visit?.whatsapp ?? process.env.NEXT_PUBLIC_WHATSAPP_NUMBER, COPY.whatsappText);
  const sales = surface === "bio";
  const lastIsVisitor = chat.messages.length > 0 && chat.messages[chat.messages.length - 1].author === "VISITOR";
  const busy = !!chat.typing || chat.outgoing.length > 0 || lastIsVisitor;
  const quick = busy
    ? []
    : !conv
      ? [
          ...(sales ? COPY.salesQuickReplies : visit?.greeting?.quickReplies.length ? visit.greeting.quickReplies : COPY.defaultQuickReplies).map((q) => ({ label: q, onClick: () => actions.send(q) })),
          { label: COPY.talkToPerson, onClick: () => void actions.human() },
        ]
      : [
          ...(conv.aiActive && conv.status === "AI" ? [{ label: COPY.talkToPerson, onClick: () => void actions.human() }] : []),
          { label: COPY.allDone, onClick: () => void actions.end() },
        ];

  const header = (
    <header className="flex items-center gap-3 border-b border-line px-4 py-3.5">
      {agent ? (
        <span className="relative inline-flex size-10 flex-none items-center justify-center rounded-full bg-soft text-[15px] font-bold text-ok" aria-hidden>
          {initials(agent.name)}
          <span className="absolute -right-px -bottom-px size-[11px] rounded-full border-2 border-[var(--bp-dialog)] bg-success" />
        </span>
      ) : (
        <span className="inline-flex size-10 flex-none items-center justify-center rounded-full bg-brand-gradient text-white" aria-hidden>
          <PulseIcon />
        </span>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <h2 className="m-0 truncate text-[15px] font-semibold">{agent ? `${agent.name}${agent.department ? ` · ${agent.department}` : ""}` : COPY.title}</h2>
        <span className="flex items-center gap-1.5 truncate text-xs text-muted">
          {ended ? (
            COPY.chatEnded
          ) : agent ? (
            COPY.teamOnline
          ) : (
            <>
              <span className="size-[7px] flex-none rounded-full bg-success" aria-hidden />
              {visit ? `${COPY.aiNow} · ${visit.hours.label}` : COPY.aiNow}
            </>
          )}
        </span>
      </div>
      {whatsappHref && !needsForm && !ended && (
        <a href={whatsappHref} target="_blank" rel="noopener noreferrer" aria-label={COPY.whatsapp} title={COPY.whatsapp} className={cn(ICON_BTN, "text-success hover:text-success")}>
          <WhatsAppIcon />
        </a>
      )}
      <button type="button" onClick={closePanel} aria-label={COPY.close} className={ICON_BTN}>
        <CloseIcon />
      </button>
    </header>
  );

  const intro = (
    <>
      {me?.signedIn && me.name && <p className="m-0 self-center rounded-full border border-line bg-[var(--bp-bg-solid)] px-3 py-1 text-xs text-muted">{COPY.signedInAs(me.name, me.businessName)}</p>}
      <div className="flex max-w-[86%] flex-col gap-1.5 self-start">
        <p className="m-0 rounded-[18px_18px_18px_6px] border border-line bg-[var(--bp-bg-solid)] px-3.5 py-2.5 text-sm leading-[1.45]">{sales ? COPY.welcomeSales : COPY.welcome(me?.name?.split(" ")[0] ?? null)}</p>
        <span className="text-[11.5px] text-muted">{COPY.ai}</span>
      </div>
    </>
  );

  let body: React.ReactNode;
  if (chat.failed) body = <p className="m-0 p-6 text-sm text-muted">{COPY.unavailable}</p>;
  else if (!visit) body = <p className="m-0 p-6 text-sm text-muted" role="status">{COPY.loading}</p>;
  else if (ended)
    body = (
      <EndScreen
        agentName={conv?.agent?.name ?? null}
        email={me?.email ?? null}
        whatsappHref={whatsappHref}
        canRate={!!conv}
        onRate={actions.rate}
        onNewChat={() => {
          actions.newChat();
          setTimeout(() => composer.current?.focus(), 30);
        }}
      />
    );
  else if (needsForm)
    body = (
      <PrechatForm
        firstRef={firstField}
        onSubmit={async (b) => {
          await actions.prechat(b);
          const q = queued.current;
          queued.current = null;
          if (q) actions.send(q);
        }}
      />
    );
  else
    body = (
      <>
        {chat.connection !== "ok" && (
          <p role="status" className="m-0 border-b border-line bg-soft px-4 py-1.5 text-center text-xs font-medium text-muted">
            {chat.connection === "offline" ? COPY.offline : COPY.reconnecting}
          </p>
        )}
        <div className="flex-1 overflow-y-auto overscroll-contain bg-black/[0.02] px-3.5 pt-3.5 pb-2 dark:bg-white/[0.03]">
          <MessageList
            intro={intro}
            messages={chat.messages}
            outgoing={chat.outgoing}
            typing={chat.typing}
            agentName={conv?.agent?.name ?? null}
            quickReplies={quick}
            onRetry={actions.retry}
            onDiscard={actions.discard}
          />
        </div>
        {notice && (
          <p role="alert" className="m-0 px-4 pt-2 text-xs text-danger">
            {notice}
          </p>
        )}
        <Composer canAttach={!!conv} inputRef={composer} onSend={actions.send} onDraft={actions.draft} onAttach={(a) => {
            setNotice(null);
            actions.attach(a);
          }} onError={setNotice} />
      </>
    );

  return (
    <>
      {!page && greeting === "bubble" && !open && visit?.greeting && (
        <section aria-label={COPY.greetingLabel} className={cn(ABOVE_ALL, "z-50 flex w-[320px] max-w-[calc(100vw-2rem)] animate-pop flex-col gap-3 rounded-[20px] border border-line bg-[var(--bp-dialog)] p-4 shadow-glass print:hidden")}>
          <div className="flex items-center gap-2.5">
            <span className="inline-flex size-9 flex-none items-center justify-center rounded-full bg-brand-gradient text-white" aria-hidden>
              <PulseIcon size={18} />
            </span>
            <div className="flex flex-1 flex-col">
              <span className="text-sm font-semibold">{COPY.title}</span>
              <span className="text-xs text-muted">{COPY.greetingSub}</span>
            </div>
            <button type="button" onClick={() => setGreeting(null)} aria-label={COPY.greetingClose} className={cn(ICON_BTN, "size-8")}>
              <CloseIcon size={14} />
            </button>
          </div>
          <button type="button" onClick={openPanel} className="m-0 cursor-pointer border-0 bg-transparent p-0 text-left text-[15px] leading-[1.45] text-text">
            {visit.greeting.text}
          </button>
          {visit.greeting.quickReplies.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {visit.greeting.quickReplies.map((q) => (
                <button key={q} type="button" onClick={() => ask(q)} className="cursor-pointer rounded-full border border-pulse-blue/25 bg-soft px-3 py-2 text-[13px] font-medium text-ok">
                  {q}
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {open && (
        <section
          ref={panel}
          role="dialog"
          aria-modal={isPhone || page || undefined}
          aria-label={COPY.panelLabel}
          tabIndex={-1}
          onKeyDown={onKeyDown}
          className={cn(
            "z-50 flex flex-col overflow-hidden bg-[var(--bp-dialog)] text-text outline-none print:hidden",
            page
              ? "h-dvh w-full sm:h-[min(720px,calc(100dvh-3rem))] sm:max-w-[420px] sm:rounded-card sm:border sm:border-line sm:shadow-glass"
              : cn(
                  ABOVE,
                  "h-[min(640px,calc(100dvh-var(--bp-bottom-bar,0px)-8rem))] w-[min(380px,calc(100vw-2rem))] animate-pop rounded-card border border-line shadow-glass",
                  "max-[480px]:inset-0 max-[480px]:h-dvh max-[480px]:w-full max-[480px]:animate-[bp-sheet_0.3s_var(--ease-out-soft)_both] max-[480px]:rounded-none max-[480px]:border-0",
                ),
          )}
        >
          {header}
          {body}
          <div ref={tsBox} className={tsVisible ? "flex justify-center border-t border-line p-2" : "h-0 overflow-hidden"} aria-label={tsVisible ? COPY.challenge : undefined} />
        </section>
      )}

      {!page && <Launcher buttonRef={launcher} open={open} hidden={sheet} dot={!open && (!!greeting || chat.unread)} onClick={() => (open ? closePanel() : openPanel())} />}
    </>
  );
}

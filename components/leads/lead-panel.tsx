"use client";

import { ArrowLeft, ExternalLink, Mail, MessageCircle, Phone } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { changeStatus, loadLead, saveNotes } from "@/app/dashboard/leads/actions";
import { Badge, Button, Select, Textarea, useToast } from "@/components/ui";
import { cn } from "@/lib/cn";
import { LEAD_STATUSES, STATUS_LABELS, sourceLabel, type LeadStatusValue } from "@/lib/leads/filters";
import { telLink, whatsappLink } from "@/lib/leads/normalize";
import { STATUS_TONE, timeAgo, type InboxLead } from "./format";

type Message = { id: string; role: string; content: string; createdAt: string };

function ContactButton({ href, icon, children, external }: { href: string; icon: React.ReactNode; children: React.ReactNode; external?: boolean }) {
  return (
    <Button href={href} variant="outline" size="sm" leading={icon} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
      {children}
    </Button>
  );
}

/** One lead: contact buttons, status, notes (saved as you type) and the whole chat. Read-only (no status, no notes) without website chat in the plan. */
export function LeadPanel({ lead, readOnly = false, onClose, onStatus }: { lead: InboxLead; readOnly?: boolean; onClose: () => void; onStatus: (id: string, status: LeadStatusValue) => void }) {
  const { toast } = useToast();
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [notes, setNotes] = useState(lead.notes ?? "");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const lastSaved = useRef(lead.notes ?? "");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notesRef = useRef(lead.notes ?? "");
  const changeNotes = (value: string) => {
    notesRef.current = value;
    setNotes(value);
  };

  useEffect(() => {
    let cancelled = false;
    void loadLead(lead.id).then((result) => {
      if (cancelled) return;
      if (result.ok) setMessages(result.lead.session?.messages.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() })) ?? []);
      else setLoadError(true);
    });
    return () => {
      cancelled = true;
    };
  }, [lead.id]);

  async function flush() {
    const value = notesRef.current;
    if (value === lastSaved.current) return;
    setSaveState("saving");
    const result = await saveNotes(lead.id, value);
    if (result.ok) {
      lastSaved.current = value;
      setSaveState(notesRef.current === value ? "saved" : "saving");
    } else {
      setSaveState("error");
    }
  }

  // Save a moment after the last keystroke, and once more when the panel closes.
  useEffect(() => {
    if (notes === lastSaved.current) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 800);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes]);
  useEffect(
    () => () => {
      if (!readOnly && notesRef.current !== lastSaved.current) void saveNotes(lead.id, notesRef.current);
    },
    [lead.id, readOnly],
  );

  async function setStatus(status: LeadStatusValue) {
    const previous = lead.status;
    onStatus(lead.id, status);
    const result = await changeStatus([lead.id], status);
    if (!result.ok) {
      onStatus(lead.id, previous);
      toast(result.error, "error");
    }
  }

  const tel = telLink(lead.phone);
  const wa = whatsappLink(lead.phone);
  const title = lead.name || lead.email || lead.phone || "Visitor";

  return (
    <div className="flex h-full flex-col gap-5">
      <div className="flex items-start gap-2">
        <button
          type="button"
          onClick={onClose}
          aria-label="Back to leads"
          className="-ml-2 inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted hover:bg-soft hover:text-text lg:hidden"
        >
          <ArrowLeft aria-hidden className="size-5" />
        </button>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 className="truncate text-xl font-semibold tracking-[-0.02em]">{title}</h2>
          <p className="text-[13px] text-muted">
            <span suppressHydrationWarning>{timeAgo(lead.createdAt)}</span> · {sourceLabel(lead.source)}
          </p>
        </div>
        <Badge tone={STATUS_TONE[lead.status]}>{STATUS_LABELS[lead.status]}</Badge>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="hidden size-11 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted hover:bg-soft hover:text-text lg:inline-flex"
        >
          ✕
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {tel && <ContactButton href={tel} icon={<Phone aria-hidden className="size-4" />}>Call</ContactButton>}
        {wa && (
          <ContactButton href={wa} external icon={<MessageCircle aria-hidden className="size-4" />}>
            WhatsApp
          </ContactButton>
        )}
        {lead.email && <ContactButton href={`mailto:${lead.email}`} icon={<Mail aria-hidden className="size-4" />}>Email</ContactButton>}
        {!tel && !lead.email && <p className="text-[14px] text-muted">The visitor did not leave contact details.</p>}
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[14px]">
        {lead.email && (<><dt className="text-muted">Email</dt><dd className="min-w-0 break-words">{lead.email}</dd></>)}
        {lead.phone && (<><dt className="text-muted">Phone</dt><dd>{lead.phone}</dd></>)}
        {lead.interest && (<><dt className="text-muted">Interest</dt><dd className="min-w-0 break-words">{lead.interest}</dd></>)}
        {lead.message && (<><dt className="text-muted">Message</dt><dd className="min-w-0 break-words whitespace-pre-wrap">{lead.message}</dd></>)}
        {lead.pageUrl && (
          <>
            <dt className="text-muted">Page</dt>
            <dd className="min-w-0">
              <a href={lead.pageUrl} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full items-center gap-1 text-pulse-blue hover:underline">
                <span className="truncate">{lead.pageUrl.replace(/^https?:\/\//, "")}</span>
                <ExternalLink aria-hidden className="size-3.5 shrink-0" />
              </a>
            </dd>
          </>
        )}
      </dl>

      {readOnly ? (
        lead.notes && (
          <div className="flex flex-col gap-1.5">
            <h3 className="text-[14px] font-medium">Notes</h3>
            <p className="text-[14px] whitespace-pre-wrap">{lead.notes}</p>
          </div>
        )
      ) : (
        <>
          <label className="flex flex-col gap-1.5 text-[14px] font-medium">
            Status
            <Select value={lead.status} onChange={(e) => void setStatus(e.target.value as LeadStatusValue)}>
              {LEAD_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </Select>
          </label>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <label htmlFor={`notes-${lead.id}`} className="text-[14px] font-medium">
                Notes
              </label>
              <span role="status" className={cn("text-[12px]", saveState === "error" ? "text-danger" : "text-muted")}>
                {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : saveState === "error" ? "Not saved. Retrying on your next edit." : ""}
              </span>
            </div>
            <Textarea id={`notes-${lead.id}`} rows={4} maxLength={5000} value={notes} onChange={(e) => changeNotes(e.target.value)} onBlur={() => void flush()} placeholder="Called on Monday, wants a quote…" />
          </div>
        </>
      )}

      <section aria-label="Chat" className="flex flex-col gap-2">
        <h3 className="text-[14px] font-medium">Chat</h3>
        {loadError ? (
          <p className="text-[14px] text-danger">Could not load the chat. Close this and try again.</p>
        ) : messages === null ? (
          <p className="text-[14px] text-muted">Loading…</p>
        ) : messages.length === 0 ? (
          <p className="text-[14px] text-muted">No chat saved for this lead.</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {messages.map((m) => (
              <li key={m.id} className={cn("flex", m.role === "visitor" ? "justify-end" : "justify-start")}>
                <p
                  className={cn(
                    "max-w-[85%] rounded-2xl px-3.5 py-2 text-[14px] break-words whitespace-pre-wrap",
                    m.role === "visitor" ? "bg-brand-gradient text-white" : m.role === "system" ? "bg-soft text-muted italic" : "bg-soft text-text",
                  )}
                >
                  {m.content}
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

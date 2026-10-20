"use client";

import { ArrowLeft, Merge } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { merge, saveContact } from "@/app/dashboard/contacts/actions";
import { tagContact } from "@/app/dashboard/inbox/actions";
import { Badge, Button, Field, GlassCard, Input, Select, useToast } from "@/components/ui";
import { timeAgo } from "@/components/leads/format";
import { CHANNEL_LABELS } from "@/lib/inbox/labels";
import type { ContactDetail as Detail, ContactRow } from "@/lib/contacts/service";

type FieldDef = { id: string; key: string; label: string; type: string; options: string[] };

const RUN_LABEL: Record<string, string> = { RUNNING: "Running", WAITING: "Waiting", DONE: "Finished", STOPPED: "Stopped", FAILED: "Failed" };

export function ContactDetail({ contact, fields, similar, canManage }: { contact: Detail; fields: FieldDef[]; similar: ContactRow[]; canManage: boolean }) {
  const router = useRouter();
  const { toast } = useToast();
  const [form, setForm] = useState({ name: contact.name, email: contact.email, phone: contact.phone, emailOptIn: contact.emailOptIn, fields: contact.fields });
  const [busy, setBusy] = useState(false);
  const [tag, setTag] = useState("");

  async function save() {
    setBusy(true);
    const r = await saveContact(contact.id, form);
    setBusy(false);
    if (!r.ok) return toast(r.error, "error");
    toast("Contact saved.", "success");
    router.refresh();
  }

  async function changeTag(name: string, add: boolean) {
    const r = await tagContact(contact.id, name, add);
    if (!r.ok) return toast(r.error, "error");
    setTag("");
    router.refresh();
  }

  async function mergeWith(otherId: string, name: string) {
    if (!window.confirm(`Merge ${name} into ${contact.title}? Their conversations, leads and tags move here.`)) return;
    setBusy(true);
    const r = await merge(contact.id, otherId);
    setBusy(false);
    if (!r.ok) return toast(r.error, "error");
    toast("Contacts merged.", "success");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3 px-1">
        <Link href="/dashboard/contacts" className="flex size-9 items-center justify-center rounded-full hover:bg-soft" aria-label="Back to contacts">
          <ArrowLeft className="size-5" aria-hidden />
        </Link>
        <div className="min-w-0">
          <h1 className="truncate text-[26px] font-semibold tracking-[-0.03em]">{contact.title}</h1>
          <p className="text-[14px] text-muted">
            First seen {timeAgo(contact.createdAt)} · last message {timeAgo(contact.lastSeenAt)}
            {contact.language ? ` · writes in ${contact.language}` : ""}
          </p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <GlassCard className="flex flex-col gap-4">
          <h2 className="text-[17px] font-semibold">Details</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name">
              <Input value={form.name} maxLength={120} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="Phone">
              <Input value={form.phone} maxLength={40} inputMode="tel" onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </Field>
            <Field label="Email">
              <Input value={form.email} maxLength={200} type="email" onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </Field>
            {fields.map((f) => (
              <Field key={f.id} label={f.label}>
                {f.type === "choice" || f.type === "yes_no" ? (
                  <Select value={form.fields[f.key] ?? ""} onChange={(e) => setForm({ ...form, fields: { ...form.fields, [f.key]: e.target.value } })}>
                    <option value="">Not set</option>
                    {(f.type === "yes_no" ? ["Yes", "No"] : f.options).map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <Input type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"} value={form.fields[f.key] ?? ""} maxLength={500} onChange={(e) => setForm({ ...form, fields: { ...form.fields, [f.key]: e.target.value } })} />
                )}
              </Field>
            ))}
          </div>
          <label className="flex items-start gap-2 text-[14px]">
            <input type="checkbox" className="mt-1" checked={form.emailOptIn} onChange={(e) => setForm({ ...form, emailOptIn: e.target.checked })} />
            <span>
              Agreed to receive news by email
              {contact.unsubscribed && <span className="block text-[13px] text-muted">They asked to stop messages before; only tick this if they agreed again.</span>}
            </span>
          </label>
          <div>
            <Button onClick={save} disabled={busy}>
              Save
            </Button>
          </div>
        </GlassCard>

        <div className="flex flex-col gap-4">
          <GlassCard padding="sm" className="flex flex-col gap-2">
            <h2 className="text-[15px] font-semibold">Tags</h2>
            <div className="flex flex-wrap gap-1.5">
              {contact.tags.map((t) => (
                <button key={t} type="button" onClick={() => changeTag(t, false)} className="rounded-full bg-soft px-2.5 py-1 text-[13px] hover:line-through" aria-label={`Remove tag ${t}`}>
                  {t} ×
                </button>
              ))}
              {!contact.tags.length && <span className="text-[13px] text-muted">No tags.</span>}
            </div>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (tag.trim()) void changeTag(tag.trim(), true);
              }}
            >
              <Input value={tag} onChange={(e) => setTag(e.target.value)} maxLength={40} placeholder="Add a tag" aria-label="Add a tag" />
              <Button size="sm" type="submit" disabled={!tag.trim()}>
                Add
              </Button>
            </form>
          </GlassCard>

          <GlassCard padding="sm" className="flex flex-col gap-2">
            <h2 className="text-[15px] font-semibold">Channels</h2>
            {contact.identities.map((i, n) => (
              <p key={n} className="text-[14px]">
                {CHANNEL_LABELS[i.channel]}
                {i.handle ? <span className="text-muted"> · @{i.handle.replace(/^@/, "")}</span> : null}
              </p>
            ))}
            {!contact.identities.length && <p className="text-[13px] text-muted">Added by hand or imported.</p>}
          </GlassCard>

          <GlassCard padding="sm" className="flex flex-col gap-2">
            <h2 className="text-[15px] font-semibold">Conversations</h2>
            {contact.conversations.map((c) => (
              <Link key={c.id} href={`/dashboard/inbox?c=${c.id}`} className="flex flex-col rounded-xl p-2 hover:bg-soft">
                <span className="flex items-center gap-2 text-[13px]">
                  <Badge tone="neutral">{CHANNEL_LABELS[c.channel]}</Badge>
                  <span className="ml-auto text-muted">{timeAgo(c.lastMessageAt)}</span>
                </span>
                <span className="truncate text-[13px] text-muted">{c.preview}</span>
              </Link>
            ))}
            {!contact.conversations.length && <p className="text-[13px] text-muted">None yet.</p>}
          </GlassCard>

          {(contact.leads.length > 0 || contact.runs.length > 0) && (
            <GlassCard padding="sm" className="flex flex-col gap-2">
              <h2 className="text-[15px] font-semibold">Leads and automations</h2>
              {contact.leads.map((l) => (
                <Link key={l.id} href={`/dashboard/leads?lead=${l.id}`} className="text-[13px] hover:underline">
                  Lead: {l.interest || "no interest given"} · {l.status.toLowerCase()} · {timeAgo(l.createdAt)}
                </Link>
              ))}
              {contact.runs.map((r) => (
                <Link key={r.id} href={`/dashboard/automations/${r.automation.id}`} className="text-[13px] hover:underline">
                  {r.automation.name} · {RUN_LABEL[r.status] ?? r.status} · {timeAgo(r.startedAt)}
                </Link>
              ))}
            </GlassCard>
          )}

          {canManage && similar.length > 0 && (
            <GlassCard padding="sm" className="flex flex-col gap-2">
              <h2 className="text-[15px] font-semibold">Same person?</h2>
              <p className="text-[13px] text-muted">These contacts have a similar name. Merging keeps one contact with everything from both.</p>
              {similar.map((s) => (
                <div key={s.id} className="flex items-center gap-2 text-[13px]">
                  <Link href={`/dashboard/contacts/${s.id}`} className="flex-1 truncate hover:underline">
                    {s.name} {s.phone || s.email ? <span className="text-muted">· {s.phone || s.email}</span> : null}
                  </Link>
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => mergeWith(s.id, s.name)}>
                    <Merge className="size-4" aria-hidden /> Merge here
                  </Button>
                </div>
              ))}
            </GlassCard>
          )}
        </div>
      </div>
    </div>
  );
}

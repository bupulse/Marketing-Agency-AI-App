"use client";

import { Download, Search, Tag, Trash2, Upload } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { addField, bulkTag, changeTag, importContacts, removeContacts, removeField } from "@/app/dashboard/contacts/actions";
import { Badge, Button, Dialog, GlassCard, Input, Select, useToast } from "@/components/ui";
import { timeAgo } from "@/components/leads/format";
import { cn } from "@/lib/cn";
import { CHANNEL_LABELS, type ChannelKindValue } from "@/lib/inbox/labels";
import type { ContactRow } from "@/lib/contacts/service";

type Props = {
  contacts: ContactRow[];
  total: number;
  hasMore: boolean;
  q: string;
  tag: string | null;
  channel: ChannelKindValue | null;
  tags: { id: string; name: string; count: number }[];
  fields: { id: string; key: string; label: string; type: string; options: string[] }[];
  canManage: boolean;
};

const FIELD_TYPE_LABELS: Record<string, string> = { text: "Text", number: "Number", date: "Date", choice: "Choice", yes_no: "Yes or no" };

export function ContactsList({ contacts, total, hasMore, q, tag, channel, tags, fields, canManage }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { toast } = useToast();
  const [, startNav] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState(q);
  const [busy, setBusy] = useState(false);
  const [tagName, setTagName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [manage, setManage] = useState(false);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function navigate(next: Record<string, string | null>) {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v) sp.set(k, v);
      else sp.delete(k);
    }
    setSelected(new Set());
    startNav(() => router.replace(`${pathname}${sp.size ? `?${sp}` : ""}`, { scroll: false }));
  }

  function onSearch(value: string) {
    setQuery(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => navigate({ q: value.trim() || null }), 350);
  }

  function toggle(id: string) {
    setSelected((cur) => {
      const next = new Set(cur);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  async function applyTag(add: boolean) {
    if (!tagName.trim()) return toast("Type the tag first.", "error");
    setBusy(true);
    const r = await bulkTag([...selected], tagName.trim(), add);
    setBusy(false);
    if (!r.ok) return toast(r.error, "error");
    toast(add ? `Tag added to ${r.changed} ${r.changed === 1 ? "contact" : "contacts"}.` : `Tag removed from ${r.changed} ${r.changed === 1 ? "contact" : "contacts"}.`, "success");
    setSelected(new Set());
    setTagName("");
    router.refresh();
  }

  async function doDelete() {
    setBusy(true);
    const r = await removeContacts([...selected]);
    setBusy(false);
    setConfirmDelete(false);
    if (!r.ok) return toast(r.error, "error");
    toast(`${r.deleted} ${r.deleted === 1 ? "contact" : "contacts"} deleted.`, "success");
    setSelected(new Set());
    router.refresh();
  }

  async function onImport(file: File) {
    if (file.size > 2_000_000) return toast("The file is too large. Import up to 5,000 contacts (2 MB) at a time.", "error");
    setBusy(true);
    const r = await importContacts(await file.text());
    setBusy(false);
    if (fileInput.current) fileInput.current.value = "";
    if (!r.ok) return toast(r.error, "error");
    toast(`Imported: ${r.created} new, ${r.updated} updated${r.skipped ? `, ${r.skipped} skipped (no email or phone)` : ""}.`, "success");
    router.refresh();
  }

  const exportQuery = new URLSearchParams(Object.entries({ q, tag, channel }).filter(([, v]) => v) as [string, string][]).toString();
  const allSelected = contacts.length > 0 && contacts.every((c) => selected.has(c.id));

  return (
    <div className="flex flex-col gap-4">
      <GlassCard padding="sm" className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          <div className="relative min-w-[220px] flex-1">
            <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <Input value={query} onChange={(e) => onSearch(e.target.value)} placeholder="Search name, email, phone or @handle" aria-label="Search contacts" className="pl-9" />
          </div>
          <Select aria-label="Tag" value={tag ?? ""} onChange={(e) => navigate({ tag: e.target.value || null })} className="w-44">
            <option value="">All tags</option>
            {tags.map((t) => (
              <option key={t.id} value={t.name}>
                {t.name} ({t.count})
              </option>
            ))}
          </Select>
          <Select aria-label="Channel" value={channel ?? ""} onChange={(e) => navigate({ channel: e.target.value || null })} className="w-40">
            <option value="">All channels</option>
            {(["WEBSITE", "INSTAGRAM", "FACEBOOK", "WHATSAPP"] as ChannelKindValue[]).map((c) => (
              <option key={c} value={c}>
                {CHANNEL_LABELS[c]}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted">
          <span>
            {total} {total === 1 ? "contact" : "contacts"}
          </span>
          <span className="ml-auto flex flex-wrap gap-2">
            <Button size="sm" variant="outline" href={`/api/contacts/export${exportQuery ? `?${exportQuery}` : ""}`}>
              <Download className="size-4" aria-hidden /> Export CSV
            </Button>
            {canManage && (
              <>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => fileInput.current?.click()}>
                  <Upload className="size-4" aria-hidden /> Import CSV
                </Button>
                <input ref={fileInput} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && void onImport(e.target.files[0])} />
                <Button size="sm" variant="outline" onClick={() => setManage(true)}>
                  <Tag className="size-4" aria-hidden /> Tags and fields
                </Button>
              </>
            )}
          </span>
        </div>
        {selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-soft p-2">
            <span className="px-1 text-[13px] font-medium">{selected.size} selected</span>
            <Input value={tagName} onChange={(e) => setTagName(e.target.value)} maxLength={40} placeholder="Tag" aria-label="Tag to add or remove" className="w-40" list="contact-tags" />
            <datalist id="contact-tags">
              {tags.map((t) => (
                <option key={t.id} value={t.name} />
              ))}
            </datalist>
            <Button size="sm" disabled={busy} onClick={() => applyTag(true)}>
              Add tag
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => applyTag(false)}>
              Remove tag
            </Button>
            {canManage && (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => setConfirmDelete(true)} className="ml-auto text-red-600">
                <Trash2 className="size-4" aria-hidden /> Delete
              </Button>
            )}
          </div>
        )}
      </GlassCard>

      <GlassCard padding="none" className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-[14px]">
          <thead className="text-[12px] uppercase tracking-wide text-muted">
            <tr className="border-b border-line">
              <th className="w-10 px-4 py-3">
                <input type="checkbox" aria-label="Select all" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(contacts.map((c) => c.id)))} />
              </th>
              <th className="px-2 py-3 font-semibold">Name</th>
              <th className="px-2 py-3 font-semibold">Contact</th>
              <th className="px-2 py-3 font-semibold">Channels</th>
              <th className="px-2 py-3 font-semibold">Tags</th>
              <th className="px-4 py-3 text-right font-semibold">Last message</th>
            </tr>
          </thead>
          <tbody>
            {contacts.length === 0 && (
              <tr>
                <td colSpan={6} className="p-6 text-center text-muted">
                  {q || tag || channel ? "No contact matches." : "No contacts yet. They appear as people write to you."}
                </td>
              </tr>
            )}
            {contacts.map((c) => (
              <tr key={c.id} className={cn("border-b border-line last:border-0 hover:bg-soft", selected.has(c.id) && "bg-soft")}>
                <td className="px-4 py-2.5">
                  <input type="checkbox" aria-label={`Select ${c.name}`} checked={selected.has(c.id)} onChange={() => toggle(c.id)} />
                </td>
                <td className="px-2 py-2.5">
                  <Link href={`/dashboard/contacts/${c.id}`} className="font-medium hover:underline">
                    {c.name}
                  </Link>
                </td>
                <td className="px-2 py-2.5 text-muted">{[c.phone, c.email].filter(Boolean).join(" · ") || "—"}</td>
                <td className="px-2 py-2.5">
                  <span className="flex flex-wrap gap-1">
                    {c.channels.map((ch) => (
                      <Badge key={ch} tone="neutral">
                        {CHANNEL_LABELS[ch]}
                      </Badge>
                    ))}
                  </span>
                </td>
                <td className="px-2 py-2.5">
                  <span className="flex flex-wrap gap-1">
                    {c.tags.slice(0, 4).map((t) => (
                      <Badge key={t} tone="violet">
                        {t}
                      </Badge>
                    ))}
                    {c.tags.length > 4 && <span className="text-[12px] text-muted">+{c.tags.length - 4}</span>}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-right text-muted">{timeAgo(c.lastSeenAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {hasMore && (
          <div className="border-t border-line p-3 text-center">
            <Button size="sm" variant="outline" onClick={() => navigate({ limit: String(contacts.length + 50) })}>
              Show more
            </Button>
          </div>
        )}
      </GlassCard>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete} title={`Delete ${selected.size} ${selected.size === 1 ? "contact" : "contacts"}?`}>
        <p className="text-[14px] text-muted">Their conversations and automation history are deleted too. Leads stay in Leads. This cannot be undone.</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => setConfirmDelete(false)}>
            Cancel
          </Button>
          <Button size="sm" disabled={busy} onClick={doDelete}>
            Delete
          </Button>
        </div>
      </Dialog>

      {manage && <ManageDialog tags={tags} fields={fields} onClose={() => setManage(false)} />}
    </div>
  );
}

function ManageDialog({ tags, fields, onClose }: { tags: Props["tags"]; fields: Props["fields"]; onClose: () => void }) {
  const router = useRouter();
  const { toast } = useToast();
  const [label, setLabel] = useState("");
  const [type, setType] = useState("text");
  const [options, setOptions] = useState("");
  const [busy, setBusy] = useState(false);

  async function run(p: Promise<{ ok: boolean; error?: string }>, done: string) {
    setBusy(true);
    const r = await p;
    setBusy(false);
    if (!r.ok) return toast(r.error ?? "Something went wrong.", "error");
    toast(done, "success");
    router.refresh();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Tags and fields">
      <div className="flex flex-col gap-5">
        <section className="flex flex-col gap-2">
          <h3 className="text-[14px] font-semibold">Contact fields</h3>
          <p className="text-[13px] text-muted">Details you want to keep for each contact, like their size, district or budget. Automations can ask for them and fill them in.</p>
          <ul className="flex flex-col gap-1">
            {fields.map((f) => (
              <li key={f.id} className="flex items-center gap-2 text-[14px]">
                <span className="flex-1">
                  {f.label} <span className="text-[12px] text-muted">({FIELD_TYPE_LABELS[f.type] ?? f.type}{f.options.length ? `: ${f.options.join(", ")}` : ""})</span>
                </span>
                <button type="button" className="text-[13px] text-red-600 hover:underline" disabled={busy} onClick={() => run(removeField(f.id), "Field deleted.")}>
                  Delete
                </button>
              </li>
            ))}
            {!fields.length && <li className="text-[13px] text-muted">No fields yet.</li>}
          </ul>
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void run(addField(label, type, options.split(",").map((o) => o.trim()).filter(Boolean)), "Field added.").then(() => {
                setLabel("");
                setOptions("");
              });
            }}
          >
            <Input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} placeholder="Field name, e.g. District" aria-label="Field name" className="min-w-[160px] flex-1" />
            <Select aria-label="Field type" value={type} onChange={(e) => setType(e.target.value)} className="w-32">
              {Object.entries(FIELD_TYPE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
            {type === "choice" && <Input value={options} onChange={(e) => setOptions(e.target.value)} placeholder="Options, separated by commas" aria-label="Options" className="min-w-[200px] flex-1" />}
            <Button size="sm" type="submit" disabled={busy || !label.trim()}>
              Add field
            </Button>
          </form>
        </section>
        <section className="flex flex-col gap-2">
          <h3 className="text-[14px] font-semibold">Tags</h3>
          <ul className="flex flex-col gap-1">
            {tags.map((t) => (
              <TagRow key={t.id} tag={t} busy={busy} onRename={(name) => run(changeTag(t.id, name), "Tag renamed.")} onDelete={() => run(changeTag(t.id, null), "Tag deleted.")} />
            ))}
            {!tags.length && <li className="text-[13px] text-muted">No tags yet. Add them to contacts from the list, the inbox or an automation.</li>}
          </ul>
        </section>
      </div>
    </Dialog>
  );
}

function TagRow({ tag, busy, onRename, onDelete }: { tag: { name: string; count: number }; busy: boolean; onRename: (name: string) => void; onDelete: () => void }) {
  const [name, setName] = useState(tag.name);
  return (
    <li className="flex items-center gap-2">
      <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} aria-label={`Rename ${tag.name}`} className="flex-1" />
      <span className="w-20 text-right text-[12px] text-muted">
        {tag.count} {tag.count === 1 ? "contact" : "contacts"}
      </span>
      <Button size="sm" variant="outline" disabled={busy || !name.trim() || name.trim() === tag.name} onClick={() => onRename(name.trim())}>
        Rename
      </Button>
      <button type="button" className="text-[13px] text-red-600 hover:underline" disabled={busy} onClick={onDelete}>
        Delete
      </button>
    </li>
  );
}

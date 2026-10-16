"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Mail, X } from "lucide-react";
import { Button, Dialog, Field, Input, Textarea, useToast } from "@/components/ui";
import { createPostsAction, updatePostAction } from "@/app/dashboard/calendar/actions";
import { cn } from "@/lib/cn";
import { MAX_MEDIA_PER_POST } from "@/lib/publishing/schemas";
import { addDays, dayKey, parseDayKey, toLocalInput, zonedTimeToUtc } from "@/lib/publishing/time";
import type { CalendarPost, ComposerAccount, ComposerContext, ComposerPrefill, MediaItem, Overrides, PostOutcome, When } from "@/lib/publishing/types";
import { formatFor, scriptExplanation, validatePost, type RuleSummary } from "@/lib/publishing/validate";
import type { Network } from "@/lib/social/types";
import { MediaAttach } from "./media-attach";
import { AccountAvatar, NetworkIcon, networkName } from "./network-icon";
import { PostPreview } from "./post-preview";

type Mode = "keep" | "queue" | "schedule" | "now";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  context: ComposerContext;
  /** Edits this post (its account is fixed) instead of creating new ones. */
  post?: CalendarPost;
  prefill?: ComposerPrefill;
  /** A day (YYYY-MM-DD) to pre-fill the schedule with, e.g. when started from a calendar day. */
  day?: string;
  onDone?: () => void;
};

const chip =
  "inline-flex min-h-11 cursor-pointer items-center rounded-full border px-3.5 text-sm font-semibold transition-colors sm:px-4";

function defaultLocal(zone: string, day?: string): string {
  const now = new Date();
  const key = day ?? addDays(dayKey(now, zone), 1);
  const { year, month, day: d } = parseDayKey(key);
  let at = zonedTimeToUtc(year, month, d, 9, 0, zone);
  if (at.getTime() <= now.getTime() + 5 * 60_000) at = new Date(now.getTime() + 60 * 60_000);
  return toLocalInput(at, zone);
}

function Counter({ length, limit }: { length: number; limit: number }) {
  const over = length > limit;
  return (
    <span className={cn("text-[13px] tabular-nums", over ? "font-semibold text-danger" : "text-muted")}>
      {length.toLocaleString("en-US")} / {limit.toLocaleString("en-US")}
    </span>
  );
}

function Hashtags({ tags, onChange, max }: { tags: string[]; onChange: (tags: string[]) => void; max?: number }) {
  const [draft, setDraft] = useState("");
  function commit() {
    const cleaned = draft.trim().replace(/^#+/, "").replace(/\s+/g, "");
    setDraft("");
    if (!cleaned) return;
    const tag = `#${cleaned}`;
    if (!tags.some((t) => t.toLowerCase() === tag.toLowerCase())) onChange([...tags, tag]);
  }
  return (
    <div className="flex flex-col gap-2">
      <Field label="Hashtags" hint={max ? `Press Enter to add. Up to ${max} on this network.` : "Press Enter to add. The # is added for you."}>
        <Input
          value={draft}
          placeholder="summerSale"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              commit();
            }
          }}
        />
      </Field>
      {tags.length > 0 && (
        <ul aria-label="Hashtags" className="flex flex-wrap gap-2">
          {tags.map((t) => (
            <li key={t} className="glass inline-flex min-h-10 items-center gap-1 rounded-full py-0.5 pr-1 pl-3.5 text-[14px]">
              {t}
              <button type="button" aria-label={`Remove ${t}`} onClick={() => onChange(tags.filter((x) => x !== t))} className="inline-flex size-8 cursor-pointer items-center justify-center rounded-full text-muted hover:bg-soft hover:text-text">
                <X aria-hidden className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function accountsOf(context: ComposerContext, ids: string[]): ComposerAccount[] {
  return ids.flatMap((id) => context.accounts.filter((a) => a.id === id));
}

/**
 * The account a post is edited for. A post for an app that is not connected (a reminder to post it yourself, or a
 * post whose account was removed) still has its app: its words can be changed and checked against that app's rules
 * without connecting anything.
 */
function postAccount(context: ComposerContext, post: CalendarPost): ComposerAccount {
  const connected = context.accounts.find((a) => a.id === post.connectionId);
  if (connected) return connected;
  const label = context.rules[post.network]?.label ?? networkName(post.network);
  return { id: "", network: post.network, label, displayName: post.connectionId ? post.accountName || label : label, avatarUrl: post.connectionId ? post.accountAvatar : null, accountType: null, notify: true, usable: Boolean(post.remindOnly) };
}

/** Scheduling a post whose app is not connected: what happens, and Channels, where a personal Instagram takes seconds. */
function ConnectNote({ network, remindOnly }: { network: Network; remindOnly: boolean }) {
  const name = networkName(network);
  return (
    <p className="text-[13px] text-muted">
      {remindOnly ? `${name} is not connected, so at its time you get a reminder to post it yourself. To have BuPulse post it for you, connect ${name}.` : `To schedule or post it, connect ${name} again.`}
      {network === "instagram" && " No business account? Add your Instagram as a personal account: it takes seconds, needs no Instagram login, and the reminder comes with the caption and pictures ready."}{" "}
      <Link href="/dashboard/connections" className="font-semibold text-pulse-blue">Open Channels</Link>
    </p>
  );
}

/** The post composer: pick accounts, write once, tune per network, attach photos, then queue, schedule, save or post. */
export function PostComposer(props: Props) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange} title={props.post ? "Edit post" : "Create post"} className="max-w-5xl">
      {props.open && <ComposerBody {...props} />}
    </Dialog>
  );
}

function ComposerBody({ onOpenChange, context, post, prefill, day, onDone }: Props) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const editing = Boolean(post);
  const zone = context.timezone;

  const usable = context.accounts.filter((a) => a.usable);
  const editedAccount = useMemo(() => (post ? postAccount(context, post) : null), [context, post]);
  const [accountIds, setAccountIds] = useState<string[]>(() => {
    if (post?.connectionId) return [post.connectionId];
    const wanted = (prefill?.connectionIds ?? []).filter((id) => usable.some((a) => a.id === id));
    return wanted.length ? wanted : usable.length === 1 ? [usable[0].id] : [];
  });
  const [text, setText] = useState(post?.text ?? prefill?.text ?? "");
  const [hashtags, setHashtags] = useState<string[]>(post?.hashtags ?? prefill?.hashtags ?? []);
  const [overrides, setOverrides] = useState<Overrides>(prefill?.overrides ?? {});
  const [media, setMedia] = useState<MediaItem[]>(post ? post.media : (prefill?.media ?? []));
  const [link, setLink] = useState(post?.link ?? "");
  const [tab, setTab] = useState<"main" | Network>("main");
  const [mode, setMode] = useState<Mode>(editing ? "keep" : "queue");
  const [local, setLocal] = useState(() => (post?.scheduledAt ? toLocalInput(new Date(post.scheduledAt), zone) : defaultLocal(zone, day)));
  const [error, setError] = useState<string | null>(null);

  const selected = useMemo(() => (editedAccount ? [editedAccount] : accountsOf(context, accountIds)), [context, accountIds, editedAccount]);
  const networks = useMemo(() => [...new Set(selected.map((a) => a.network))], [selected]);
  const activeTab = tab !== "main" && !networks.includes(tab) ? "main" : tab;

  const effective = (network: Network) => ({
    text: overrides[network]?.text ?? text,
    hashtags: overrides[network]?.hashtags ?? hashtags,
  });

  const checks = selected.flatMap((account) => {
    const rules = context.rules[account.network] as RuleSummary | undefined;
    if (!rules) return [];
    const values = effective(account.network);
    const format = formatFor(rules, media.length);
    return [{ account, rules, format, values, ...validatePost(rules, { format, ...values, mediaCount: media.length }) }];
  });
  const problems = checks.flatMap((c) => c.errors.map((e) => ({ network: c.account.network, message: e })));
  const hasContent = text.trim() !== "" || media.length > 0 || Object.values(overrides).some((o) => o?.text?.trim());

  function toggleAccount(id: string) {
    setAccountIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }

  function setOverride(network: Network, patch: { text?: string; hashtags?: string[] } | null) {
    setOverrides((cur) => {
      const next = { ...cur };
      if (patch === null) delete next[network];
      else next[network] = { ...next[network], ...patch };
      return next;
    });
  }

  function report(outcomes: PostOutcome[]) {
    const published = outcomes.filter((o) => o.status === "PUBLISHED");
    const reminders = outcomes.filter((o) => o.status === "NEEDS_ACTION");
    const failed = outcomes.filter((o) => o.status === "FAILED");
    const waiting = outcomes.filter((o) => o.status === "SCHEDULED" || o.status === "PUBLISHING");
    if (published.length) toast(`Published to ${published.map((o) => networkName(o.network)).join(", ")}.`, "success");
    if (reminders.length) toast(`We emailed you a reminder to post on ${reminders.map((o) => networkName(o.network)).join(", ")}.`, "success");
    for (const o of failed) toast(o.error?.startsWith(networkName(o.network)) ? o.error : `${networkName(o.network)}: ${o.error ?? "It could not be published."}`, "error");
    if (waiting.length) toast(`${waiting.map((o) => networkName(o.network)).join(", ")} will be retried automatically.`, "info");
  }

  function submit(chosen: "draft" | Mode) {
    setError(null);
    if (!editing && selected.length === 0) return setError("Choose at least one account.");
    if (chosen !== "draft" && problems.length > 0) return setError(problems[0].message);
    if (chosen === "draft" && !hasContent) return setError("Write something or add a photo to save a draft.");
    const createWhen: When =
      chosen === "draft" ? { mode: "draft" }
      : chosen === "schedule" ? { mode: "schedule", local }
      : chosen === "now" ? { mode: "now" }
      : { mode: "queue" };

    startTransition(async () => {
      const mediaPaths = media.map((m) => m.path);
      const res = post
        ? await updatePostAction(post.id, { text, hashtags, mediaPaths, link: link || null, when: chosen === "keep" ? { mode: "keep" } : createWhen })
        : await createPostsAction({ connectionIds: accountIds, text, hashtags, overrides, mediaPaths, link: link || null, subjectId: prefill?.subjectId, contentId: prefill?.contentId, when: createWhen });
      if (!res.ok) return setError(res.fieldErrors?.form ?? res.error);
      if (res.outcomes.length > 0) report(res.outcomes);
      else {
        const n = post ? 1 : selected.length;
        toast(
          chosen === "draft" ? "Draft saved." : editing ? "Changes saved." : chosen === "queue" ? `Added to your queue for ${n} ${n === 1 ? "account" : "accounts"}.` : `Scheduled for ${n} ${n === 1 ? "account" : "accounts"}.`,
          "success",
        );
      }
      router.refresh();
      onOpenChange(false);
      onDone?.();
    });
  }

  // A new post needs an account to go to. An existing one can always be edited: it already has its app.
  if (!editing && context.accounts.length === 0) {
    return (
      <div className="flex flex-col items-start gap-4 py-2">
        <p className="text-[15px] text-muted">Connect a social account first, then you can write and schedule posts for it.</p>
        <p className="text-[15px] text-muted">
          No business account? Add your Instagram as a personal account: it takes seconds and needs no Instagram login. At each post&apos;s time BuPulse reminds you, with the caption and pictures ready to post.
        </p>
        <Button href="/dashboard/connections">Connect an account or add Instagram</Button>
      </div>
    );
  }

  const showTabs = networks.length > 1;
  const visibleNetworks = activeTab === "main" ? networks : [activeTab];
  const primaryLabel =
    mode === "keep" ? "Save changes" : mode === "queue" ? "Add to queue" : mode === "schedule" ? (editing ? "Reschedule" : "Schedule post") : "Post now";

  const mainFields = (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <Field label={showTabs ? "Text for all accounts" : "Text"}>
          <Textarea rows={7} value={text} placeholder="What do you want to share?" onChange={(e) => setText(e.target.value)} />
        </Field>
        {!showTabs && checks[0] && (
          <div className="flex items-center justify-between gap-3">
            <span className="text-[13px] text-muted">{checks[0].format === "SCRIPT" ? "Video script" : networkName(checks[0].account.network)}</span>
            <Counter length={checks[0].length} limit={checks[0].limit} />
          </div>
        )}
      </div>
      <Hashtags tags={hashtags} onChange={setHashtags} />
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-semibold">Photos</legend>
        <MediaAttach media={media} onChange={setMedia} max={MAX_MEDIA_PER_POST} album={prefill?.album} />
      </fieldset>
      <Field label="Link (optional)" hint="Shown with the post where the network allows it." error={undefined}>
        <Input type="url" inputMode="url" value={link} placeholder="https://" onChange={(e) => setLink(e.target.value)} />
      </Field>
    </div>
  );

  function networkFields(network: Network) {
    const check = checks.find((c) => c.account.network === network);
    if (!check) return null;
    const custom = Boolean(overrides[network]);
    const script = check.format === "SCRIPT";
    return (
      <div className="flex flex-col gap-4">
        {script && <p className="flex gap-2 rounded-2xl bg-soft p-3.5 text-[14px] text-muted"><Mail aria-hidden className="mt-0.5 size-4 shrink-0" /> {scriptExplanation(check.rules.label)}</p>}
        {check.account.notify && !script && <p className="flex gap-2 rounded-2xl bg-soft p-3.5 text-[14px] text-muted"><Mail aria-hidden className="mt-0.5 size-4 shrink-0" /> This account is set to reminders, so we email you everything ready to post at the scheduled time.</p>}
        <div className="flex flex-col gap-1.5">
          <Field label={script ? `${check.rules.label} script` : `${check.rules.label} text`}>
            <Textarea rows={6} value={check.values.text} onChange={(e) => setOverride(network, { text: e.target.value })} />
          </Field>
          <div className="flex items-center justify-between gap-3">
            {custom ? (
              <button type="button" onClick={() => setOverride(network, null)} className="min-h-11 cursor-pointer text-[13px] font-semibold text-pulse-blue">
                Use the text for all accounts
              </button>
            ) : (
              <span className="text-[13px] text-muted">Same as all accounts. Edit to customise.</span>
            )}
            <Counter length={check.length} limit={check.limit} />
          </div>
        </div>
        <Hashtags tags={check.values.hashtags} onChange={(tags) => setOverride(network, { hashtags: tags })} max={check.rules.maxHashtags} />
        {check.errors.length > 0 && (
          <ul role="alert" className="flex flex-col gap-1 text-[13px] font-medium text-danger">
            {check.errors.map((e) => <li key={e}>{e}</li>)}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="flex min-w-0 flex-col gap-5">
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-semibold">{editing ? "Account" : "Post to"}</legend>
          {editing && post && !post.connectionId && post.remindOnly && (
            <p className="text-[14px] text-muted">{networkName(post.network)}: not connected. You can change every word now; at its time the post is sent to you as a reminder to post it yourself.</p>
          )}
          <ul className="flex flex-wrap gap-3">
            {(editedAccount ? [editedAccount] : context.accounts).map((a) => {
              const on = editedAccount !== null || accountIds.includes(a.id);
              return (
                <li key={a.id || a.network}>
                  <button
                    type="button"
                    disabled={!a.usable || editing}
                    aria-pressed={on}
                    aria-label={`${a.label}: ${a.displayName}${a.problem ? `. ${a.problem}` : ""}`}
                    title={a.problem ?? `${a.label}: ${a.displayName}`}
                    onClick={() => toggleAccount(a.id)}
                    className={cn("relative cursor-pointer rounded-full p-1 transition-[opacity,box-shadow] disabled:cursor-default", on ? "ring-2 ring-pulse-blue" : "opacity-60 hover:opacity-100", !a.usable && "opacity-30")}
                  >
                    <AccountAvatar network={a.network} name={a.displayName} src={a.avatarUrl} size={44} />
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="min-h-5 text-[13px] text-muted" aria-live="polite">
            {selected.length === 0 ? "Tap an account to post to it." : selected.map((a) => a.displayName).join(", ")}
          </p>
          {!editing && context.accounts.some((a) => !a.usable) && (
            <p className="text-[13px] text-muted">
              Greyed-out accounts need attention. <Link href="/dashboard/connections" className="font-semibold text-pulse-blue">Open Channels</Link>
            </p>
          )}
        </fieldset>

        {showTabs ? (
          <div className="flex flex-col gap-4">
            <div role="tablist" aria-label="Edit for each network" className="flex gap-1 overflow-x-auto p-1">
              {(["main", ...networks] as const).map((t) => {
                const on = activeTab === t;
                const bad = t !== "main" && checks.some((c) => c.account.network === t && c.errors.length > 0);
                return (
                  <button key={t} type="button" role="tab" aria-selected={on} onClick={() => setTab(t)} className={cn(chip, "shrink-0 gap-2", on ? "border-line bg-glass-strong text-text" : "border-transparent text-muted hover:text-text")}>
                    {t === "main" ? "All accounts" : <><NetworkIcon network={t} size={18} />{networkName(t)}</>}
                    {bad && <span aria-label="Needs attention" className="size-2 rounded-full bg-danger" />}
                  </button>
                );
              })}
            </div>
            {activeTab === "main" ? mainFields : networkFields(activeTab)}
          </div>
        ) : (
          <>
            {mainFields}
            {networks[0] && checks[0]?.format === "SCRIPT" && networkFields(networks[0])}
          </>
        )}

        {problems.length > 0 && hasContent && (
          <div role="status" className="flex gap-2.5 rounded-2xl bg-amber-500/15 p-3.5 text-[14px] text-amber-900 dark:text-amber-200">
            <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
            <ul className="flex flex-col gap-1">
              {[...new Set(problems.map((p) => `${networkName(p.network)}: ${p.message}`))].map((m) => <li key={m}>{m}</li>)}
            </ul>
          </div>
        )}
      </div>

      <aside aria-label="Previews" className="flex min-w-0 flex-col gap-3 lg:sticky lg:top-0 lg:self-start">
        <h3 className="text-sm font-semibold">Preview</h3>
        {selected.length === 0 ? (
          <p className="rounded-2xl bg-soft px-4 py-8 text-center text-[14px] text-muted">Pick an account to see how the post will look.</p>
        ) : (
          visibleNetworks.map((network) => {
            const account = selected.find((a) => a.network === network) as ComposerAccount;
            const check = checks.find((c) => c.account.network === network);
            return (
              <PostPreview
                key={network}
                network={network}
                accountName={account.displayName}
                avatarUrl={account.avatarUrl}
                text={check?.values.text ?? text}
                hashtags={check?.values.hashtags ?? hashtags}
                media={media}
                reminder={check?.format === "SCRIPT" || account.notify}
                needsMedia={Boolean(check?.rules.requiresMedia)}
              />
            );
          })
        )}
      </aside>

      <div className="sticky bottom-0 z-10 -mx-6 -mb-6 flex flex-col gap-3 border-t border-line bg-[var(--bp-bg-solid)] px-6 pt-4 pb-5 sm:-mx-8 sm:-mb-8 sm:px-8 sm:pb-6 lg:col-span-2">
        <div className="flex flex-wrap items-end gap-3">
          <div role="group" aria-label="When to post" className="flex flex-wrap gap-2">
            {(editing ? (["keep", "queue", "schedule", "now"] as const) : (["queue", "schedule", "now"] as const)).map((m) => (
              <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)} className={cn(chip, mode === m ? "border-transparent bg-brand-gradient text-white" : "border-line bg-glass text-text hover:bg-soft")}>
                {m === "keep" ? "Keep time" : m === "queue" ? "Add to queue" : m === "schedule" ? "Schedule" : "Post now"}
              </button>
            ))}
          </div>
          {mode === "schedule" && (
            <div className="flex flex-col gap-1">
              <label htmlFor="composer-when" className="text-[13px] font-medium text-muted">Date and time ({zone})</label>
              <input id="composer-when" type="datetime-local" value={local} onChange={(e) => setLocal(e.target.value)} className="min-h-11 rounded-[14px] border border-line bg-glass px-3 text-[15px] text-text" />
            </div>
          )}
        </div>
        <p className="text-[13px] text-muted">
          {mode === "queue" ? `Goes out at your next free posting time (${context.slotTimes.join(", ")}, ${zone}).`
            : mode === "now" ? "Sends it to the network straight away."
            : mode === "keep" ? "Saves your changes and leaves the time as it is."
            : `Times are in ${zone}.`}
          {context.timingNote && mode !== "now" && mode !== "keep" && ` ${context.timingNote}`}
        </p>
        {editing && post && editedAccount && !editedAccount.id && mode !== "keep" && <ConnectNote network={post.network} remindOnly={Boolean(post.remindOnly)} />}
        {error && <p role="alert" className="text-[14px] font-medium text-danger">{error}</p>}
        <div className="flex flex-wrap items-center justify-end gap-3">
          <Button variant="ghost" className="max-sm:hidden" onClick={() => onOpenChange(false)} disabled={pending}>Cancel</Button>
          {(!editing || post?.status !== "DRAFT") && <Button variant="outline" onClick={() => submit("draft")} disabled={pending}>Save draft</Button>}
          <Button onClick={() => submit(mode)} disabled={pending || (mode !== "keep" && problems.length > 0 && hasContent)} aria-busy={pending}>
            {pending ? "Working..." : primaryLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

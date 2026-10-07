"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { History, PenLine, Plus, RefreshCw, X } from "lucide-react";
import { Badge, Button, Chip, Field, GlassCard, Input, Tabs, Textarea, useToast } from "@/components/ui";
import { saveEditedContent } from "@/app/dashboard/projects/actions";
import { prefillFromContent } from "@/components/publishing/prefill";
import { ScheduleButton } from "@/components/publishing/schedule-button";
import { CopyButton } from "./copy-button";
import { GenerateProgress } from "./generate-progress";
import { NetworkPreviews } from "./network-previews";
import { useGenerate } from "./use-generate";
import { REGENERATE_IDEAS, addHashtag, formatCopyText, formatWhenWithTime, usageNote, type StudioContent } from "./helpers";

const MAX_HEADLINES = 5;

type Draft = { caption: string; hashtags: string[]; videoScript: string; headlines: string[] };

function draftFrom(c: StudioContent): Draft {
  return { caption: c.caption, hashtags: c.hashtags, videoScript: c.videoScript, headlines: c.adHeadlines.length ? c.adHeadlines : [""] };
}

function Meta({ content }: { content: StudioContent }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge tone={content.edited ? "violet" : "blue"}>{content.edited ? "Edited" : "AI"}</Badge>
      <Badge tone="neutral">{content.language}</Badge>
      <time dateTime={content.createdAt} suppressHydrationWarning className="text-[13px] text-muted">
        {formatWhenWithTime(content.createdAt)}
      </time>
    </div>
  );
}

function Editor({ draft, onChange, errors }: { draft: Draft; onChange: (d: Draft) => void; errors: Record<string, string> }) {
  const [tag, setTag] = useState("");

  function commitTag() {
    onChange({ ...draft, hashtags: addHashtag(draft.hashtags, tag) });
    setTag("");
  }

  return (
    <div className="flex flex-col gap-5">
      <Field label="Caption" error={errors.caption}>
        <Textarea rows={6} value={draft.caption} onChange={(e) => onChange({ ...draft, caption: e.target.value })} />
      </Field>

      <div className="flex flex-col gap-2">
        <Field label="Hashtags" hint="Press Enter to add. The # is added for you." error={errors.hashtags}>
          <Input value={tag} placeholder="summerSale" onChange={(e) => setTag(e.target.value)} onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitTag();
            }
          }} />
        </Field>
        {draft.hashtags.length > 0 && (
          <ul aria-label="Hashtags" className="flex flex-wrap gap-2">
            {draft.hashtags.map((h) => (
              <li key={h} className="glass inline-flex min-h-11 items-center gap-1 rounded-full py-1 pr-1 pl-4 text-[15px]">
                {h}
                <button
                  type="button"
                  aria-label={`Remove ${h}`}
                  onClick={() => onChange({ ...draft, hashtags: draft.hashtags.filter((x) => x !== h) })}
                  className="inline-flex size-9 cursor-pointer items-center justify-center rounded-full text-muted hover:bg-soft hover:text-text"
                >
                  <X aria-hidden className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Field label="Video script (30 seconds)" error={errors.videoScript}>
        <Textarea rows={8} value={draft.videoScript} onChange={(e) => onChange({ ...draft, videoScript: e.target.value })} />
      </Field>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-[13px] font-medium text-muted">Ad headlines</legend>
        {draft.headlines.map((h, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input
              aria-label={`Headline ${i + 1}`}
              value={h}
              maxLength={100}
              onChange={(e) => onChange({ ...draft, headlines: draft.headlines.map((x, j) => (j === i ? e.target.value : x)) })}
            />
            <Button
              variant="outline"
              size="sm"
              aria-label={`Remove headline ${i + 1}`}
              onClick={() => onChange({ ...draft, headlines: draft.headlines.filter((_, j) => j !== i) })}
            >
              <X aria-hidden className="size-4" />
            </Button>
          </div>
        ))}
        {draft.headlines.length < MAX_HEADLINES && (
          <Button variant="ghost" size="sm" className="self-start" leading={<Plus aria-hidden className="size-4" />} onClick={() => onChange({ ...draft, headlines: [...draft.headlines, ""] })}>
            Add a headline
          </Button>
        )}
        {errors.adHeadlines && (
          <p role="alert" className="text-[13px] font-medium text-danger">
            {errors.adHeadlines}
          </p>
        )}
      </fieldset>
    </div>
  );
}

function Viewer({ content }: { content: StudioContent }) {
  return (
    <Tabs
      label="Content"
      items={[
        {
          value: "caption",
          label: "Caption & hashtags",
          content: (
            <div className="flex flex-col gap-4">
              <div className="rounded-2xl bg-soft p-4">
                <p className="whitespace-pre-wrap break-words text-[15px]">{content.caption}</p>
                {content.hashtags.length > 0 && <p className="mt-3 break-words text-[15px] font-medium text-pulse-blue">{content.hashtags.join(" ")}</p>}
              </div>
              <div>
                <CopyButton text={formatCopyText(content.caption, content.hashtags)} label="Copy caption and hashtags" />
              </div>
            </div>
          ),
        },
        {
          value: "script",
          label: "Video script",
          content: (
            <div className="flex flex-col gap-4">
              <p className="whitespace-pre-wrap break-words rounded-2xl bg-soft p-4 text-[15px]">{content.videoScript || "No script written."}</p>
              <div>
                <CopyButton text={content.videoScript} label="Copy script" />
              </div>
            </div>
          ),
        },
        {
          value: "headlines",
          label: "Ad headlines",
          content: (
            <ul className="flex flex-col gap-2">
              {content.adHeadlines.length === 0 && <li className="text-[15px] text-muted">No headlines written.</li>}
              {content.adHeadlines.map((h, i) => (
                <li key={`${i}-${h}`} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-soft p-4">
                  <span className="min-w-0 flex-1 break-words text-[15px] font-medium">{h}</span>
                  <CopyButton text={h} ariaLabel={`Copy headline ${i + 1}`} />
                </li>
              ))}
            </ul>
          ),
        },
      ]}
    />
  );
}

/** The project's written content: view, edit, regenerate, network previews and version history. */
export function ContentCard({
  projectId,
  contents,
  used,
  limit,
  photos,
}: {
  projectId: string;
  /** The project's photos, offered with the post when scheduling. */
  photos?: { path: string; url: string }[];
  /** Newest first. */
  contents: StudioContent[];
  used?: number;
  limit?: number;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [viewingId, setViewingId] = useState(contents[0].id);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => draftFrom(contents[0]));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, startSave] = useTransition();
  const [instruction, setInstruction] = useState("");

  const latest = contents[0];
  const viewing = contents.find((c) => c.id === viewingId) ?? latest;
  const isLatest = viewing.id === latest.id;

  const { run, pending: generating, dialog } = useGenerate(projectId, {
    limit,
    onDone: (id) => {
      setViewingId(id);
      setEditing(false);
      setInstruction("");
    },
  });

  function view(id: string) {
    setViewingId(id);
    setEditing(false);
    setErrors({});
  }

  function startEdit() {
    setDraft(draftFrom(viewing));
    setErrors({});
    setEditing(true);
  }

  // Saving never overwrites: it keeps the text you started from and adds a new "Edited" version.
  function save() {
    startSave(async () => {
      const result = await saveEditedContent(viewing.id, {
        caption: draft.caption.trim(),
        hashtags: draft.hashtags,
        videoScript: draft.videoScript.trim(),
        adHeadlines: draft.headlines.map((h) => h.trim()).filter(Boolean),
      });
      if (result.ok) {
        setViewingId(result.contentId);
        setEditing(false);
        router.refresh();
        toast("Your changes are saved as a new version.", "success");
        return;
      }
      setErrors((result.fieldErrors as Record<string, string> | undefined) ?? {});
      toast(result.error, "error");
    });
  }

  function useThisVersion() {
    startSave(async () => {
      const result = await saveEditedContent(viewing.id, {
        caption: viewing.caption,
        hashtags: viewing.hashtags,
        videoScript: viewing.videoScript,
        adHeadlines: viewing.adHeadlines,
      });
      if (result.ok) {
        setViewingId(result.contentId);
        router.refresh();
        toast("Saved as the newest version.", "success");
        return;
      }
      toast(result.error, "error");
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <GlassCard as="section" aria-labelledby="content-title" className="flex flex-col gap-4 p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-1.5">
            <h2 id="content-title" className="text-lg font-semibold tracking-[-0.02em]">
              {isLatest ? "Latest content" : "Earlier version"}
            </h2>
            <Meta content={viewing} />
          </div>
          {!editing && !generating && (
            <div className="flex flex-wrap gap-2">
              <ScheduleButton prefill={{ ...prefillFromContent(viewing, projectId), media: photos?.slice(0, 4) }} />
              <Button variant="ghost" size="sm" onClick={startEdit} leading={<PenLine aria-hidden className="size-4" />}>
                Edit
              </Button>
            </div>
          )}
        </div>

        {!isLatest && (
          <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-new-bg px-4 py-3 text-[14px] text-new">
            <span className="font-medium">You are looking at an older version.</span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => view(latest.id)}>
                Back to latest
              </Button>
              <Button size="sm" onClick={useThisVersion} disabled={saving}>
                {saving ? "Saving…" : "Use this version"}
              </Button>
            </div>
          </div>
        )}

        {generating ? (
          <GenerateProgress title="Rewriting your content" />
        ) : editing ? (
          <>
            <Editor draft={draft} onChange={setDraft} errors={errors} />
            <div className="flex flex-wrap gap-3">
              <Button onClick={save} disabled={saving}>
                {saving ? "Saving…" : "Save changes"}
              </Button>
              <Button variant="outline" onClick={() => setEditing(false)} disabled={saving}>
                Cancel
              </Button>
            </div>
          </>
        ) : (
          <Viewer content={viewing} />
        )}
      </GlassCard>

      <GlassCard as="section" aria-labelledby="networks-title" className="flex flex-col gap-3 p-5 sm:p-6">
        <div className="flex flex-col gap-1">
          <h2 id="networks-title" className="text-lg font-semibold tracking-[-0.02em]">
            Versions for each network
          </h2>
          <p className="text-[14px] text-muted">Length, hashtags and image shape set for each network.</p>
        </div>
        <NetworkPreviews variants={viewing.variants} />
      </GlassCard>

      <GlassCard as="section" aria-labelledby="regen-title" className="flex flex-col gap-4 p-5 sm:p-6">
        <div className="flex flex-col gap-1">
          <h2 id="regen-title" className="text-lg font-semibold tracking-[-0.02em]">
            Write it again
          </h2>
          <p className="text-[14px] text-muted">Your current text stays in the version history.</p>
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Quick ideas">
          {REGENERATE_IDEAS.map((idea) => (
            <Chip key={idea} selected={instruction === idea} onClick={() => setInstruction(instruction === idea ? "" : idea)} className="px-4 py-2">
              {idea}
            </Chip>
          ))}
        </div>
        <Field label="Or tell it what to change (optional)">
          <Textarea rows={2} maxLength={300} value={instruction} placeholder="For example: mention that we are open on Sundays" onChange={(e) => setInstruction(e.target.value)} />
        </Field>
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => run(instruction)} disabled={generating} leading={<RefreshCw aria-hidden className="size-4" />}>
            {generating ? "Writing…" : "Regenerate"}
          </Button>
          <span className="text-[13px] text-muted">{usageNote(used, limit)}</span>
        </div>
      </GlassCard>

      <GlassCard as="section" aria-labelledby="versions-title" className="flex flex-col gap-3 p-5 sm:p-6">
        <h2 id="versions-title" className="flex items-center gap-2 text-lg font-semibold tracking-[-0.02em]">
          <History aria-hidden className="size-5 text-pulse-blue" />
          Version history
        </h2>
        <ul className="flex flex-col">
          {contents.map((c, i) => {
            const current = c.id === viewing.id;
            return (
              <li key={c.id} className="flex flex-wrap items-center gap-3 rounded-2xl p-3 hover:bg-soft">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={c.edited ? "violet" : "blue"}>{c.edited ? "Edited" : "AI"}</Badge>
                    <Badge tone="neutral">{c.language}</Badge>
                    {i === 0 && <Badge tone="success">Latest</Badge>}
                    <time dateTime={c.createdAt} suppressHydrationWarning className="text-[13px] text-muted">
                      {formatWhenWithTime(c.createdAt)}
                    </time>
                  </div>
                  <p className="line-clamp-1 text-[14px] text-muted">{c.caption}</p>
                </div>
                <Button variant={current ? "outline" : "ghost"} size="sm" disabled={current} aria-label={`View version from ${formatWhenWithTime(c.createdAt)}`} onClick={() => view(c.id)}>
                  {current ? "Viewing" : "View"}
                </Button>
              </li>
            );
          })}
        </ul>
      </GlassCard>
      {dialog}
    </div>
  );
}

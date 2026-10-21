"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";
import { CircleCheck, ImagePlus, LoaderCircle, Trash2, TriangleAlert } from "lucide-react";
import { Button, Field, GlassCard, Input, Textarea } from "@/components/ui";
import { handInAction, startUploadsAction, type HandInState } from "@/app/creator/(portal)/actions";
import { listWords, NETWORK_LABEL, type CreatorNetwork } from "@/lib/creators/describe";
import { createClient } from "@/lib/supabase/client";

const BUCKET = "creator-media";

type Item = { key: string; name: string; status: "uploading" | "done" | "failed"; path?: string; error?: string; preview?: string };

const accept = (mediaKind: string) => (mediaKind === "VIDEO" ? "video/mp4,video/quicktime,video/webm" : mediaKind === "IMAGE" ? "image/jpeg,image/png,image/webp,image/heic" : "image/jpeg,image/png,image/webp,image/heic,video/mp4,video/quicktime,video/webm");

/** Files a phone may label vaguely (iPhone HEIC, MOV) get their type from the name. */
function typeOf(file: File): string {
  if (file.type) return file.type.toLowerCase();
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return ({ jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic", mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm" } as Record<string, string>)[ext] ?? "";
}

/**
 * Handing in a task for a day: the title, the caption, the files (uploaded straight to private Storage with a signed
 * token each) and the link of the post on each platform. After saving, the links are checked at once.
 */
export function HandInForm(props: {
  taskId: string;
  day: string;
  platforms: CreatorNetwork[];
  platformMode: string;
  mediaKind: string;
  notConnected: CreatorNetwork[];
  maxFiles: number;
  maxBytes: number;
  left: number;
}) {
  const { taskId, day, platforms, platformMode, mediaKind, notConnected, maxFiles, maxBytes, left } = props;
  const router = useRouter();
  const [state, action, pending] = useActionState<HandInState, FormData>(handInAction, { status: "idle" });
  const [items, setItems] = useState<Item[]>([]);
  const [pickError, setPickError] = useState<string | null>(null);
  // "Hand in another" puts the form back after a hand-in (the state of the last one stays until the next).
  const [dismissed, setDismissed] = useState<HandInState | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const uploading = items.some((i) => i.status === "uploading");

  useEffect(() => {
    if (state.status !== "done") return;
    setItems([]);
    formRef.current?.reset();
    router.refresh();
  }, [state, router]);

  async function onFiles(list: FileList | null) {
    setPickError(null);
    const files = [...(list ?? [])];
    if (!files.length) return;
    const room = maxFiles - items.filter((i) => i.status !== "failed").length;
    if (files.length > room) {
      setPickError(`Add up to ${maxFiles} files.`);
      return;
    }
    const tooBig = files.find((f) => f.size > maxBytes);
    if (tooBig) {
      setPickError(`${tooBig.name} is over ${Math.round(maxBytes / 1024 / 1024)} MB.`);
      return;
    }
    const added: Item[] = files.map((f) => ({ key: `${f.name}-${f.size}-${Math.random()}`, name: f.name, status: "uploading", preview: f.type.startsWith("image/") ? URL.createObjectURL(f) : undefined }));
    setItems((now) => [...now, ...added]);
    const update = (key: string, patch: Partial<Item>) => setItems((now) => now.map((i) => (i.key === key ? { ...i, ...patch } : i)));
    const started = await startUploadsAction(taskId, files.map((f) => ({ name: f.name, type: typeOf(f), size: f.size })));
    if (!started.ok) {
      added.forEach((a) => update(a.key, { status: "failed", error: started.error }));
      return;
    }
    const storage = createClient().storage.from(BUCKET);
    await Promise.all(
      files.map(async (file, i) => {
        const target = started.targets[i];
        if (!target?.ok) return update(added[i].key, { status: "failed", error: target?.error ?? "Could not start." });
        const { error } = await storage.uploadToSignedUrl(target.path, target.token, file, { contentType: typeOf(file) });
        update(added[i].key, error ? { status: "failed", error: "The upload failed. Try again on a better connection." } : { status: "done", path: target.path });
      }),
    );
  }

  if (state.status === "done" && state.outcome && state !== dismissed) {
    const o = state.outcome;
    return (
      <GlassCard strong padding="lg" role="status" className="flex flex-col items-start gap-3">
        <CircleCheck aria-hidden className="size-8 text-success" />
        <h2 className="text-xl font-semibold">Handed in</h2>
        <p className="text-[15px] text-muted">
          {o.invalid ? "Some links were not accepted: the reason is shown above. Fix the post and hand it in again." : o.waiting ? "BuPulse is still checking your links. Their status shows above within a few hours." : "Your links are checked and BuPulse is counting your views."}
        </p>
        {left > 0 && (
          <Button type="button" variant="outline" size="sm" onClick={() => setDismissed(state)}>
            {o.invalid && !o.tracking ? "Hand in again" : "Hand in another"}
          </Button>
        )}
      </GlassCard>
    );
  }

  return (
    <GlassCard strong padding="none" className="p-5 sm:p-6">
      <form ref={formRef} action={action} noValidate className="flex flex-col gap-5">
        <input type="hidden" name="taskId" value={taskId} />
        <input type="hidden" name="day" value={day} />
        {items.filter((i) => i.status === "done" && i.path).map((i) => (
          <input key={i.key} type="hidden" name="mediaPath" value={i.path} />
        ))}
        <h2 className="text-lg font-semibold tracking-tight">Hand in{left > 1 ? ` (${left} left for this day)` : ""}</h2>

        {notConnected.length > 0 && (
          <p role="status" className="flex items-start gap-2 rounded-field bg-soft px-4 py-3 text-sm font-medium">
            <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-pulse-violet" />
            <span>
              Connect your {listWords(notConnected.map((n) => NETWORK_LABEL[n]))} first: only posts of a connected account count. <Link href="/creator/connections" className="underline">Connections</Link>
            </span>
          </p>
        )}

        <Field label="Title" required hint="A few words, for you and the company.">
          <Input name="title" maxLength={120} />
        </Field>
        <Field label="Caption" required hint="Paste the caption you posted.">
          <Textarea name="caption" rows={4} maxLength={2200} />
        </Field>

        <div className="flex flex-col gap-2">
          <span className="text-[15px] font-semibold">{mediaKind === "VIDEO" ? "The video" : mediaKind === "IMAGE" ? "The photos" : "The photos or video"}</span>
          <label className="glass flex min-h-14 cursor-pointer items-center justify-center gap-2 rounded-field px-4 text-[15px] font-semibold">
            <ImagePlus aria-hidden className="size-5" /> Add files
            <input type="file" multiple accept={accept(mediaKind)} className="sr-only" onChange={(e) => void onFiles(e.target.files).finally(() => (e.target.value = ""))} />
          </label>
          <p className="text-[13px] text-muted">Up to {maxFiles} files, {Math.round(maxBytes / 1024 / 1024)} MB each.</p>
          {pickError && <p role="alert" className="text-[13px] font-medium text-danger">{pickError}</p>}
          {items.length > 0 && (
            <ul className="flex flex-col gap-2">
              {items.map((i) => (
                <li key={i.key} className="flex items-center gap-3 rounded-field bg-soft p-2 text-sm">
                  {i.preview ? (
                    // eslint-disable-next-line @next/next/no-img-element -- a local preview of the chosen file
                    <img src={i.preview} alt="" className="size-10 shrink-0 rounded-lg object-cover" />
                  ) : (
                    <span aria-hidden className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-surface text-xs font-semibold">Video</span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{i.name}</span>
                    {i.status === "failed" && <span className="block text-danger">{i.error}</span>}
                  </span>
                  {i.status === "uploading" ? (
                    <LoaderCircle aria-label="Uploading" className="size-5 animate-spin text-muted" />
                  ) : (
                    <button type="button" aria-label={`Remove ${i.name}`} onClick={() => setItems((now) => now.filter((x) => x.key !== i.key))} className="inline-flex size-10 items-center justify-center rounded-full text-muted hover:bg-surface">
                      <Trash2 aria-hidden className="size-4" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <fieldset className="flex flex-col gap-4">
          <legend className="mb-1 text-[15px] font-semibold">{platforms.length > 1 ? (platformMode === "ALL" ? "The link of your post on each platform" : "The link of your post (one platform is enough)") : "The link of your post"}</legend>
          {platforms.map((n) => (
            <Field key={n} label={NETWORK_LABEL[n]} required={platformMode === "ALL" || platforms.length === 1} hint="On the post, tap Share, then Copy link.">
              <Input name={`link_${n}`} type="url" inputMode="url" placeholder="https://" autoCapitalize="none" autoCorrect="off" />
            </Field>
          ))}
        </fieldset>

        {state.status === "error" && state.error && (
          <p role="alert" className="rounded-field bg-danger-bg px-4 py-3 text-sm font-medium text-danger">
            {state.error}
          </p>
        )}
        <Button type="submit" disabled={pending || uploading} className="w-full sm:w-auto sm:self-start">
          {pending ? "Checking your links…" : uploading ? "Uploading…" : "Hand in"}
        </Button>
      </form>
    </GlassCard>
  );
}

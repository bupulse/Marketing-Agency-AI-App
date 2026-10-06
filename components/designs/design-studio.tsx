"use client";

/**
 * <DesignStudio> makes branded designs: from a template (free, unlimited) or from a
 * description (AI, uses the plan's image credits). Embed it on a project page or use it alone.
 *
 * Props (all optional except `designs`):
 *   projectId   Attach new designs to this project. Omit on the Designs page.
 *   defaults    Prefill from the project:
 *                 headline, subline, chip   template text
 *                 photoPaths                object paths in the private "media" bucket (<userId>/projects/...)
 *                 photoUrls                 signed display URLs, same order as photoPaths
 *                                           (lib/designs/service.ts photoPreviewUrls); without them the
 *                                           picker shows "Photo 1", "Photo 2"...
 *                 projectType               Project.type, to list the best-fitting templates first
 *   designs     Existing designs to show in the gallery: { id, url, kind, aspectRatio, template }[]
 *               (lib/designs/service.ts listDesigns returns exactly this).
 *   credits     { used, limit, resetsAt? } of the plan's image credits, for "Uses 1 of your N" and the paywall.
 *   hasLogo     Whether the business has a logo (default true); hides the "use my logo" toggle when false.
 *   showGallery Show the gallery under the studio (default true).
 */

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, ImageIcon, Sparkles, Trash2 } from "lucide-react";
import { Button, Field, GlassCard, Input, Tabs, Textarea, useToast } from "@/components/ui";
import { useUsageBlock } from "@/components/billing/upgrade-dialog";
import { createAiDesign, createTemplateDesign, deleteDesign, getDesignDownloadUrl } from "@/app/dashboard/designs/actions";
import { cn } from "@/lib/cn";
import { ASPECT_LABELS, ASPECT_RATIOS, type AspectRatio } from "@/lib/designs/layout";
import { TEMPLATES, templatesForProjectType } from "@/lib/designs/templates/registry";

export type StudioDesign = { id: string; url: string; kind: string; aspectRatio: string; template: string | null };

export type DesignStudioProps = {
  projectId?: string;
  defaults?: { headline?: string; subline?: string; chip?: string; photoPaths?: string[]; photoUrls?: string[]; projectType?: string };
  designs: StudioDesign[];
  credits?: { used: number; limit: number; resetsAt?: string | null };
  hasLogo?: boolean;
  showGallery?: boolean;
};

type Created = { designId: string; url: string };

const RATIO_SHAPE: Record<AspectRatio, string> = { "1:1": "h-5 w-5", "4:5": "h-6 w-[19px]", "9:16": "h-6 w-[13px]", "16:9": "h-[13px] w-6" };

function RatioPicker({ value, onChange }: { value: AspectRatio; onChange: (v: AspectRatio) => void }) {
  return (
    <div role="group" aria-label="Shape" className="flex flex-wrap gap-2">
      {ASPECT_RATIOS.map((r) => (
        <button
          key={r}
          type="button"
          aria-pressed={value === r}
          onClick={() => onChange(r)}
          className={cn(
            "inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border px-4 text-sm font-semibold",
            value === r ? "border-pulse-blue bg-ok-bg text-ok" : "border-line bg-transparent text-text hover:bg-soft",
          )}
        >
          <span aria-hidden className={cn("rounded-[3px] border-2 border-current", RATIO_SHAPE[r])} />
          {ASPECT_LABELS[r]}
        </button>
      ))}
    </div>
  );
}

function PhotoPicker({ paths, urls, value, onChange }: { paths: string[]; urls: string[]; value: string | null; onChange: (v: string | null) => void }) {
  if (paths.length === 0) return null;
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-semibold">Photo</legend>
      <div className="flex flex-wrap gap-2">
        <button type="button" aria-pressed={value === null} onClick={() => onChange(null)} className={cn("min-h-16 cursor-pointer rounded-2xl border px-4 text-sm font-semibold", value === null ? "border-pulse-blue bg-ok-bg text-ok" : "border-line hover:bg-soft")}>
          No photo
        </button>
        {paths.map((path, i) => (
          <button
            key={path}
            type="button"
            aria-pressed={value === path}
            aria-label={`Photo ${i + 1}`}
            onClick={() => onChange(path)}
            className={cn("flex size-16 cursor-pointer items-center justify-center overflow-hidden rounded-2xl border-2 text-xs font-semibold", value === path ? "border-pulse-blue" : "border-transparent hover:border-line")}
          >
            {urls[i] ? (
              // eslint-disable-next-line @next/next/no-img-element -- signed Storage URL
              <img src={urls[i]} alt="" className="size-full object-cover" />
            ) : (
              <span>#{i + 1}</span>
            )}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function Result({ created, ratio, onAgain }: { created: Created; ratio: string; onAgain: () => void }) {
  return (
    <div className="flex flex-col gap-4">
      {/* eslint-disable-next-line @next/next/no-img-element -- signed Storage URL */}
      <img src={created.url} alt="Your new design" className={cn("w-full rounded-2xl border border-line object-contain", ratio === "9:16" ? "max-h-[70vh] self-center" : "")} />
      <div className="flex flex-wrap gap-3">
        <DownloadButton id={created.designId} />
        <Button variant="ghost" onClick={onAgain}>
          Make another
        </Button>
      </div>
    </div>
  );
}

function DownloadButton({ id, size = "md", label = "Download" }: { id: string; size?: "sm" | "md"; label?: string }) {
  const { toast } = useToast();
  const [pending, start] = useTransition();
  return (
    <Button
      size={size}
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await getDesignDownloadUrl(id);
          if (res.ok) window.location.assign(res.url);
          else toast(res.error, "error");
        })
      }
    >
      <Download aria-hidden className="size-4" />
      {pending ? "Preparing…" : label}
    </Button>
  );
}

function TemplateTab({ projectId, defaults, order }: Pick<DesignStudioProps, "projectId" | "defaults"> & { order: string[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, start] = useTransition();
  const photoPaths = defaults?.photoPaths ?? [];
  const templates = useMemo(() => order.map((id) => TEMPLATES.find((t) => t.id === id)!), [order]);
  const [template, setTemplate] = useState(templates[0].id);
  const [ratio, setRatio] = useState<AspectRatio>("1:1");
  const [headline, setHeadline] = useState(defaults?.headline ?? "");
  const [subline, setSubline] = useState(defaults?.subline ?? "");
  const [chip, setChip] = useState(defaults?.chip ?? "");
  const [photo, setPhoto] = useState<string | null>(photoPaths[0] ?? null);
  const [error, setError] = useState<string | undefined>();
  const [created, setCreated] = useState<Created | null>(null);
  const current = templates.find((t) => t.id === template)!;

  function create() {
    setError(undefined);
    start(async () => {
      const res = await createTemplateDesign({ projectId, template, aspectRatio: ratio, headline, subline, chip: template === "quote" ? "" : chip, photoPath: photo });
      if (res.ok) {
        setCreated({ designId: res.designId, url: res.url });
        toast("Design created", "success");
        router.refresh();
      } else setError(res.error);
    });
  }

  if (created) return <Result created={created} ratio={ratio} onAgain={() => setCreated(null)} />;

  return (
    <div className="flex flex-col gap-6">
      <div role="group" aria-label="Template" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {templates.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-pressed={template === t.id}
            onClick={() => setTemplate(t.id)}
            className={cn("flex cursor-pointer flex-col gap-2 rounded-2xl border-2 p-2 text-left", template === t.id ? "border-pulse-blue bg-ok-bg" : "border-transparent hover:bg-soft")}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- rendered by /api/designs/preview */}
            <img src={`/api/designs/preview?template=${t.id}&ratio=1:1`} alt="" loading="lazy" width={240} height={240} className="aspect-square w-full rounded-xl bg-soft object-cover" />
            <span className="px-1 text-sm font-semibold">{t.name}</span>
          </button>
        ))}
      </div>
      <p className="text-sm text-muted">{current.description}</p>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={current.fields.headline.label} required className="sm:col-span-2">
          <Input value={headline} onChange={(e) => setHeadline(e.target.value)} maxLength={140} placeholder={current.fields.headline.placeholder} />
        </Field>
        <Field label={current.fields.subline.label}>
          <Input value={subline} onChange={(e) => setSubline(e.target.value)} maxLength={180} placeholder={current.fields.subline.placeholder} />
        </Field>
        {template !== "quote" && (
          <Field label={current.fields.chip.label}>
            <Input value={chip} onChange={(e) => setChip(e.target.value)} maxLength={40} placeholder={current.fields.chip.placeholder} />
          </Field>
        )}
      </div>

      <PhotoPicker paths={photoPaths} urls={defaults?.photoUrls ?? []} value={photo} onChange={setPhoto} />
      <RatioPicker value={ratio} onChange={setRatio} />

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex items-center gap-4">
        <Button onClick={create} disabled={pending || !headline.trim()}>
          <ImageIcon aria-hidden className="size-4" />
          {pending ? "Creating…" : "Create design"}
        </Button>
        <span className="text-sm text-muted">Free, no credits used.</span>
      </div>
    </div>
  );
}

function AiTab({ projectId, defaults, credits, hasLogo }: Pick<DesignStudioProps, "projectId" | "defaults" | "credits" | "hasLogo">) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, start] = useTransition();
  const { handleBody, dialog } = useUsageBlock({ limit: credits?.limit, resetsAt: credits?.resetsAt });
  const photoPaths = defaults?.photoPaths ?? [];
  const [prompt, setPrompt] = useState("");
  const [ratio, setRatio] = useState<AspectRatio>("1:1");
  const [useLogo, setUseLogo] = useState(false);
  const [photo, setPhoto] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [created, setCreated] = useState<Created | null>(null);

  const note = credits ? `Uses 1 of your ${credits.limit} image credits (${Math.max(0, credits.limit - credits.used)} left).` : "Uses 1 image credit.";

  function create() {
    setError(undefined);
    start(async () => {
      const res = await createAiDesign({ projectId, prompt, aspectRatio: ratio, useLogo, usePhotoPath: photo });
      if (res.ok) {
        setCreated({ designId: res.designId, url: res.url });
        toast("Image created", "success");
      } else if (res.blocked) handleBody({ error: "usage_blocked", reason: res.blocked });
      else setError(res.error);
      router.refresh();
    });
  }

  if (created) return <Result created={created} ratio={ratio} onAgain={() => setCreated(null)} />;

  return (
    <div className="flex flex-col gap-6">
      <Field label="Describe the image" hint="Say what should be in the picture. Text in the image is only added if you ask for it." required>
        <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} maxLength={800} rows={4} placeholder="A warm morning scene: fresh loaves on a wooden table, soft sunlight, cosy bakery feel" />
      </Field>
      <PhotoPicker paths={photoPaths} urls={defaults?.photoUrls ?? []} value={photo} onChange={setPhoto} />
      <RatioPicker value={ratio} onChange={setRatio} />
      {hasLogo !== false && (
        <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-semibold">
          <input type="checkbox" checked={useLogo} onChange={(e) => setUseLogo(e.target.checked)} className="size-5 accent-[var(--color-pulse-blue)]" />
          Use my logo as a style reference
        </label>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-4">
        <Button onClick={create} disabled={pending || prompt.trim().length < 5}>
          <Sparkles aria-hidden className="size-4" />
          {pending ? "Creating… this can take a moment" : "Create image"}
        </Button>
        <span className="text-sm text-muted">{note}</span>
      </div>
      {dialog}
    </div>
  );
}

function Gallery({ designs }: { designs: StudioDesign[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (designs.length === 0) return <p className="px-1 text-sm text-muted">Your designs will appear here.</p>;

  function remove(id: string) {
    start(async () => {
      const res = await deleteDesign(id);
      setConfirming(null);
      if (res.ok) router.refresh();
      else toast(res.error ?? "Could not delete", "error");
    });
  }

  return (
    <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {designs.map((d) => (
        <li key={d.id} className="flex flex-col gap-2">
          <div className="flex aspect-square items-center justify-center overflow-hidden rounded-2xl border border-line bg-soft">
            {/* eslint-disable-next-line @next/next/no-img-element -- signed Storage URL */}
            <img src={d.url} alt={`${d.kind === "AI" ? "AI image" : "Template design"}, ${d.aspectRatio}`} loading="lazy" className="max-h-full max-w-full object-contain" />
          </div>
          <div className="flex items-center justify-between gap-2">
            <DownloadButton id={d.id} size="sm" label="Save" />
            {confirming === d.id ? (
              <Button size="sm" variant="outline" disabled={pending} onClick={() => remove(d.id)}>
                Delete?
              </Button>
            ) : (
              <Button size="sm" variant="ghost" aria-label="Delete design" onClick={() => setConfirming(d.id)}>
                <Trash2 aria-hidden className="size-4" />
              </Button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function DesignStudio({ projectId, defaults, designs, credits, hasLogo, showGallery = true }: DesignStudioProps) {
  const order = useMemo(() => templatesForProjectType(defaults?.projectType ?? ""), [defaults?.projectType]);
  return (
    <div className="flex flex-col gap-8">
      <GlassCard strong padding="lg">
        <Tabs
          label="Design type"
          items={[
            { value: "template", label: "From a template", content: <TemplateTab projectId={projectId} defaults={defaults} order={order} /> },
            { value: "ai", label: "Describe an image", content: <AiTab projectId={projectId} defaults={defaults} credits={credits} hasLogo={hasLogo} /> },
          ]}
        />
      </GlassCard>
      {showGallery && (
        <section aria-label="Your designs" className="flex flex-col gap-4">
          <h2 className="px-1 text-lg font-semibold">Your designs</h2>
          <Gallery designs={designs} />
        </section>
      )}
    </div>
  );
}

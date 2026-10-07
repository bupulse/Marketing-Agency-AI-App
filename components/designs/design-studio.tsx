"use client";

/**
 * <DesignStudio> makes branded designs: from a template in one of five style packs (free,
 * unlimited), from a template over an AI-made photo (1 image credit), or from a description
 * (AI, 1 image credit). Embed it on a project page or use it alone.
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
 *   pack        The style pack that matches the business (lib/designs/packs.ts recommendPack), marked
 *               "Matches your brand" and chosen by default; "clean" when omitted.
 *   hasLogo     Whether the business has a logo (default true); hides the "use my logo" toggle when false.
 *   galleryPhoto A gallery photo to preselect as the template photo and the AI reference: { path, url }
 *               (the Designs page passes it for ?photo=<assetId>, validated server-side).
 *   showGallery Show the gallery under the studio (default true).
 */

import { createContext, useContext, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, ImageIcon, Images, Sparkles, Trash2 } from "lucide-react";
import { Button, Field, GlassCard, Input, Tabs, Textarea, useToast } from "@/components/ui";
import { useUsageBlock } from "@/components/billing/upgrade-dialog";
import { MediaPicker, type PickedPhoto } from "@/components/media/media-picker";
import { EditInCanva } from "./edit-in-canva";
import { createAiDesign, createAiPhotoDesign, createTemplateDesign, deleteDesign, getDesignDownloadUrl } from "@/app/dashboard/designs/actions";
import { cn } from "@/lib/cn";
import { ASPECT_LABELS, ASPECT_RATIOS, type AspectRatio } from "@/lib/designs/layout";
import { PACKS, type PackId } from "@/lib/designs/packs";
import { TEMPLATES, templatesForProjectType } from "@/lib/designs/templates/registry";

export type StudioDesign = {
  id: string;
  url: string;
  kind: string;
  aspectRatio: string;
  template: string | null;
};

export type DesignStudioProps = {
  projectId?: string;
  defaults?: {
    headline?: string;
    subline?: string;
    chip?: string;
    photoPaths?: string[];
    photoUrls?: string[];
    projectType?: string;
  };
  designs: StudioDesign[];
  credits?: { used: number; limit: number; resetsAt?: string | null };
  hasLogo?: boolean;
  pack?: PackId;
  showGallery?: boolean;
  galleryPhoto?: { path: string; url: string } | null;
  /** Pass `isCanvaEnabled()` from the server page to show "Edit in Canva" on designs. */
  canva?: boolean;
};

const CanvaEnabled = createContext(false);

type Created = { designId: string; url: string };

const RATIO_SHAPE: Record<AspectRatio, string> = {
  "1:1": "h-5 w-5",
  "4:5": "h-6 w-[19px]",
  "9:16": "h-6 w-[13px]",
  "16:9": "h-[13px] w-6",
};

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

function PhotoPicker({
  paths,
  urls,
  value,
  onChange,
  hint,
  gallery,
}: {
  paths: string[];
  urls: string[];
  value: string | null;
  onChange: (v: string | null) => void;
  hint?: string;
  gallery?: { path: string; url: string } | null;
}) {
  // Photos taken from "From my gallery" stay in the list, so the choice can be changed back and forth.
  const [picks, setPicks] = useState<{ path: string; url: string }[]>(gallery ? [gallery] : []);
  const [open, setOpen] = useState(false);
  const tile = (selected: boolean) =>
    cn("flex size-16 cursor-pointer items-center justify-center overflow-hidden rounded-2xl border-2 text-xs font-semibold", selected ? "border-pulse-blue" : "border-transparent hover:border-line");

  function pick(photos: PickedPhoto[]) {
    const photo = photos[0];
    if (!photo) return;
    setPicks((cur) => (cur.some((p) => p.path === photo.path) ? cur : [...cur, { path: photo.path, url: photo.url }]));
    onChange(photo.path);
  }

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-semibold">Photo</legend>
      {hint && <p className="text-sm text-muted">{hint}</p>}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          aria-pressed={value === null}
          onClick={() => onChange(null)}
          className={cn(
            "min-h-16 cursor-pointer rounded-2xl border px-4 text-sm font-semibold",
            value === null ? "border-pulse-blue bg-ok-bg text-ok" : "border-line hover:bg-soft",
          )}
        >
          No photo
        </button>
        {paths.map((path, i) => (
          <button key={path} type="button" aria-pressed={value === path} aria-label={`Photo ${i + 1}`} onClick={() => onChange(path)} className={tile(value === path)}>
            {urls[i] ? (
              // eslint-disable-next-line @next/next/no-img-element -- signed Storage URL
              <img src={urls[i]} alt="" className="size-full object-cover" />
            ) : (
              <span>#{i + 1}</span>
            )}
          </button>
        ))}
        {picks.map((p, i) => (
          <button key={p.path} type="button" aria-pressed={value === p.path} aria-label={`Gallery photo ${i + 1}`} onClick={() => onChange(p.path)} className={tile(value === p.path)}>
            {/* eslint-disable-next-line @next/next/no-img-element -- signed Storage URL */}
            <img src={p.url} alt="" className="size-full object-cover" />
          </button>
        ))}
        <button type="button" onClick={() => setOpen(true)} className="inline-flex min-h-16 cursor-pointer items-center gap-2 rounded-2xl border border-dashed border-line px-4 text-sm font-semibold hover:bg-soft">
          <Images aria-hidden className="size-4" />
          From my gallery
        </button>
      </div>
      <MediaPicker open={open} onOpenChange={setOpen} onPick={pick} />
    </fieldset>
  );
}

function Result({ created, ratio, onAgain }: { created: Created; ratio: string; onAgain: () => void }) {
  return (
    <div className="flex flex-col gap-4">
      {/* eslint-disable-next-line @next/next/no-img-element -- signed Storage URL */}
      <img
        src={created.url}
        alt="Your new design"
        className={cn("w-full rounded-2xl border border-line object-contain", ratio === "9:16" ? "max-h-[70vh] self-center" : "")}
      />
      <div className="flex flex-wrap gap-3">
        <DownloadButton id={created.designId} />
        <EditInCanva designId={created.designId} enabled={useContext(CanvaEnabled)} />
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

type Mode = "free" | "photo";

function ModePicker({ value, onChange, creditNote }: { value: Mode; onChange: (v: Mode) => void; creditNote: string }) {
  const options: { id: Mode; title: string; text: string }[] = [
    {
      id: "free",
      title: "Free template",
      text: "Uses your own photo, or your brand colours. No credits.",
    },
    {
      id: "photo",
      title: "With AI photo (1 image credit)",
      text: `A realistic photo is made for you, then your headline, price and logo are added on top. ${creditNote}`,
    },
  ];
  return (
    <div role="group" aria-label="How to make it" className="grid gap-3 sm:grid-cols-2">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={value === o.id}
          onClick={() => onChange(o.id)}
          className={cn(
            "flex min-h-11 cursor-pointer flex-col gap-1 rounded-2xl border-2 p-4 text-left",
            value === o.id ? "border-pulse-blue bg-ok-bg" : "border-line hover:bg-soft",
          )}
        >
          <span className="flex items-center gap-2 text-sm font-semibold">
            {o.id === "photo" ? <Sparkles aria-hidden className="size-4" /> : <ImageIcon aria-hidden className="size-4" />}
            {o.title}
          </span>
          <span className="text-sm text-muted">{o.text}</span>
        </button>
      ))}
    </div>
  );
}

// The style thumbnails always show the same template, so switching templates never re-renders them.
const STYLE_PREVIEW_TEMPLATE = "offer";

function StylePicker({ value, onChange, matches }: { value: PackId; onChange: (v: PackId) => void; matches: PackId }) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-semibold">Style</legend>
      <div role="group" aria-label="Style" className="grid grid-cols-3 gap-3 sm:grid-cols-5">
        {PACKS.map((p) => (
          <button
            key={p.id}
            type="button"
            aria-pressed={value === p.id}
            onClick={() => onChange(p.id)}
            className={cn(
              "flex cursor-pointer flex-col gap-2 rounded-2xl border-2 p-2 text-left",
              value === p.id ? "border-pulse-blue bg-ok-bg" : "border-transparent hover:bg-soft",
            )}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- rendered by /api/designs/preview */}
            <img
              src={`/api/designs/preview?template=${STYLE_PREVIEW_TEMPLATE}&ratio=1:1&pack=${p.id}`}
              alt=""
              loading="lazy"
              width={200}
              height={200}
              className="aspect-square w-full rounded-xl bg-soft object-cover"
            />
            <span className="px-1 text-sm font-semibold">{p.name}</span>
            {p.id === matches && <span className="px-1 text-xs font-semibold text-ok">Matches your brand</span>}
          </button>
        ))}
      </div>
      <p className="text-sm text-muted">{PACKS.find((p) => p.id === value)?.description}</p>
    </fieldset>
  );
}

function TemplateTab({
  projectId,
  defaults,
  order,
  pack: matchingPack = "clean",
  credits,
  galleryPhoto,
}: Pick<DesignStudioProps, "projectId" | "defaults" | "credits" | "galleryPhoto"> & {
  order: string[];
  pack?: PackId;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, start] = useTransition();
  const { handleBody, dialog } = useUsageBlock({
    limit: credits?.limit,
    resetsAt: credits?.resetsAt,
  });
  const photoPaths = defaults?.photoPaths ?? [];
  const allTemplates = useMemo(() => order.map((id) => TEMPLATES.find((t) => t.id === id)!), [order]);
  const [mode, setMode] = useState<Mode>("free");
  // Quotes are text only, so they are not offered over an AI photo.
  const templates = useMemo(() => (mode === "photo" ? allTemplates.filter((t) => t.id !== "quote") : allTemplates), [allTemplates, mode]);
  const [template, setTemplate] = useState(allTemplates[0].id);
  const [pack, setPack] = useState<PackId>(matchingPack);
  const [ratio, setRatio] = useState<AspectRatio>("1:1");
  const [headline, setHeadline] = useState(defaults?.headline ?? "");
  const [subline, setSubline] = useState(defaults?.subline ?? "");
  const [chip, setChip] = useState(defaults?.chip ?? "");
  const [photo, setPhoto] = useState<string | null>(galleryPhoto?.path ?? photoPaths[0] ?? null);
  const [reference, setReference] = useState<string | null>(galleryPhoto?.path ?? null);
  const [scene, setScene] = useState("");
  const [includePeople, setIncludePeople] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [created, setCreated] = useState<Created | null>(null);
  const activeId = templates.some((t) => t.id === template) ? template : templates[0].id;
  const current = templates.find((t) => t.id === activeId)!;
  const note = credits ? `${Math.max(0, credits.limit - credits.used)} of ${credits.limit} left.` : "";

  function create() {
    setError(undefined);
    start(async () => {
      const text = {
        projectId,
        template: activeId,
        pack,
        aspectRatio: ratio,
        headline,
        subline,
        chip: activeId === "quote" ? "" : chip,
      };
      const res =
        mode === "photo"
          ? await createAiPhotoDesign({
              ...text,
              scene,
              includePeople,
              usePhotoPath: reference,
            })
          : await createTemplateDesign({ ...text, photoPath: photo });
      if (res.ok) {
        setCreated({ designId: res.designId, url: res.url });
        toast("Design created", "success");
      } else if (res.blocked) handleBody({ error: "usage_blocked", reason: res.blocked });
      else setError(res.error);
      router.refresh();
    });
  }

  if (created) return <Result created={created} ratio={ratio} onAgain={() => setCreated(null)} />;

  return (
    <div className="flex flex-col gap-6">
      <ModePicker value={mode} onChange={setMode} creditNote={note} />

      <div role="group" aria-label="Template" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {templates.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-pressed={activeId === t.id}
            onClick={() => setTemplate(t.id)}
            className={cn(
              "flex cursor-pointer flex-col gap-2 rounded-2xl border-2 p-2 text-left",
              activeId === t.id ? "border-pulse-blue bg-ok-bg" : "border-transparent hover:bg-soft",
            )}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- rendered by /api/designs/preview */}
            <img
              src={`/api/designs/preview?template=${t.id}&ratio=1:1&pack=${pack}`}
              alt=""
              loading="lazy"
              width={240}
              height={240}
              className="aspect-square w-full rounded-xl bg-soft object-cover"
            />
            <span className="px-1 text-sm font-semibold">{t.name}</span>
          </button>
        ))}
      </div>
      <p className="text-sm text-muted">{current.description}</p>

      <StylePicker value={pack} onChange={setPack} matches={matchingPack} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={current.fields.headline.label} required className="sm:col-span-2">
          <Input value={headline} onChange={(e) => setHeadline(e.target.value)} maxLength={140} placeholder={current.fields.headline.placeholder} />
        </Field>
        <Field label={current.fields.subline.label}>
          <Input value={subline} onChange={(e) => setSubline(e.target.value)} maxLength={180} placeholder={current.fields.subline.placeholder} />
        </Field>
        {activeId !== "quote" && (
          <Field label={current.fields.chip.label}>
            <Input value={chip} onChange={(e) => setChip(e.target.value)} maxLength={40} placeholder={current.fields.chip.placeholder} />
          </Field>
        )}
        {mode === "photo" && (
          <Field
            label="What should the photo show?"
            hint="Optional. Without it, the photo is made from your headline. No text is put in the photo itself."
            className="sm:col-span-2"
          >
            <Textarea
              value={scene}
              onChange={(e) => setScene(e.target.value)}
              maxLength={400}
              rows={2}
              placeholder="Fresh loaves on a wooden table in warm morning light"
            />
          </Field>
        )}
      </div>

      {mode === "photo" ? (
        <PhotoPicker
          paths={photoPaths}
          urls={defaults?.photoUrls ?? []}
          value={reference}
          onChange={setReference}
          gallery={galleryPhoto}
          hint="Optional: the AI keeps this product faithful in the new photo."
        />
      ) : (
        <PhotoPicker paths={photoPaths} urls={defaults?.photoUrls ?? []} value={photo} onChange={setPhoto} gallery={galleryPhoto} />
      )}
      <RatioPicker value={ratio} onChange={setRatio} />
      {mode === "photo" && (
        <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-semibold">
          <input
            type="checkbox"
            checked={includePeople}
            onChange={(e) => setIncludePeople(e.target.checked)}
            className="size-5 accent-[var(--color-pulse-blue)]"
          />
          Include people (customers using the product)
        </label>
      )}

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-4">
        <Button onClick={create} disabled={pending || !headline.trim()}>
          {mode === "photo" ? <Sparkles aria-hidden className="size-4" /> : <ImageIcon aria-hidden className="size-4" />}
          {pending ? (mode === "photo" ? "Creating… this can take a moment" : "Creating…") : mode === "photo" ? "Create with AI photo" : "Create design"}
        </Button>
        <span className="text-sm text-muted">
          {mode === "photo" ? `Uses 1 image credit${note ? ` (${note.replace(/\.$/, "")})` : ""}. Returned if it fails.` : "Free, no credits used."}
        </span>
      </div>
      {dialog}
    </div>
  );
}

function AiTab({ projectId, defaults, credits, hasLogo, galleryPhoto }: Pick<DesignStudioProps, "projectId" | "defaults" | "credits" | "hasLogo" | "galleryPhoto">) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, start] = useTransition();
  const { handleBody, dialog } = useUsageBlock({
    limit: credits?.limit,
    resetsAt: credits?.resetsAt,
  });
  const photoPaths = defaults?.photoPaths ?? [];
  const [prompt, setPrompt] = useState("");
  const [ratio, setRatio] = useState<AspectRatio>("1:1");
  const [useLogo, setUseLogo] = useState(false);
  const [includePeople, setIncludePeople] = useState(true);
  const [photo, setPhoto] = useState<string | null>(galleryPhoto?.path ?? null);
  const [error, setError] = useState<string | undefined>();
  const [created, setCreated] = useState<Created | null>(null);

  const note = credits ? `Uses 1 of your ${credits.limit} image credits (${Math.max(0, credits.limit - credits.used)} left).` : "Uses 1 image credit.";

  function create() {
    setError(undefined);
    start(async () => {
      const res = await createAiDesign({
        projectId,
        prompt,
        aspectRatio: ratio,
        useLogo,
        includePeople,
        usePhotoPath: photo,
      });
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
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          maxLength={800}
          rows={4}
          placeholder="A warm morning scene: fresh loaves on a wooden table, soft sunlight, cosy bakery feel"
        />
      </Field>
      <PhotoPicker paths={photoPaths} urls={defaults?.photoUrls ?? []} value={photo} onChange={setPhoto} gallery={galleryPhoto} />
      <RatioPicker value={ratio} onChange={setRatio} />
      <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-semibold">
        <input
          type="checkbox"
          checked={includePeople}
          onChange={(e) => setIncludePeople(e.target.checked)}
          className="size-5 accent-[var(--color-pulse-blue)]"
        />
        Include people (customers using the product)
      </label>
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
  const canva = useContext(CanvaEnabled);
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
            <img
              src={d.url}
              alt={`${d.kind === "AI" ? "AI image" : "Template design"}, ${d.aspectRatio}`}
              loading="lazy"
              className="max-h-full max-w-full object-contain"
            />
          </div>
          <div className="flex items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1">
              <DownloadButton id={d.id} size="sm" label="Save" />
              <EditInCanva designId={d.id} enabled={canva} />
            </div>
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

export function DesignStudio({ projectId, defaults, designs, credits, hasLogo, pack, showGallery = true, galleryPhoto = null, canva = false }: DesignStudioProps) {
  const order = useMemo(() => templatesForProjectType(defaults?.projectType ?? ""), [defaults?.projectType]);
  return (
    <CanvaEnabled value={canva}>
      <div className="flex flex-col gap-8">
        <GlassCard strong padding="lg">
          <Tabs
            label="Design type"
            items={[
              {
                value: "template",
                label: "From a template",
                content: <TemplateTab projectId={projectId} defaults={defaults} order={order} pack={pack} credits={credits} galleryPhoto={galleryPhoto} />,
              },
              {
                value: "ai",
                label: "Describe an image",
                content: <AiTab projectId={projectId} defaults={defaults} credits={credits} hasLogo={hasLogo} galleryPhoto={galleryPhoto} />,
              },
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
    </CanvaEnabled>
  );
}

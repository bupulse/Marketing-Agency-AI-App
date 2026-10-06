"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Building2, CalendarDays, Hammer, Package, Plus, Sparkles, Tag, Wrench, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button, Chip, Field, GlassCard, Input, Textarea, useToast } from "@/components/ui";
import { UpgradeDialog } from "@/components/billing/upgrade-dialog";
import type { UsageBlockReason } from "@/components/billing/helpers";
import { createProject, updateProject } from "@/app/dashboard/projects/actions";
import { GenerateProgress } from "./generate-progress";
import { PhotoPicker, type PhotoItem } from "./photo-picker";
import { MAX_FEATURES, PROJECT_TYPES, addFeature, getProjectType, usageNote } from "./helpers";

const ICONS: Record<string, LucideIcon> = {
  product: Package,
  service: Wrench,
  event: CalendarDays,
  offer: Tag,
  listing: Building2,
  project: Hammer,
  other: Sparkles,
};

export type ProjectFormInitial = {
  type: string;
  title: string;
  price: string;
  features: string[];
  details: string;
  photos: { path: string; url: string }[];
};

const EMPTY: ProjectFormInitial = { type: "product", title: "", price: "", features: [], details: "", photos: [] };

/** Create or edit a project. Used by /dashboard/projects/new and /dashboard/projects/[id]/edit. */
export function ProjectForm({
  projectId,
  initial = EMPTY,
  used,
  limit,
}: {
  /** Set when editing an existing project. */
  projectId?: string;
  initial?: ProjectFormInitial;
  used?: number;
  limit?: number;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, start] = useTransition();
  const [generating, setGenerating] = useState(false);

  const [type, setType] = useState(initial.type);
  const [title, setTitle] = useState(initial.title);
  const [price, setPrice] = useState(initial.price);
  const [features, setFeatures] = useState(initial.features);
  const [featureDraft, setFeatureDraft] = useState("");
  const [details, setDetails] = useState(initial.details);
  const [photos, setPhotos] = useState<PhotoItem[]>(() =>
    initial.photos.map((p) => ({ key: p.path, path: p.path, preview: p.url, status: "done" })),
  );
  const [uploading, setUploading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const [blocked, setBlocked] = useState<UsageBlockReason | null>(null);
  const [blockedOpen, setBlockedOpen] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);

  const editing = Boolean(projectId);
  const option = getProjectType(type);
  const needsTitle = !title.trim();

  function commitFeature() {
    const next = addFeature(features, featureDraft);
    setFeatures(next);
    setFeatureDraft("");
    setErrors((e) => ({ ...e, features: "" }));
  }

  function submit(generate: boolean) {
    setFormError(null);
    if (needsTitle) {
      setErrors({ title: "Enter a name for this project." });
      document.getElementById("project-title")?.focus();
      return;
    }
    setErrors({});
    // A feature typed but not added yet still counts.
    const finalFeatures = addFeature(features, featureDraft);
    const payload = {
      type,
      title: title.trim(),
      price: price.trim() || undefined,
      features: finalFeatures,
      details: details.trim() || undefined,
      photoPaths: photos.flatMap((p) => (p.status === "done" && p.path ? [p.path] : [])),
    };
    setGenerating(generate);
    start(async () => {
      const result = editing && projectId ? await updateProject(projectId, payload) : await createProject({ ...payload, generate });
      if (result.ok) {
        const id = "projectId" in result && result.projectId ? result.projectId : projectId;
        router.push(`/dashboard/projects/${id}`);
        toast(editing ? "Project saved." : generate ? "Project created and content written." : "Draft saved.", "success");
        return;
      }
      setGenerating(false);
      if (result.blocked) {
        setBlocked(result.blocked);
        setSavedId(result.projectId ?? null);
        setBlockedOpen(true);
        return;
      }
      if (result.fieldErrors) setErrors(result.fieldErrors as Record<string, string>);
      setFormError(result.error);
    });
  }

  if (pending && generating && !editing) {
    return (
      <GlassCard padding="lg">
        <GenerateProgress title="Creating your project and writing content" />
      </GlassCard>
    );
  }

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit(false);
      }}
      className="flex flex-col gap-5"
    >
      <GlassCard as="fieldset" className="flex flex-col gap-3 p-5 sm:p-6">
        <legend className="mb-1 text-lg font-semibold tracking-[-0.02em]">What are you promoting?</legend>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Project type">
          {PROJECT_TYPES.map((t) => {
            const Icon = ICONS[t.value] ?? Sparkles;
            return (
              <Chip key={t.value} selected={type === t.value} onClick={() => setType(t.value)} icon={<Icon aria-hidden className="size-4" />} className="px-4 py-2.5">
                {t.label}
              </Chip>
            );
          })}
        </div>
        <p className="text-[13px] text-muted">{option.hint}</p>
      </GlassCard>

      <GlassCard as="section" aria-label="Details" className="flex flex-col gap-5 p-5 sm:p-6">
        <Field label="Name" required error={errors.title}>
          <Input
            id="project-title"
            value={title}
            maxLength={150}
            placeholder={option.titlePlaceholder}
            onChange={(e) => {
              setTitle(e.target.value);
              setErrors((x) => ({ ...x, title: "" }));
            }}
          />
        </Field>
        <Field label="Price or offer (optional)" error={errors.price}>
          <Input value={price} maxLength={80} placeholder={option.pricePlaceholder} onChange={(e) => setPrice(e.target.value)} />
        </Field>

        <div className="flex flex-col gap-2">
          <Field label={`Key features (up to ${MAX_FEATURES})`} error={errors.features} hint="Short points people should know. Press Enter to add each one.">
            <Input
              value={featureDraft}
              maxLength={120}
              disabled={features.length >= MAX_FEATURES}
              placeholder={features.length >= MAX_FEATURES ? "Feature limit reached" : option.featurePlaceholder}
              onChange={(e) => setFeatureDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitFeature();
                }
              }}
            />
          </Field>
          <div>
            <Button variant="ghost" size="sm" disabled={!featureDraft.trim() || features.length >= MAX_FEATURES} onClick={commitFeature} leading={<Plus aria-hidden className="size-4" />}>
              Add feature
            </Button>
          </div>
          {features.length > 0 && (
            <ul aria-label="Added features" className="flex flex-wrap gap-2">
              {features.map((f) => (
                <li key={f} className="glass inline-flex min-h-11 items-center gap-1 rounded-full py-1 pr-1 pl-4 text-[15px]">
                  <span className="break-words">{f}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${f}`}
                    onClick={() => setFeatures((cur) => cur.filter((x) => x !== f))}
                    className="inline-flex size-9 cursor-pointer items-center justify-center rounded-full text-muted hover:bg-soft hover:text-text"
                  >
                    <X aria-hidden className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <Field label="Extra details (optional)" error={errors.details}>
          <Textarea rows={5} value={details} maxLength={2000} placeholder={option.detailsPlaceholder} onChange={(e) => setDetails(e.target.value)} />
        </Field>
      </GlassCard>

      <GlassCard as="section" aria-label="Photos" className="flex flex-col gap-3 p-5 sm:p-6">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold tracking-[-0.02em]">Photos</h2>
          <p className="text-[14px] text-muted">Used in your branded designs. The first photo is the cover.</p>
        </div>
        <PhotoPicker photos={photos} onChange={(fn) => setPhotos(fn)} onBusyChange={setUploading} />
        {errors.photoPaths && (
          <p role="alert" className="text-[13px] font-medium text-danger">
            {errors.photoPaths}
          </p>
        )}
      </GlassCard>

      {savedId && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-success-bg px-4 py-3 text-[14px] font-medium text-success">
          <span>Your project is saved. Content was not written.</span>
          <Button size="sm" variant="outline" href={`/dashboard/projects/${savedId}`}>
            Open project
          </Button>
        </div>
      )}

      {formError && (
        <p role="alert" className="rounded-2xl bg-danger-bg px-4 py-3 text-[14px] font-medium text-danger">
          {formError}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {editing ? (
          <>
            <Button type="submit" disabled={pending || uploading || Boolean(savedId)}>
              {pending ? "Saving…" : "Save changes"}
            </Button>
            <Button variant="outline" href={`/dashboard/projects/${projectId}`}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            <Button
              disabled={pending || uploading || Boolean(savedId)}
              onClick={() => submit(true)}
              leading={<Sparkles aria-hidden className="size-4" />}
            >
              Create and write content
            </Button>
            <Button type="submit" variant="ghost" disabled={pending || uploading || Boolean(savedId)}>
              {pending ? "Saving…" : "Save as draft"}
            </Button>
          </>
        )}
        {uploading && <span role="status" className="text-[13px] text-muted">Waiting for photos to finish uploading…</span>}
      </div>
      {!editing && <p className="text-[13px] text-muted">{usageNote(used, limit)} Saving as a draft is free.</p>}

      {blocked && (
        <UpgradeDialog
          open={blockedOpen}
          onOpenChange={setBlockedOpen}
          reason={blocked}
          limit={limit}
        />
      )}
    </form>
  );
}

"use client";

// Step 9 of the campaign wizard: the application form the company builds (docs/CREATOR_CAMPAIGN_WIZARD.md, "Form";
// lib/creators/form-fields.ts). Built-in rows, one-tap ready-made fields, any field by type, and a phone preview. The
// real public form (/c/<slug>) is drawn by the creator side from the same ApplicationForm.

import { ArrowDown, ArrowUp, Lock, Plus, Smartphone, Sparkles, Trash2, Upload, X } from "lucide-react";
import { useState } from "react";
import { Button, Dialog, Field, Input } from "@/components/ui";
import { cn } from "@/lib/cn";
import { BUILT_IN_FIELDS, FIELD_GROUPS, FIELD_TYPE_LABEL, hasOptions, MAX_FIELDS, MAX_OPTIONS, newField, PRESET_FIELDS, type ApplicationForm, type FieldType, type FormField, type Show } from "@/lib/creators/form-fields";
import { Question, Segmented, Switch } from "./controls";
import type { BrandLook } from "./look-step";
import type { StepProps } from "./wizard";

const SHOW_OPTIONS: { value: Show; label: string }[] = [
  { value: "REQUIRED", label: "Required" },
  { value: "OPTIONAL", label: "Optional" },
  { value: "HIDDEN", label: "Hidden" },
];

const freshId = () => `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const TEXTY: FieldType[] = ["SHORT_TEXT", "LONG_TEXT", "NUMBER", "LINK", "LOCATION"];

export function FormStep({ a, set, o, suggestion }: StepProps) {
  const form = a.applicationForm;
  const [adding, setAdding] = useState(false);
  const [preview, setPreview] = useState(false);
  const setForm = (patch: Partial<ApplicationForm>) => set({ applicationForm: { ...form, ...patch } });
  const setField = (i: number, patch: Partial<FormField>) => setForm({ fields: form.fields.map((f, j) => (j === i ? { ...f, ...patch } : f)) });
  const move = (i: number, by: -1 | 1) => {
    const next = [...form.fields];
    const [f] = next.splice(i, 1);
    next.splice(i + by, 0, f);
    setForm({ fields: next });
  };
  const has = (f: FormField) => form.fields.some((x) => x.id === f.id || (f.preset && x.preset === f.preset) || x.label.toLowerCase() === f.label.toLowerCase());
  const add = (f: FormField) => {
    if (form.fields.length < MAX_FIELDS) setForm({ fields: [...form.fields, form.fields.some((x) => x.id === f.id) ? { ...f, id: freshId() } : f] });
  };
  const ai = (suggestion?.fields ?? []).filter((f) => !has(f));
  const presets = PRESET_FIELDS.filter((f) => !has(f));

  return (
    <div className="grid gap-7 2xl:grid-cols-[minmax(0,1fr)_300px] 2xl:items-start">
      <div className="flex min-w-0 flex-col gap-7">
        <Field label="A line at the top (optional)" hint="Under your logo, before the questions.">
          <Input value={form.intro ?? ""} maxLength={500} onChange={(e) => setForm({ intro: e.target.value || null })} placeholder="Love our juice? Tell us about you and your accounts." />
        </Field>

        <Question label="Always on the form" id="q-builtin">
          <ul className="flex flex-col divide-y divide-line rounded-2xl border border-line">
            {BUILT_IN_FIELDS.map((b) => (
              <li key={b.key} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                <span className="text-[15px] font-medium">{b.label}</span>
                {b.locked ? (
                  <span className="inline-flex min-h-11 items-center gap-1.5 text-[13px] font-semibold text-muted">
                    <Lock aria-hidden className="size-3.5" /> Always asked
                  </span>
                ) : (
                  <Segmented label={b.label} value={form[b.key as "phone" | "samples"]} onChange={(v) => setForm({ [b.key]: v } as Partial<ApplicationForm>)} options={SHOW_OPTIONS} />
                )}
              </li>
            ))}
          </ul>
        </Question>

        {(ai.length > 0 || presets.length > 0) && form.fields.length < MAX_FIELDS && (
          <Question label="Add with one tap" hint="Ready-made questions. You can change them after." id="q-presets">
            <div className="flex flex-wrap gap-2">
              {ai.map((f) => (
                <button key={`ai-${f.id}`} type="button" onClick={() => add({ ...f, id: freshId() })} className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-2xl border border-pulse-violet/40 bg-new-bg px-3.5 py-2 text-left text-[14px] font-medium text-new hover:brightness-95">
                  <Sparkles aria-hidden className="size-3.5 shrink-0" /> {f.label}
                </button>
              ))}
              {presets.map((f) => (
                <button key={f.id} type="button" onClick={() => add(f)} className="glass inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-2xl px-3.5 py-2 text-left text-[14px] font-medium hover:bg-soft">
                  <Plus aria-hidden className="size-3.5 shrink-0" /> {f.label}
                </button>
              ))}
            </div>
          </Question>
        )}

        <Question label={`Your questions (${form.fields.length} of ${MAX_FIELDS})`} hint={form.fields.length ? undefined : "None yet: creators answer only the questions above."} id="q-fields">
          <ol className="flex flex-col gap-3">
            {form.fields.map((f, i) => (
              <FieldCard key={f.id} n={i + 1} field={f} first={i === 0} last={i === form.fields.length - 1} currency={a.currency} onChange={(p) => setField(i, p)} onMove={(by) => move(i, by)} onDelete={() => setForm({ fields: form.fields.filter((_, j) => j !== i) })} />
            ))}
          </ol>
          {form.fields.length < MAX_FIELDS && (
            <Button variant="outline" size="sm" className="self-start" leading={<Plus aria-hidden className="size-4" />} onClick={() => setAdding(true)}>
              Add a field
            </Button>
          )}
        </Question>

        <button type="button" aria-expanded={preview} onClick={() => setPreview(!preview)} className="inline-flex min-h-11 cursor-pointer items-center gap-2 self-start rounded-full border border-line px-4 text-[14px] font-semibold hover:bg-soft 2xl:hidden">
          <Smartphone aria-hidden className="size-4" /> {preview ? "Hide the preview" : "See it on a phone"}
        </button>
        {preview && (
          <div className="2xl:hidden">
            <PhonePreview form={form} brand={o.brand} name={a.name} />
          </div>
        )}
      </div>

      <div className="hidden 2xl:sticky 2xl:top-4 2xl:block">
        <PhonePreview form={form} brand={o.brand} name={a.name} />
      </div>

      <Dialog open={adding} onOpenChange={setAdding} title="Add a field" description="Pick what kind of answer you want.">
        <div className="mt-2 flex flex-col gap-4">
          {FIELD_GROUPS.map((g) => (
            <section key={g.title} className="flex flex-col gap-2">
              <h3 className="text-[13px] font-semibold uppercase tracking-wide text-muted">{g.title}</h3>
              <div className="grid grid-cols-2 gap-2">
                {g.types.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => {
                      add(newField(t, freshId()));
                      setAdding(false);
                    }}
                    className="min-h-12 cursor-pointer rounded-2xl border border-line px-3 text-left text-[14px] font-medium hover:bg-soft"
                  >
                    {FIELD_TYPE_LABEL[t]}
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      </Dialog>
    </div>
  );
}

function FieldCard({ n, field: f, first, last, currency, onChange, onMove, onDelete }: { n: number; field: FormField; first: boolean; last: boolean; currency: string; onChange: (p: Partial<FormField>) => void; onMove: (by: -1 | 1) => void; onDelete: () => void }) {
  const icon = "inline-flex size-11 cursor-pointer items-center justify-center rounded-full text-muted hover:bg-glass hover:text-text disabled:cursor-not-allowed disabled:opacity-30";
  const options = f.options ?? [];
  const range = f.type === "NUMBER" || f.type === "SCALE" || f.type === "MONEY_RANGE";
  return (
    <li className="flex flex-col gap-3 rounded-2xl border border-line bg-soft/60 p-3.5 sm:p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="rounded-full bg-glass px-2.5 py-1 text-[12px] font-semibold text-muted">
          {n}. {FIELD_TYPE_LABEL[f.type]}
        </span>
        <span className="flex">
          <button type="button" aria-label={`Move question ${n} up`} disabled={first} onClick={() => onMove(-1)} className={icon}>
            <ArrowUp aria-hidden className="size-4" />
          </button>
          <button type="button" aria-label={`Move question ${n} down`} disabled={last} onClick={() => onMove(1)} className={icon}>
            <ArrowDown aria-hidden className="size-4" />
          </button>
          <button type="button" aria-label={`Delete question ${n}`} onClick={onDelete} className={icon}>
            <Trash2 aria-hidden className="size-4" />
          </button>
        </span>
      </div>
      <Field label="Question">
        <Input value={f.label} maxLength={200} onChange={(e) => onChange({ label: e.target.value })} placeholder="What do you usually post about?" />
      </Field>
      <Field label="Help under it (optional)">
        <Input value={f.help ?? ""} maxLength={300} onChange={(e) => onChange({ help: e.target.value || null })} placeholder="A short tip for the answer" />
      </Field>
      {TEXTY.includes(f.type) && (
        <Field label="Example in the box (optional)">
          <Input value={f.placeholder ?? ""} maxLength={120} onChange={(e) => onChange({ placeholder: e.target.value || null })} placeholder="What creators see before they type" />
        </Field>
      )}
      {hasOptions(f.type) && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">Answers to pick from</legend>
          {options.map((opt, i) => (
            <div key={i} className="flex gap-2">
              <Input aria-label={`Answer ${i + 1}`} value={opt} maxLength={100} onChange={(e) => onChange({ options: options.map((x, j) => (j === i ? e.target.value : x)) })} placeholder={`Answer ${i + 1}`} />
              <button type="button" aria-label={`Remove answer ${i + 1}`} onClick={() => onChange({ options: options.filter((_, j) => j !== i) })} className={icon}>
                <X aria-hidden className="size-4" />
              </button>
            </div>
          ))}
          {options.length < MAX_OPTIONS && (
            <Button variant="outline" size="sm" className="self-start" leading={<Plus aria-hidden className="size-4" />} onClick={() => onChange({ options: [...options, ""] })}>
              Add an answer
            </Button>
          )}
        </fieldset>
      )}
      {range && (
        <div className="grid grid-cols-2 gap-3">
          <Field label={f.type === "SCALE" ? "From" : f.type === "MONEY_RANGE" ? `Lowest (${f.currency ?? currency})` : "Smallest"}>
            <Input inputMode="numeric" value={f.min ?? ""} onChange={(e) => onChange({ min: e.target.value.replace(/\D/g, "") ? Number(e.target.value.replace(/\D/g, "")) : null })} placeholder={f.type === "SCALE" ? "1" : "0"} />
          </Field>
          <Field label={f.type === "SCALE" ? "To (10 at most)" : f.type === "MONEY_RANGE" ? `Highest (${f.currency ?? currency})` : "Largest"}>
            <Input inputMode="numeric" value={f.max ?? ""} onChange={(e) => onChange({ max: e.target.value.replace(/\D/g, "") ? Number(e.target.value.replace(/\D/g, "")) : null })} placeholder={f.type === "SCALE" ? "5" : "No limit"} />
          </Field>
        </div>
      )}
      {f.type === "UPLOAD" && (
        <Segmented
          label="What they can send"
          value={f.accept ?? "ANY"}
          onChange={(accept) => onChange({ accept })}
          options={[
            { value: "IMAGE", label: "Photo" },
            { value: "VIDEO", label: "Video" },
            { value: "ANY", label: "Either" },
          ]}
        />
      )}
      <Switch checked={f.required} onChange={(required) => onChange({ required })} label="Must be answered" />
    </li>
  );
}

/** A read-only phone of the form, in the brand's colour, as creators see it (the real form is /c/<slug>). */
export function PhonePreview({ form, brand, name }: { form: ApplicationForm; brand: BrandLook; name: string }) {
  const box = "min-h-9 w-full rounded-lg border border-black/10 bg-white px-2.5 text-[12px] text-neutral-400 flex items-center";
  const builtIn = [
    { label: "First name", show: "REQUIRED" },
    { label: "Last name", show: "REQUIRED" },
    { label: "Email", show: "REQUIRED" },
    { label: "Phone number (WhatsApp)", show: form.phone },
    { label: "Your social media accounts", show: "REQUIRED" },
    { label: "Links to your best posts", show: form.samples },
  ].filter((b) => b.show !== "HIDDEN");
  return (
    <figure aria-label="Phone preview of the application form" className="mx-auto w-full max-w-[300px]">
      <div className="overflow-hidden rounded-[2.2rem] border-[7px] border-neutral-900 bg-neutral-50 text-neutral-900 shadow-glass">
        <div className="flex flex-col items-center gap-2 px-4 pt-5 pb-4 text-center text-white" style={{ background: brand.accent }}>
          {brand.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- private signed URL
            <img src={brand.logoUrl} alt="" className="size-12 rounded-full bg-white object-contain p-1" />
          ) : (
            <span className="inline-flex size-12 items-center justify-center rounded-full bg-white/25 text-[18px] font-bold">{brand.name.slice(0, 1).toUpperCase()}</span>
          )}
          <p className="text-[15px] leading-tight font-semibold">{name || "Your campaign"}</p>
          <p className="text-[11px] opacity-90">{brand.name}</p>
        </div>
        <div className="flex max-h-[460px] flex-col gap-3 overflow-y-auto px-4 py-4">
          {form.intro && <p className="text-[12px] text-neutral-600">{form.intro}</p>}
          {builtIn.map((b) => (
            <div key={b.label} className="flex flex-col gap-1">
              <span className="text-[12px] font-semibold">
                {b.label}
                {b.show === "REQUIRED" ? " *" : ""}
              </span>
              <span className={box} />
            </div>
          ))}
          {form.fields.map((f) => (
            <div key={f.id} className="flex flex-col gap-1">
              <span className="text-[12px] font-semibold">
                {f.label || "Your question"}
                {f.required ? " *" : ""}
              </span>
              {f.help && <span className="text-[11px] text-neutral-500">{f.help}</span>}
              <PreviewInput field={f} box={box} accent={brand.accent} />
            </div>
          ))}
          <span className="mt-1 flex min-h-10 items-center justify-center rounded-full text-[13px] font-semibold text-white" style={{ background: brand.accent }}>
            Apply
          </span>
          <p className="text-center text-[10px] text-neutral-400">Powered by BuPulse</p>
        </div>
      </div>
      <figcaption className="mt-2 text-center text-[12px] text-muted">How creators see it</figcaption>
    </figure>
  );
}

function PreviewInput({ field: f, box, accent }: { field: FormField; box: string; accent: string }) {
  const pill = "rounded-full border border-black/10 bg-white px-2.5 py-1 text-[11px]";
  switch (f.type) {
    case "LONG_TEXT":
      return <span className={cn(box, "min-h-14 items-start py-1.5")}>{f.placeholder}</span>;
    case "SINGLE_CHOICE":
    case "MULTI_CHOICE":
      return (
        <span className="flex flex-wrap gap-1">
          {(f.options ?? []).filter(Boolean).slice(0, 8).map((o) => (
            <span key={o} className={pill}>
              {o}
            </span>
          ))}
        </span>
      );
    case "DROPDOWN":
      return <span className={box}>Pick one ▾</span>;
    case "YES_NO":
      return (
        <span className="flex gap-1">
          <span className={pill}>Yes</span>
          <span className={pill}>No</span>
        </span>
      );
    case "SCALE":
      return (
        <span className="flex flex-wrap gap-1">
          {Array.from({ length: Math.min(10, Math.max(2, (f.max ?? 5) - (f.min ?? 1) + 1)) }, (_, i) => (
            <span key={i} className="inline-flex size-7 items-center justify-center rounded-full border border-black/10 bg-white text-[11px]" style={i === 0 ? { borderColor: accent } : undefined}>
              {(f.min ?? 1) + i}
            </span>
          ))}
        </span>
      );
    case "MONEY_RANGE":
    case "DATE_RANGE":
      return (
        <span className="grid grid-cols-2 gap-1">
          <span className={box}>{f.type === "DATE_RANGE" ? "From" : "From"}</span>
          <span className={box}>To</span>
        </span>
      );
    case "DATE":
      return <span className={box}>dd/mm/yyyy</span>;
    case "UPLOAD":
      return (
        <span className={cn(box, "min-h-14 justify-center gap-1.5 border-dashed")}>
          <Upload aria-hidden className="size-3.5" /> {f.accept === "IMAGE" ? "Add a photo" : f.accept === "VIDEO" ? "Add a video" : "Add a photo or video"}
        </span>
      );
    default:
      return <span className={box}>{f.placeholder}</span>;
  }
}

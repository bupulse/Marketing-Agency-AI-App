"use client";

import { useId, useState } from "react";
import { CircleCheck, LoaderCircle, MapPin, Paperclip, TriangleAlert } from "lucide-react";
import { Input, Select, Textarea } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { FormField } from "@/lib/creators/form-fields";
import { searchPlaces } from "@/lib/creators/places";
import { createClient } from "@/lib/supabase/client";

// One field of a campaign's application form (lib/creators/form-fields.ts), with the control its type needs. Names
// follow lib/creators/application.ts: `q_<id>`, ranges `q_<id>.min`/`.max` and `q_<id>.from`/`.to`. Picked answers
// take the company's colour (the page sets --brand and --on-brand).

export type Values = Record<string, string | string[] | undefined>;
export type StartUpload = (fieldId: string, file: { type: string; size: number }) => Promise<{ ok: true; path: string; token: string } | { ok: false; error: string }>;

/** The brand's filled button (the page's --brand), for the forms' main button. */
export const BRAND_BUTTON = "bg-none! bg-[color:var(--brand)]! text-[color:var(--on-brand)]! shadow-none!";

/** A picked option: the brand's colour, the page's own otherwise. */
const OPTION = "inline-flex min-h-11 cursor-pointer items-center rounded-2xl border border-line bg-glass px-4 py-2.5 text-[15px] font-medium transition-colors has-checked:border-transparent has-checked:bg-[color:var(--brand)] has-checked:text-[color:var(--on-brand)] has-focus-visible:shadow-ring";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const many = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? [v] : []);

/** The label (or legend), the help line and the error of a field. */
function Question({ field, error, htmlFor, group, children }: { field: FormField; error?: string; htmlFor?: string; group?: boolean; children: React.ReactNode }) {
  const title = (
    <>
      {field.label}
      {field.required && (
        <span aria-hidden className="ml-0.5 text-[color:var(--brand)]">
          *
        </span>
      )}
    </>
  );
  const extra = (
    <>
      {field.help && !error && <p className="text-[13px] text-muted">{field.help}</p>}
      {error && (
        <p role="alert" className="text-[13px] font-medium text-danger">
          {error}
        </p>
      )}
    </>
  );
  if (group)
    return (
      <fieldset className="flex flex-col gap-2" aria-required={field.required || undefined}>
        <legend className="mb-1 text-[15px] font-semibold">{title}</legend>
        {children}
        {extra}
      </fieldset>
    );
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-[15px] font-semibold">
        {title}
      </label>
      {children}
      {extra}
    </div>
  );
}

const money = (n: number) => n.toLocaleString("en-US");

function Dropdown({ field, id, name, value, error }: { field: FormField; id: string; name: string; value: string; error?: string }) {
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState(value);
  const options = field.options ?? [];
  const searchable = options.length > 8;
  const shown = searchable && query.trim() ? options.filter((o) => o.toLowerCase().includes(query.trim().toLowerCase()) || o === picked) : options;
  return (
    <div className="flex flex-col gap-2">
      {searchable && <Input type="search" aria-label={`Search: ${field.label}`} placeholder="Type to search" value={query} onChange={(e) => setQuery(e.target.value)} />}
      <Select id={id} name={name} value={picked} onChange={(e) => setPicked(e.target.value)} invalid={Boolean(error)}>
        <option value="">{field.placeholder || "Pick one"}</option>
        {shown.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </Select>
    </div>
  );
}

function PlaceSearch({ id, name, value, placeholder, error }: { id: string; name: string; value: string; placeholder: string; error?: string }) {
  const [text, setText] = useState(value);
  const [open, setOpen] = useState(false);
  const list = open ? searchPlaces(text, 6).filter((p) => p.toLowerCase() !== text.trim().toLowerCase()) : [];
  const listId = `${id}-places`;
  return (
    <div className="relative">
      <Input
        id={id}
        name={name}
        value={text}
        autoComplete="off"
        role="combobox"
        aria-expanded={list.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        placeholder={placeholder}
        invalid={Boolean(error)}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {list.length > 0 && (
        <ul id={listId} role="listbox" className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-2xl border border-line bg-[var(--bp-dialog)] shadow-glass">
          {list.map((p) => (
            <li key={p} role="option" aria-selected={false}>
              <button
                type="button"
                className="flex min-h-11 w-full items-center gap-2 px-3.5 text-left text-[15px] hover:bg-soft"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setText(p);
                  setOpen(false);
                }}
              >
                <MapPin aria-hidden className="size-4 shrink-0 text-muted" />
                {p}
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-1 text-[13px] text-muted">Not in the list? Type it as you say it.</p>
    </div>
  );
}

const ACCEPT: Record<string, string> = { IMAGE: "image/jpeg,image/png,image/webp,image/heic", VIDEO: "video/mp4,video/quicktime,video/webm", ANY: "image/jpeg,image/png,image/webp,image/heic,video/mp4,video/quicktime,video/webm" };

/** Files a phone may label vaguely (iPhone HEIC, MOV) get their type from the name. */
function typeOf(file: File): string {
  if (file.type) return file.type.toLowerCase();
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return ({ jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic", mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm" } as Record<string, string>)[ext] ?? "";
}

function Upload({ field, id, name, value, fileName, startUpload, preview, error }: { field: FormField; id: string; name: string; value: string; fileName: string; startUpload: StartUpload; preview?: boolean; error?: string }) {
  const [state, setState] = useState<{ status: "idle" | "uploading" | "done" | "failed"; path: string; name: string; error?: string }>(value ? { status: "done", path: value, name: fileName || "Your file" } : { status: "idle", path: "", name: "" });
  const maxMb = 50;

  async function onPick(file: File | undefined) {
    if (!file) return;
    if (preview) return setState({ status: "failed", path: "", name: file.name, error: "This is a preview: files cannot be sent yet." });
    if (file.size > maxMb * 1024 * 1024) return setState({ status: "failed", path: "", name: file.name, error: `The file is over ${maxMb} MB. Send a shorter or smaller one.` });
    setState({ status: "uploading", path: "", name: file.name });
    const started = await startUpload(field.id, { type: typeOf(file), size: file.size });
    if (!started.ok) return setState({ status: "failed", path: "", name: file.name, error: started.error });
    const { error: failed } = await createClient().storage.from("creator-media").uploadToSignedUrl(started.path, started.token, file, { contentType: typeOf(file) });
    setState(failed ? { status: "failed", path: "", name: file.name, error: "The upload failed. Try again on a better connection." } : { status: "done", path: started.path, name: file.name });
  }

  return (
    <div className="flex flex-col gap-2" data-uploading={state.status === "uploading" || undefined}>
      <input type="hidden" name={name} value={state.status === "done" ? state.path : ""} />
      <input type="hidden" name={`${name}.name`} value={state.status === "done" ? state.name : ""} />
      <label htmlFor={id} className={cn(OPTION, "justify-center gap-2 border-dashed", invalidRing(error))}>
        <Paperclip aria-hidden className="size-4" />
        {state.status === "done" ? "Change the file" : field.accept === "VIDEO" ? "Choose a video" : field.accept === "IMAGE" ? "Choose a photo" : "Choose a photo or video"}
        <input id={id} type="file" accept={ACCEPT[field.accept ?? "ANY"]} className="sr-only" disabled={state.status === "uploading"} onChange={(e) => onPick(e.target.files?.[0])} />
      </label>
      {state.status !== "idle" && (
        <p role="status" className={cn("flex items-center gap-2 text-[14px]", state.status === "failed" && "text-danger")}>
          {state.status === "uploading" ? <LoaderCircle aria-hidden className="size-4 animate-spin" /> : state.status === "done" ? <CircleCheck aria-hidden className="size-4 text-success" /> : <TriangleAlert aria-hidden className="size-4" />}
          <span className="min-w-0 break-all">{state.status === "uploading" ? `Sending ${state.name}…` : state.status === "done" ? state.name : state.error}</span>
        </p>
      )}
      <p className="text-[13px] text-muted">Up to {maxMb} MB. Only {field.accept === "VIDEO" ? "a video" : field.accept === "IMAGE" ? "a photo" : "a photo or a video"}; the company sees it, nobody else.</p>
    </div>
  );
}

const invalidRing = (error?: string) => (error ? "border-danger" : "");

/** For the forms' onSubmit: holds the form back while a file is still being sent (its path is not in the form yet). */
export function holdWhileUploading(e: React.FormEvent<HTMLFormElement>): void {
  if (!e.currentTarget.querySelector("[data-uploading]")) return;
  e.preventDefault();
  window.alert("Your file is still being sent. Send the form when it is done.");
}

/** The control for one field, under its question. `values`: what came back after an error. */
export function FieldInput({ field, values, error, currency, startUpload, preview }: { field: FormField; values: Values; error?: string; currency: string; startUpload: StartUpload; preview?: boolean }) {
  const uid = useId().replace(/:/g, "");
  const id = `q${uid}`;
  const name = `q_${field.id}`;
  const value = one(values[name]);
  const invalid = Boolean(error);

  switch (field.type) {
    case "SHORT_TEXT":
      return (
        <Question field={field} error={error} htmlFor={id}>
          <Input id={id} name={name} defaultValue={value} placeholder={field.placeholder ?? "Your answer"} maxLength={200} invalid={invalid} />
        </Question>
      );
    case "LONG_TEXT":
      return (
        <Question field={field} error={error} htmlFor={id}>
          <Textarea id={id} name={name} rows={4} defaultValue={value} placeholder={field.placeholder ?? "A few lines"} maxLength={2000} invalid={invalid} />
        </Question>
      );
    case "LINK":
      return (
        <Question field={field} error={error} htmlFor={id}>
          <Input id={id} name={name} type="url" inputMode="url" autoCapitalize="none" defaultValue={value} placeholder={field.placeholder ?? "https://"} invalid={invalid} />
        </Question>
      );
    case "NUMBER":
      return (
        <Question field={field} error={error} htmlFor={id}>
          <Input id={id} name={name} inputMode="numeric" defaultValue={value} placeholder={field.placeholder ?? (field.min != null && field.max != null ? `${money(field.min)} to ${money(field.max)}` : "A whole number")} invalid={invalid} />
        </Question>
      );
    case "DATE":
      return (
        <Question field={field} error={error} htmlFor={id}>
          <Input id={id} name={name} type="date" defaultValue={value} invalid={invalid} />
        </Question>
      );
    case "LOCATION":
      return (
        <Question field={field} error={error} htmlFor={id}>
          <PlaceSearch id={id} name={name} value={value} placeholder={field.placeholder ?? "Search your district or city"} error={error} />
        </Question>
      );
    case "DROPDOWN":
      return (
        <Question field={field} error={error} htmlFor={id}>
          <Dropdown field={field} id={id} name={name} value={value} error={error} />
        </Question>
      );
    case "SINGLE_CHOICE":
      return (
        <Question field={field} error={error} group>
          <div className="grid gap-2 sm:grid-cols-2">
            {(field.options ?? []).map((o) => (
              <label key={o} className={cn(OPTION, invalidRing(error))}>
                <input type="radio" name={name} value={o} defaultChecked={value === o} className="sr-only" />
                {o}
              </label>
            ))}
          </div>
        </Question>
      );
    case "MULTI_CHOICE": {
      const picked = many(values[name]);
      return (
        <Question field={field} error={error} group>
          <p className="-mt-1 text-[13px] text-muted">Pick all that fit.</p>
          <div className="flex flex-wrap gap-2">
            {(field.options ?? []).map((o) => (
              <label key={o} className={cn(OPTION, "rounded-full", invalidRing(error))}>
                <input type="checkbox" name={name} value={o} defaultChecked={picked.includes(o)} className="sr-only" />
                {o}
              </label>
            ))}
          </div>
        </Question>
      );
    }
    case "YES_NO":
      return (
        <Question field={field} error={error} group>
          <div className="grid grid-cols-2 gap-2">
            {[
              ["yes", "Yes"],
              ["no", "No"],
            ].map(([v, label]) => (
              <label key={v} className={cn(OPTION, "justify-center", invalidRing(error))}>
                <input type="radio" name={name} value={v} defaultChecked={value === v} className="sr-only" />
                {label}
              </label>
            ))}
          </div>
        </Question>
      );
    case "SCALE": {
      const min = field.min ?? 1;
      const max = field.max ?? 5;
      return (
        <Question field={field} error={error} group>
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: max - min + 1 }, (_, i) => String(min + i)).map((v) => (
              <label key={v} className={cn(OPTION, "min-w-11 justify-center px-3", invalidRing(error))}>
                <input type="radio" name={name} value={v} defaultChecked={value === v} className="sr-only" />
                {v}
              </label>
            ))}
          </div>
          <p className="flex justify-between text-[13px] text-muted">
            <span>{min}: not at all</span>
            <span>{max}: very</span>
          </p>
        </Question>
      );
    }
    case "MONEY_RANGE": {
      const cur = field.currency ?? currency;
      return (
        <Question field={field} error={error} group>
          <div className="grid grid-cols-2 gap-3">
            {[
              [`${name}.min`, "From", field.min != null ? money(field.min) : "5,000"],
              [`${name}.max`, "To", field.max != null ? money(Math.min(field.max, 50_000)) : "20,000"],
            ].map(([n, label, ph]) => (
              <label key={n} className="flex flex-col gap-1 text-[13px] font-medium text-muted">
                {label} ({cur})
                <Input name={n} inputMode="numeric" defaultValue={one(values[n])} placeholder={ph} invalid={invalid} />
              </label>
            ))}
          </div>
        </Question>
      );
    }
    case "DATE_RANGE":
      return (
        <Question field={field} error={error} group>
          <div className="grid grid-cols-2 gap-3">
            {[
              [`${name}.from`, "From"],
              [`${name}.to`, "To"],
            ].map(([n, label]) => (
              <label key={n} className="flex flex-col gap-1 text-[13px] font-medium text-muted">
                {label}
                <Input name={n} type="date" defaultValue={one(values[n])} invalid={invalid} />
              </label>
            ))}
          </div>
        </Question>
      );
    case "UPLOAD":
      return (
        <Question field={field} error={error} group>
          <Upload field={field} id={id} name={name} value={value} fileName={one(values[`${name}.name`])} startUpload={startUpload} preview={preview} error={error} />
        </Question>
      );
  }
}

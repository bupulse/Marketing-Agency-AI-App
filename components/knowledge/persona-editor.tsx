"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button, Dialog, Field, GlassCard, Input, Select, Textarea, useToast } from "@/components/ui";
import { createPersona, deletePersona, reorderPersonas, saveAudienceNotes, updatePersona } from "@/app/dashboard/knowledge/audience/actions";
import {
  AGE_LABEL,
  AGE_RANGES,
  EMPTY_PERSONA,
  GENDER_LABEL,
  GENDERS,
  INCOME_BANDS,
  INCOME_LABEL,
  MAX_PERSONAS,
  ONLINE_PLACES,
  PERSONA_LANGUAGES,
  PERSONA_LIMITS,
  PERSONA_LIST_MAX,
  personaGaps,
  personaInputSchema,
  type PersonaFormValues,
  type PersonaInput,
} from "@/lib/knowledge/audience";
import { fieldErrorMap } from "@/lib/knowledge/products";
import { ListField } from "./list-field";
import { DetailLine, OrderedList } from "./ordered-list";

export type PersonaItem = { id: string; line: string; values: PersonaFormValues };

/** Knowledge base -> Customers & audience: the personas (add, edit, order, delete) and the overall notes. */
export function PersonaEditor({ personas, notes, canEdit }: { personas: PersonaItem[]; notes: string; canEdit: boolean }) {
  const [editing, setEditing] = useState<PersonaItem | "new" | null>(null);
  const full = personas.length >= MAX_PERSONAS;

  return (
    <>
      <section aria-labelledby="personas" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="personas" className="text-lg font-semibold tracking-[-0.02em]">
            Personas
          </h2>
          {canEdit && (
            <Button size="sm" disabled={full} leading={<Plus aria-hidden className="size-4" />} onClick={() => setEditing("new")}>
              Add a persona
            </Button>
          )}
        </div>
        {personas.length === 0 ? (
          <GlassCard className="p-5 text-[15px] text-muted">
            A persona is one typical customer: who they are, what they need, what holds them back and what makes them buy. Start with your most common customer; one is enough to begin.
          </GlassCard>
        ) : (
          <OrderedList
            items={personas}
            label="Personas"
            noun="persona"
            title={(p) => p.values.name}
            canEdit={canEdit}
            onEdit={setEditing}
            onDelete={deletePersona}
            onReorder={reorderPersonas}
            render={(p) => {
              const gaps = personaGaps(p.values);
              return (
                <div className="flex flex-col gap-1.5">
                  <p className="text-[14px] text-muted">{p.line}</p>
                  <DetailLine label="Needs" items={p.values.needs} />
                  <DetailLine label="Pains" items={p.values.pains} />
                  <DetailLine label="Objections" items={p.values.objections} />
                  <DetailLine label="Buys when" items={p.values.triggers} />
                  <DetailLine label="Online on" items={p.values.channels} />
                  <DetailLine label="Prefers" items={[p.values.language]} />
                  {gaps.length > 0 && <p className="text-[13px] text-muted">Add their {gaps.join(", ")} to make posts sharper.</p>}
                </div>
              );
            }}
          />
        )}
      </section>

      <NotesCard notes={notes} canEdit={canEdit} />

      {editing && <PersonaDialog key={editing === "new" ? "new" : editing.id} persona={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function NotesCard({ notes, canEdit }: { notes: string; canEdit: boolean }) {
  const router = useRouter();
  const { toast } = useToast();
  const [value, setValue] = useState(notes);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  return (
    <GlassCard as="section" aria-labelledby="audience-notes" className="flex flex-col gap-4 p-5 sm:p-6">
      <h2 id="audience-notes" className="text-lg font-semibold tracking-[-0.02em]">
        Notes on your audience
      </h2>
      <Field label="Anything else about your customers" error={error} hint="Seasons, habits, what they compare you with, how they found you. Optional.">
        <Textarea rows={4} value={value} maxLength={PERSONA_LIMITS.notes} disabled={!canEdit} onChange={(e) => setValue(e.target.value)} placeholder="Most customers find us through friends on WhatsApp. December and back-to-school are our busiest months." />
      </Field>
      {canEdit && (
        <Button
          className="self-start"
          disabled={pending || value === notes}
          onClick={() =>
            start(async () => {
              const result = await saveAudienceNotes({ notes: value });
              if (!result.ok) {
                setError(result.fieldErrors?.notes ?? result.error);
                return;
              }
              setError(undefined);
              toast("Notes saved.", "success");
              router.refresh();
            })
          }
        >
          Save notes
        </Button>
      )}
    </GlassCard>
  );
}

function PersonaDialog({ persona, onClose }: { persona: PersonaItem | null; onClose: () => void }) {
  const router = useRouter();
  const { toast } = useToast();
  const [values, setValues] = useState<PersonaFormValues>(persona?.values ?? EMPTY_PERSONA);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function set<K extends keyof PersonaFormValues>(key: K, value: PersonaFormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: "" }));
  }

  function submit() {
    const check = personaInputSchema.safeParse(values);
    if (!check.success) {
      setErrors(fieldErrorMap(check.error));
      setFormError("Check the highlighted fields.");
      return;
    }
    start(async () => {
      const input = values as PersonaInput;
      const result = persona ? await updatePersona(persona.id, input) : await createPersona(input);
      if (!result.ok) {
        if (result.fieldErrors) setErrors(result.fieldErrors);
        setFormError(result.error);
        return;
      }
      toast(persona ? "Persona saved." : "Persona added.", "success");
      onClose();
      router.refresh();
    });
  }

  const list = (key: "needs" | "pains" | "objections" | "triggers" | "channels", label: string, placeholder: string, hint?: string, suggestions?: readonly string[]) => (
    <ListField label={label} items={values[key]} onChange={(v) => set(key, v)} max={PERSONA_LIST_MAX} each={PERSONA_LIMITS.line} placeholder={placeholder} hint={hint} error={errors[key]} suggestions={suggestions} />
  );

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} title={persona ? `Edit ${persona.values.name}` : "Add a persona"} description="One typical customer. Fields with * are required." className="max-w-2xl">
      <form
        noValidate
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field label="Persona name" required error={errors.name} hint="A short label, e.g. “Busy office worker” or “Young mum in Kicukiro”.">
          <Input value={values.name} maxLength={PERSONA_LIMITS.name} onChange={(e) => set("name", e.target.value)} />
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Age range" required error={errors.ageRange}>
            <Select value={values.ageRange} onChange={(e) => set("ageRange", e.target.value)}>
              <option value="">Choose…</option>
              {AGE_RANGES.map((a) => (
                <option key={a} value={a}>
                  {AGE_LABEL[a]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Gender (optional)" error={errors.gender}>
            <Select value={values.gender} onChange={(e) => set("gender", e.target.value)}>
              <option value="">Not specified</option>
              {GENDERS.map((g) => (
                <option key={g} value={g}>
                  {GENDER_LABEL[g]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Location" required error={errors.location} hint="Where they live or work.">
            <Input value={values.location} maxLength={PERSONA_LIMITS.location} placeholder="Kigali, Kimironko" onChange={(e) => set("location", e.target.value)} />
          </Field>
          <Field label="Occupation (optional)" error={errors.occupation}>
            <Input value={values.occupation} maxLength={PERSONA_LIMITS.occupation} placeholder="Nurse, student, shop owner…" onChange={(e) => set("occupation", e.target.value)} />
          </Field>
          <Field label="Income (optional)" error={errors.incomeBand}>
            <Select value={values.incomeBand} onChange={(e) => set("incomeBand", e.target.value)}>
              <option value="">Not specified</option>
              {INCOME_BANDS.map((b) => (
                <option key={b} value={b}>
                  {INCOME_LABEL[b]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Preferred language (optional)" error={errors.language}>
            <Select value={values.language} onChange={(e) => set("language", e.target.value)}>
              <option value="">Not specified</option>
              {[...PERSONA_LANGUAGES, ...(values.language && !(PERSONA_LANGUAGES as readonly string[]).includes(values.language) ? [values.language] : [])].map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {list("needs", "What they need", "Fresh bread before work", "Press Enter to add each one.")}
        {list("pains", "What frustrates them", "Long queues in the morning")}
        {list("objections", "What makes them hesitate", "Worried it is too expensive")}
        {list("triggers", "What makes them buy now", "Payday, a birthday, a friend's recommendation")}
        {list("channels", "Where they spend time online", "WhatsApp groups", undefined, ONLINE_PLACES)}
        {formError && (
          <p role="alert" className="text-[14px] font-medium text-danger">
            {formError}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-3">
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {persona ? "Save persona" : "Add persona"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

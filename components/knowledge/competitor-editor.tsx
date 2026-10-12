"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button, Dialog, Field, GlassCard, Input, Select, Textarea, useToast } from "@/components/ui";
import { createCompetitor, deleteCompetitor, reorderCompetitors, savePositioning, updateCompetitor } from "@/app/dashboard/knowledge/competitors/actions";
import {
  COMPETITOR_LIMITS,
  COMPETITOR_LIST_MAX,
  competitorHref,
  competitorInputSchema,
  EMPTY_COMPETITOR,
  isPricePosition,
  MAX_COMPETITORS,
  MAX_DIFFERENTIATORS,
  PRICE_POSITION_LABEL,
  PRICE_POSITIONS,
  type CompetitorFormValues,
  type CompetitorInput,
} from "@/lib/knowledge/competitors";
import { fieldErrorMap } from "@/lib/knowledge/products";
import { ListField } from "./list-field";
import { DetailLine, OrderedList } from "./ordered-list";

export type CompetitorItem = { id: string; values: CompetitorFormValues };

/** Knowledge base -> Competitors & what makes you different. */
export function CompetitorEditor({ competitors, differentiators, statement, canEdit }: { competitors: CompetitorItem[]; differentiators: string[]; statement: string; canEdit: boolean }) {
  const [editing, setEditing] = useState<CompetitorItem | "new" | null>(null);
  return (
    <>
      <PositioningCard differentiators={differentiators} statement={statement} canEdit={canEdit} />
      <section aria-labelledby="competitors" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="competitors" className="text-lg font-semibold tracking-[-0.02em]">
            Competitors
          </h2>
          {canEdit && (
            <Button size="sm" disabled={competitors.length >= MAX_COMPETITORS} leading={<Plus aria-hidden className="size-4" />} onClick={() => setEditing("new")}>
              Add a competitor
            </Button>
          )}
        </div>
        {competitors.length === 0 ? (
          <GlassCard className="p-5 text-[15px] text-muted">Who else do your customers consider? BuPulse uses this as background to stress what makes you different. It never names or criticises a competitor in a post.</GlassCard>
        ) : (
          <OrderedList
            items={competitors}
            label="Competitors"
            noun="competitor"
            title={(c) => c.values.name}
            canEdit={canEdit}
            onEdit={setEditing}
            onDelete={deleteCompetitor}
            onReorder={reorderCompetitors}
            render={(c) => {
              const href = competitorHref(c.values.link || null);
              return (
                <div className="flex flex-col gap-1.5">
                  {c.values.link &&
                    (href ? (
                      <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="w-fit text-[14px] break-all">
                        {c.values.link.replace(/^https?:\/\//, "")}
                      </a>
                    ) : (
                      <p className="text-[14px] text-muted">{c.values.link}</p>
                    ))}
                  <DetailLine label="Price" items={[isPricePosition(c.values.pricePosition) ? PRICE_POSITION_LABEL[c.values.pricePosition] : null]} />
                  <DetailLine label="Does well" items={c.values.strengths} />
                  <DetailLine label="Weaknesses" items={c.values.weaknesses} />
                </div>
              );
            }}
          />
        )}
      </section>
      {editing && <CompetitorDialog key={editing === "new" ? "new" : editing.id} competitor={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function PositioningCard({ differentiators, statement, canEdit }: { differentiators: string[]; statement: string; canEdit: boolean }) {
  const router = useRouter();
  const { toast } = useToast();
  const [items, setItems] = useState(differentiators);
  const [text, setText] = useState(statement);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const changed = text !== statement || items.join("\n") !== differentiators.join("\n");
  return (
    <GlassCard as="section" aria-labelledby="positioning" className="flex flex-col gap-5 p-5 sm:p-6">
      <h2 id="positioning" className="text-lg font-semibold tracking-[-0.02em]">
        What makes you different
      </h2>
      {canEdit ? (
        <ListField
          label="Your differentiators"
          items={items}
          onChange={setItems}
          max={MAX_DIFFERENTIATORS}
          each={COMPETITOR_LIMITS.differentiator}
          placeholder="Delivery within 2 hours in Kigali"
          hint="The reasons customers pick you over the others. Concrete beats general. Press Enter to add."
          error={errors.differentiators}
        />
      ) : (
        <DetailLine label="Differentiators" items={items} />
      )}
      <Field label="Positioning statement" error={errors.statement} hint="One or two sentences: for whom, what you offer, and why you rather than the others.">
        <Textarea
          rows={3}
          value={text}
          disabled={!canEdit}
          maxLength={COMPETITOR_LIMITS.statement}
          placeholder="For busy families in Kigali, we are the bakery that delivers fresh bread before breakfast, made with local flour."
          onChange={(e) => setText(e.target.value)}
        />
      </Field>
      {canEdit && (
        <Button
          className="self-start"
          disabled={pending || !changed}
          onClick={() =>
            start(async () => {
              const result = await savePositioning({ differentiators: items, statement: text });
              if (!result.ok) {
                setErrors(result.fieldErrors ?? { statement: result.error });
                return;
              }
              setErrors({});
              toast("Saved.", "success");
              router.refresh();
            })
          }
        >
          Save
        </Button>
      )}
    </GlassCard>
  );
}

function CompetitorDialog({ competitor, onClose }: { competitor: CompetitorItem | null; onClose: () => void }) {
  const router = useRouter();
  const { toast } = useToast();
  const [values, setValues] = useState<CompetitorFormValues>(competitor?.values ?? EMPTY_COMPETITOR);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function set<K extends keyof CompetitorFormValues>(key: K, value: CompetitorFormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: "" }));
  }

  function submit() {
    const check = competitorInputSchema.safeParse(values);
    if (!check.success) {
      setErrors(fieldErrorMap(check.error));
      setFormError("Check the highlighted fields.");
      return;
    }
    start(async () => {
      const input = values as CompetitorInput;
      const result = competitor ? await updateCompetitor(competitor.id, input) : await createCompetitor(input);
      if (!result.ok) {
        if (result.fieldErrors) setErrors(result.fieldErrors);
        setFormError(result.error);
        return;
      }
      toast(competitor ? "Competitor saved." : "Competitor added.", "success");
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} title={competitor ? `Edit ${competitor.values.name}` : "Add a competitor"} description="Fields with * are required." className="max-w-2xl">
      <form
        noValidate
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field label="Name" required error={errors.name}>
          <Input value={values.name} maxLength={COMPETITOR_LIMITS.name} onChange={(e) => set("name", e.target.value)} />
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Website or social profile (optional)" error={errors.link} hint="rival.rw or @rival">
            <Input value={values.link} maxLength={COMPETITOR_LIMITS.link} onChange={(e) => set("link", e.target.value)} />
          </Field>
          <Field label="Their prices (optional)" error={errors.pricePosition}>
            <Select value={values.pricePosition} onChange={(e) => set("pricePosition", e.target.value)}>
              <option value="">Not sure</option>
              {PRICE_POSITIONS.map((p) => (
                <option key={p} value={p}>
                  {PRICE_POSITION_LABEL[p]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <ListField label="What they do well" items={values.strengths} onChange={(v) => set("strengths", v)} max={COMPETITOR_LIST_MAX} each={COMPETITOR_LIMITS.line} placeholder="Big shop on the main road" error={errors.strengths} />
        <ListField label="Their weaknesses" items={values.weaknesses} onChange={(v) => set("weaknesses", v)} max={COMPETITOR_LIST_MAX} each={COMPETITOR_LIMITS.line} placeholder="No delivery on Sundays" error={errors.weaknesses} />
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
            {competitor ? "Save competitor" : "Add competitor"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

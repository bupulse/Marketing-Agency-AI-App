"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Lock, Plus } from "lucide-react";
import { Button, Chip, Dialog, Field, GlassCard, Input, Textarea, useToast } from "@/components/ui";
import { createFaq, deleteFaq, reorderFaqs, savePolicies, updateFaq } from "@/app/dashboard/knowledge/faqs/actions";
import { FAQ_LIMITS, faqInputSchema, MAX_FAQS, PAYMENT_LABEL, PAYMENT_METHODS, POLICY_FIELDS, POLICY_LIMITS, type Policies, type PoliciesInput, type PolicyTextKey } from "@/lib/knowledge/policies";
import { fieldErrorMap } from "@/lib/knowledge/products";
import { OrderedList } from "./ordered-list";

export type FaqItem = { id: string; question: string; answer: string };

/** Knowledge base -> FAQs: questions in the owner's order (Members edit them too). */
export function FaqEditor({ faqs, canEdit }: { faqs: FaqItem[]; canEdit: boolean }) {
  const [editing, setEditing] = useState<FaqItem | "new" | null>(null);
  return (
    <section aria-labelledby="faqs" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="faqs" className="text-lg font-semibold tracking-[-0.02em]">
          Common questions
        </h2>
        {canEdit && (
          <Button size="sm" disabled={faqs.length >= MAX_FAQS} leading={<Plus aria-hidden className="size-4" />} onClick={() => setEditing("new")}>
            Add a question
          </Button>
        )}
      </div>
      {faqs.length === 0 ? (
        <GlassCard className="p-5 text-[15px] text-muted">The questions customers ask you most, with your answers. Your website chat answers from these, word for word, in the visitor&apos;s language.</GlassCard>
      ) : (
        <OrderedList
          items={faqs}
          label="Common questions"
          noun="question"
          title={(f) => f.question}
          canEdit={canEdit}
          onEdit={setEditing}
          onDelete={deleteFaq}
          onReorder={reorderFaqs}
          render={(f) => <p className="text-[15px] whitespace-pre-line text-muted">{f.answer}</p>}
        />
      )}
      {editing && <FaqDialog key={editing === "new" ? "new" : editing.id} faq={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </section>
  );
}

function FaqDialog({ faq, onClose }: { faq: FaqItem | null; onClose: () => void }) {
  const router = useRouter();
  const { toast } = useToast();
  const [values, setValues] = useState({ question: faq?.question ?? "", answer: faq?.answer ?? "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();

  function submit() {
    const check = faqInputSchema.safeParse(values);
    if (!check.success) return setErrors(fieldErrorMap(check.error));
    start(async () => {
      const result = faq ? await updateFaq(faq.id, values) : await createFaq(values);
      if (!result.ok) return setErrors(result.fieldErrors ?? { answer: result.error });
      toast(faq ? "Question saved." : "Question added.", "success");
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} title={faq ? "Edit question" : "Add a question"}>
      <form
        noValidate
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field label="Question" required error={errors.question}>
          <Input value={values.question} maxLength={FAQ_LIMITS.question} placeholder="Do you deliver on Sundays?" onChange={(e) => setValues((v) => ({ ...v, question: e.target.value }))} />
        </Field>
        <Field label="Answer" required error={errors.answer} hint="As you would answer a customer. The chat gives exactly this answer.">
          <Textarea rows={5} value={values.answer} maxLength={FAQ_LIMITS.answer} onChange={(e) => setValues((v) => ({ ...v, answer: e.target.value }))} />
        </Field>
        <div className="flex flex-wrap justify-end gap-3">
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {faq ? "Save question" : "Add question"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Knowledge base -> Policies: delivery, returns, payment, warranty, booking. Owners and admins edit them. */
export function PoliciesForm({ initial, canEdit }: { initial: Policies; canEdit: boolean }) {
  const router = useRouter();
  const { toast } = useToast();
  const [values, setValues] = useState({
    delivery: initial.delivery ?? "",
    returns: initial.returns ?? "",
    warranty: initial.warranty ?? "",
    booking: initial.booking ?? "",
    paymentNotes: initial.paymentNotes ?? "",
    paymentMethods: initial.paymentMethods as string[],
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();

  return (
    <GlassCard as="section" aria-labelledby="policies" className="flex flex-col gap-5 p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="policies" className="text-lg font-semibold tracking-[-0.02em]">
          Policies
        </h2>
        {!canEdit && (
          <span className="inline-flex items-center gap-1 text-[13px] text-muted">
            <Lock aria-hidden className="size-3.5" />
            Owners and admins edit these
          </span>
        )}
      </div>
      <p className="-mt-3 text-[14px] text-muted">Your website chat answers questions about these only from what you write here, and never promises more.</p>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-[14px] font-semibold">Payment methods you accept</legend>
        <div className="flex flex-wrap gap-2">
          {PAYMENT_METHODS.map((m) => {
            const on = values.paymentMethods.includes(m);
            return (
              <Chip
                key={m}
                selected={on}
                disabled={!canEdit}
                className="px-4 py-2"
                onClick={() => setValues((v) => ({ ...v, paymentMethods: on ? v.paymentMethods.filter((x) => x !== m) : [...v.paymentMethods, m] }))}
              >
                {PAYMENT_LABEL[m]}
              </Chip>
            );
          })}
        </div>
      </fieldset>
      <Field label="Payment notes (optional)" error={errors.paymentNotes} hint="For example: pay on delivery in Kigali, 50% deposit for custom orders.">
        <Input value={values.paymentNotes} disabled={!canEdit} maxLength={POLICY_LIMITS.paymentNotes} onChange={(e) => setValues((v) => ({ ...v, paymentNotes: e.target.value }))} />
      </Field>
      {POLICY_FIELDS.map((f) => (
        <Field key={f.key} label={`${f.label} (optional)`} hint={f.hint} error={errors[f.key]}>
          <Textarea rows={3} value={values[f.key as PolicyTextKey]} disabled={!canEdit} maxLength={POLICY_LIMITS.text} placeholder={f.placeholder} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))} />
        </Field>
      ))}
      {canEdit && (
        <Button
          className="self-start"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const result = await savePolicies(values as PoliciesInput);
              if (!result.ok) {
                setErrors(result.fieldErrors ?? {});
                toast(result.error, "error");
                return;
              }
              setErrors({});
              toast("Policies saved.", "success");
              router.refresh();
            })
          }
        >
          Save policies
        </Button>
      )}
    </GlassCard>
  );
}

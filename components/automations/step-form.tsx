"use client";

import { Plus, Trash2, X } from "lucide-react";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import {
  ACTION_KINDS,
  CHANNELS,
  COMMENT_CHANNELS,
  COMMENT_TRIGGERS,
  CONDITION_KINDS,
  NODE_LABELS,
  TRIGGER_KINDS,
  TRIGGER_LABELS,
  type Action,
  type ConditionRule,
  type GraphNode,
  type NodeOf,
  type NodeType,
} from "@/lib/automations/graph";
import { CHANNEL_LABELS } from "@/lib/inbox/labels";

const ACTION_LABELS: Record<(typeof ACTION_KINDS)[number], string> = {
  add_tag: "Add a tag",
  remove_tag: "Remove a tag",
  set_field: "Set a contact field",
  notify_team: "Alert the team",
  save_lead: "Save as a lead",
  subscribe_email: "Mark as agreeing to emails",
  unsubscribe: "Stop sending them broadcasts",
  webhook: "Send to webhook",
};
const CONDITION_LABELS: Record<(typeof CONDITION_KINDS)[number], string> = {
  has_tag: "Has the tag",
  no_tag: "Does not have the tag",
  field_equals: "A field equals",
  field_set: "A field is filled in",
  has_email: "We have their email",
  has_phone: "We have their phone",
  channel_is: "Came on the channel",
  text_contains: "Their last message contains",
};
const VARIABLES = "{{first_name}}, {{name}}, {{phone}}, {{email}}, {{business}}, {{field.key}}";

const uid = () => Math.random().toString(36).slice(2, 9);

/** A new step with sensible defaults, placed at `position`. */
export function newStep(type: NodeType, position: { x: number; y: number }): GraphNode {
  const id = `${type}-${uid()}`;
  switch (type) {
    case "message":
      return { id, type, position, data: { text: "", buttons: [] } };
    case "question":
      return { id, type, position, data: { text: "", saveTo: "phone", validate: "phone", retryText: "", timeoutMinutes: 0, quickReplies: [] } };
    case "ai":
      return { id, type, position, data: { goal: "", context: "", maxTurns: 3 } };
    case "condition":
      return { id, type, position, data: { rules: [{ kind: "has_phone", value: "", key: "" }], mode: "all" } };
    case "action":
      return { id, type, position, data: { actions: [{ kind: "add_tag", tag: "", key: "", value: "" }] } };
    case "wait":
      return { id, type, position, data: { minutes: 1440 } };
    case "handover":
      return { id, type, position, data: { text: "Someone from our team will answer you shortly.", note: "", pauseHours: 24 } };
    case "end":
      return { id, type, position, data: {} };
    case "trigger":
      return { id, type, position, data: { kind: "keyword", channels: ["WEBSITE"], keywords: [], match: "contains", postIds: [], publicReplies: [] } };
  }
}

type Props = { step: GraphNode; fields: { key: string; label: string }[]; tags: string[]; onChange: (step: GraphNode) => void; onDelete?: () => void };

export function StepForm({ step, fields, tags, onChange, onDelete }: Props) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-[16px] font-semibold">{NODE_LABELS[step.type]}</h2>
        {onDelete && (
          <Button size="sm" variant="outline" onClick={onDelete}>
            <Trash2 className="size-4" aria-hidden /> Delete step
          </Button>
        )}
      </div>
      {step.type === "trigger" && <TriggerForm step={step} onChange={onChange} />}
      {step.type === "message" && <MessageForm step={step} onChange={onChange} />}
      {step.type === "question" && <QuestionForm step={step} fields={fields} onChange={onChange} />}
      {step.type === "ai" && <AiForm step={step} onChange={onChange} />}
      {step.type === "condition" && <ConditionForm step={step} fields={fields} tags={tags} onChange={onChange} />}
      {step.type === "action" && <ActionForm step={step} fields={fields} tags={tags} onChange={onChange} />}
      {step.type === "wait" && <WaitForm step={step} onChange={onChange} />}
      {step.type === "handover" && <HandoverForm step={step} onChange={onChange} />}
      {step.type === "end" && <p className="text-[14px] text-muted">The automation stops here. The person can still write, and other automations or your team can answer.</p>}
      <datalist id="automation-tags">
        {tags.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
    </div>
  );
}

/** A list of short texts (keywords, quick replies, public replies) edited as one comma-separated line. */
function ListInput({ value, onChange, placeholder, label }: { value: string[]; onChange: (v: string[]) => void; placeholder: string; label: string }) {
  return (
    <Field label={label} hint="Separate with commas.">
      <Input defaultValue={value.join(", ")} placeholder={placeholder} onBlur={(e) => onChange(e.target.value.split(",").map((s) => s.trim()).filter(Boolean))} />
    </Field>
  );
}

function TriggerForm({ step, onChange }: { step: NodeOf<"trigger">; onChange: (s: GraphNode) => void }) {
  const d = step.data;
  const set = (data: Partial<typeof d>) => onChange({ ...step, data: { ...d, ...data } });
  const comment = COMMENT_TRIGGERS.includes(d.kind);
  const allowed = comment ? COMMENT_CHANNELS : d.kind === "story_mention" ? (["INSTAGRAM"] as const) : CHANNELS;
  return (
    <>
      <Field label="What starts it">
        <Select
          value={d.kind}
          onChange={(e) => {
            const kind = e.target.value as typeof d.kind;
            const c = COMMENT_TRIGGERS.includes(kind) ? d.channels.filter((x) => COMMENT_CHANNELS.includes(x)) : kind === "story_mention" ? d.channels.filter((x) => x === "INSTAGRAM") : d.channels;
            set({ kind, channels: c });
          }}
        >
          {TRIGGER_KINDS.map((k) => (
            <option key={k} value={k}>
              {TRIGGER_LABELS[k]}
            </option>
          ))}
        </Select>
      </Field>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1 text-[13px] font-medium">Channels</legend>
        {allowed.map((c) => (
          <label key={c} className="flex items-center gap-2 text-[14px]">
            <input type="checkbox" checked={d.channels.includes(c)} onChange={(e) => set({ channels: e.target.checked ? [...d.channels, c] : d.channels.filter((x) => x !== c) })} />
            {CHANNEL_LABELS[c]}
          </label>
        ))}
        {(d.channels.includes("WHATSAPP") || d.channels.includes("TELEGRAM")) && <p className="text-[12px] text-muted">WhatsApp and Telegram are coming: the automation is ready for them when they are connected.</p>}
      </fieldset>
      {(d.kind === "keyword" || d.kind === "comment_keyword") && (
        <>
          <ListInput label="Keywords" value={d.keywords} onChange={(keywords) => set({ keywords })} placeholder="price, igiciro, prix" />
          <Field label="Match">
            <Select value={d.match} onChange={(e) => set({ match: e.target.value as "contains" | "exact" })}>
              <option value="contains">The message contains the word</option>
              <option value="exact">The whole message is the word</option>
            </Select>
          </Field>
        </>
      )}
      {comment && (
        <>
          <ListInput label="Public replies under the comment (one is picked)" value={d.publicReplies} onChange={(publicReplies) => set({ publicReplies })} placeholder="Sent you a DM!, Check your DMs" />
          <ListInput label="Only these posts (post ids, empty = all posts)" value={d.postIds} onChange={(postIds) => set({ postIds })} placeholder="Leave empty for every post" />
          <p className="text-[12px] text-muted">The first message goes to their DMs as a private reply when your account allows it; otherwise it is posted as a reply under the comment.</p>
        </>
      )}
      {d.kind === "default_reply" && <p className="text-[12px] text-muted">Answers any message that no other automation answers. Use it for an AI conversation or a menu.</p>}
    </>
  );
}

function MessageForm({ step, onChange }: { step: NodeOf<"message">; onChange: (s: GraphNode) => void }) {
  const d = step.data;
  const set = (data: Partial<typeof d>) => onChange({ ...step, data: { ...d, ...data } });
  return (
    <>
      <Field label="Message" hint={`You can use ${VARIABLES}.`}>
        <Textarea rows={5} maxLength={1000} value={d.text} onChange={(e) => set({ text: e.target.value })} />
      </Field>
      <div className="flex flex-col gap-2">
        <span className="text-[13px] font-medium">Buttons (up to 3)</span>
        {d.buttons.map((b, i) => (
          <div key={b.id} className="flex flex-col gap-1.5 rounded-xl bg-soft p-2">
            <div className="flex gap-1.5">
              <Input value={b.title} maxLength={20} placeholder="Button text" aria-label={`Button ${i + 1} text`} onChange={(e) => set({ buttons: d.buttons.map((x) => (x.id === b.id ? { ...x, title: e.target.value } : x)) })} />
              <button type="button" aria-label={`Remove button ${i + 1}`} onClick={() => set({ buttons: d.buttons.filter((x) => x.id !== b.id) })} className="px-2 text-muted hover:text-text">
                <X className="size-4" aria-hidden />
              </button>
            </div>
            <Input value={b.url ?? ""} maxLength={500} placeholder="Link (optional): opens a page instead of a step" aria-label={`Button ${i + 1} link`} onChange={(e) => set({ buttons: d.buttons.map((x) => (x.id === b.id ? { ...x, url: e.target.value || undefined } : x)) })} />
          </div>
        ))}
        {d.buttons.length < 3 && (
          <Button size="sm" variant="outline" onClick={() => set({ buttons: [...d.buttons, { id: `b${uid()}`, title: "" }] })}>
            <Plus className="size-4" aria-hidden /> Add button
          </Button>
        )}
        <p className="text-[12px] text-muted">Each button without a link gets its own dot on the step: join it to the step that should follow. On channels without buttons, they are sent as a numbered list and people answer with the number.</p>
      </div>
    </>
  );
}

function QuestionForm({ step, fields, onChange }: { step: NodeOf<"question">; fields: { key: string; label: string }[]; onChange: (s: GraphNode) => void }) {
  const d = step.data;
  const set = (data: Partial<typeof d>) => onChange({ ...step, data: { ...d, ...data } });
  return (
    <>
      <Field label="Question" hint={`You can use ${VARIABLES}.`}>
        <Textarea rows={3} maxLength={1000} value={d.text} onChange={(e) => set({ text: e.target.value })} />
      </Field>
      <Field label="Save the answer as">
        <Select
          value={d.saveTo === "field" ? `field:${d.fieldKey ?? ""}` : d.saveTo}
          onChange={(e) => {
            const v = e.target.value;
            if (v.startsWith("field:")) set({ saveTo: "field", fieldKey: v.slice(6) || undefined, validate: d.validate === "email" || d.validate === "phone" ? "any" : d.validate });
            else set({ saveTo: v as "name" | "email" | "phone", fieldKey: undefined, validate: v === "email" ? "email" : v === "phone" ? "phone" : "any" });
          }}
        >
          <option value="name">Their name</option>
          <option value="phone">Their phone number</option>
          <option value="email">Their email</option>
          {fields.map((f) => (
            <option key={f.key} value={`field:${f.key}`}>
              Field: {f.label}
            </option>
          ))}
          {!fields.length && <option value="field:">A contact field (add fields in Contacts)</option>}
        </Select>
      </Field>
      <Field label="Check the answer">
        <Select value={d.validate} onChange={(e) => set({ validate: e.target.value as typeof d.validate })}>
          <option value="any">Any answer</option>
          <option value="phone">A phone number</option>
          <option value="email">An email address</option>
          <option value="number">A number</option>
        </Select>
      </Field>
      <Field label="If the answer is not right, say" hint="Asked again up to twice.">
        <Input maxLength={300} value={d.retryText} placeholder="Sorry, I did not get that. Could you try again?" onChange={(e) => set({ retryText: e.target.value })} />
      </Field>
      <ListInput label="Quick answers (optional)" value={d.quickReplies} onChange={(quickReplies) => set({ quickReplies })} placeholder="Small, Medium, Large" />
      <Field label="If nobody answers" hint="With a time, a “No answer” dot appears on the step.">
        <Select value={String(d.timeoutMinutes)} onChange={(e) => set({ timeoutMinutes: Number(e.target.value) })}>
          <option value="0">Keep waiting</option>
          <option value="60">After 1 hour, follow “No answer”</option>
          <option value="360">After 6 hours, follow “No answer”</option>
          <option value="1440">After 1 day, follow “No answer”</option>
          <option value="4320">After 3 days, follow “No answer”</option>
        </Select>
      </Field>
    </>
  );
}

function AiForm({ step, onChange }: { step: NodeOf<"ai">; onChange: (s: GraphNode) => void }) {
  const d = step.data;
  const set = (data: Partial<typeof d>) => onChange({ ...step, data: { ...d, ...data } });
  return (
    <>
      <p className="text-[13px] text-muted">The AI answers from your knowledge base (products, prices, FAQs, opening hours) and works towards your goal. Each AI reply uses one chat reply of your plan.</p>
      <Field label="Goal of the conversation">
        <Textarea rows={3} maxLength={500} value={d.goal} placeholder="Find out which size they need, give the price and get their phone number." onChange={(e) => set({ goal: e.target.value })} />
      </Field>
      <Field label="Extra facts for this step (optional)">
        <Textarea rows={4} maxLength={4000} value={d.context} placeholder="This week: 10% off all dresses. Delivery in Kigali is free over 50,000 RWF." onChange={(e) => set({ context: e.target.value })} />
      </Field>
      <Field label="At most this many AI replies, then continue along “Done”">
        <Select value={String(d.maxTurns)} onChange={(e) => set({ maxTurns: Number(e.target.value) })}>
          {[1, 2, 3, 4, 5, 6, 8, 10].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </Select>
      </Field>
    </>
  );
}

function RuleRow({ rule, fields, tags, onChange, onRemove }: { rule: ConditionRule; fields: { key: string; label: string }[]; tags: string[]; onChange: (r: ConditionRule) => void; onRemove?: () => void }) {
  const needsTag = rule.kind === "has_tag" || rule.kind === "no_tag";
  const needsField = rule.kind === "field_equals" || rule.kind === "field_set";
  return (
    <div className="flex flex-col gap-1.5 rounded-xl bg-soft p-2">
      <div className="flex gap-1.5">
        <Select aria-label="Rule" value={rule.kind} onChange={(e) => onChange({ ...rule, kind: e.target.value as ConditionRule["kind"] })}>
          {CONDITION_KINDS.map((k) => (
            <option key={k} value={k}>
              {CONDITION_LABELS[k]}
            </option>
          ))}
        </Select>
        {onRemove && (
          <button type="button" aria-label="Remove rule" onClick={onRemove} className="px-2 text-muted hover:text-text">
            <X className="size-4" aria-hidden />
          </button>
        )}
      </div>
      {needsTag && <Input aria-label="Tag" list="automation-tags" value={rule.value} maxLength={40} placeholder="Tag" onChange={(e) => onChange({ ...rule, value: e.target.value })} />}
      {needsField && (
        <Select aria-label="Field" value={rule.key} onChange={(e) => onChange({ ...rule, key: e.target.value })}>
          <option value="">Choose a field</option>
          {fields.map((f) => (
            <option key={f.key} value={f.key}>
              {f.label}
            </option>
          ))}
        </Select>
      )}
      {(rule.kind === "field_equals" || rule.kind === "text_contains") && <Input aria-label="Value" value={rule.value} maxLength={120} placeholder="Value" onChange={(e) => onChange({ ...rule, value: e.target.value })} />}
      {rule.kind === "channel_is" && (
        <Select aria-label="Channel" value={rule.value} onChange={(e) => onChange({ ...rule, value: e.target.value })}>
          <option value="">Choose a channel</option>
          {CHANNELS.map((c) => (
            <option key={c} value={c}>
              {CHANNEL_LABELS[c]}
            </option>
          ))}
        </Select>
      )}
      {tags.length === 0 && needsTag && <span className="text-[12px] text-muted">Type a tag; it is created when an automation first adds it.</span>}
    </div>
  );
}

function ConditionForm({ step, fields, tags, onChange }: { step: NodeOf<"condition">; fields: { key: string; label: string }[]; tags: string[]; onChange: (s: GraphNode) => void }) {
  const d = step.data;
  const set = (data: Partial<typeof d>) => onChange({ ...step, data: { ...d, ...data } });
  return (
    <>
      <Field label="Go along “Yes” when">
        <Select value={d.mode} onChange={(e) => set({ mode: e.target.value as "all" | "any" })}>
          <option value="all">All the rules match</option>
          <option value="any">Any one rule matches</option>
        </Select>
      </Field>
      {d.rules.map((r, i) => (
        <RuleRow key={i} rule={r} fields={fields} tags={tags} onChange={(rule) => set({ rules: d.rules.map((x, j) => (j === i ? rule : x)) })} onRemove={d.rules.length > 1 ? () => set({ rules: d.rules.filter((_, j) => j !== i) }) : undefined} />
      ))}
      {d.rules.length < 10 && (
        <Button size="sm" variant="outline" onClick={() => set({ rules: [...d.rules, { kind: "has_tag", value: "", key: "" }] })}>
          <Plus className="size-4" aria-hidden /> Add rule
        </Button>
      )}
    </>
  );
}

function ActionForm({ step, fields, tags, onChange }: { step: NodeOf<"action">; fields: { key: string; label: string }[]; tags: string[]; onChange: (s: GraphNode) => void }) {
  const d = step.data;
  const setAt = (i: number, a: Action) => onChange({ ...step, data: { actions: d.actions.map((x, j) => (j === i ? a : x)) } });
  void tags;
  return (
    <>
      {d.actions.map((a, i) => (
        <div key={i} className="flex flex-col gap-1.5 rounded-xl bg-soft p-2">
          <div className="flex gap-1.5">
            <Select aria-label="Action" value={a.kind} onChange={(e) => setAt(i, { ...a, kind: e.target.value as Action["kind"] })}>
              {ACTION_KINDS.map((k) => (
                <option key={k} value={k}>
                  {ACTION_LABELS[k]}
                </option>
              ))}
            </Select>
            {d.actions.length > 1 && (
              <button type="button" aria-label="Remove action" onClick={() => onChange({ ...step, data: { actions: d.actions.filter((_, j) => j !== i) } })} className="px-2 text-muted hover:text-text">
                <X className="size-4" aria-hidden />
              </button>
            )}
          </div>
          {(a.kind === "add_tag" || a.kind === "remove_tag") && <Input aria-label="Tag" list="automation-tags" value={a.tag} maxLength={40} placeholder="Tag, e.g. Wants to order" onChange={(e) => setAt(i, { ...a, tag: e.target.value })} />}
          {a.kind === "set_field" && (
            <>
              <Select aria-label="Field" value={a.key} onChange={(e) => setAt(i, { ...a, key: e.target.value })}>
                <option value="">Choose a field</option>
                {fields.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label}
                  </option>
                ))}
              </Select>
              <Input aria-label="Value" value={a.value} maxLength={500} placeholder="Value" onChange={(e) => setAt(i, { ...a, value: e.target.value })} />
            </>
          )}
          {a.kind === "notify_team" && <Input aria-label="Alert text" value={a.value} maxLength={500} placeholder="What should the team do?" onChange={(e) => setAt(i, { ...a, value: e.target.value })} />}
          {a.kind === "save_lead" && <Input aria-label="Interest" value={a.value} maxLength={200} placeholder="What they want, e.g. Order from a comment" onChange={(e) => setAt(i, { ...a, value: e.target.value })} />}
          {a.kind === "webhook" && <Input aria-label="Value sent" value={a.value} maxLength={500} placeholder="A label your other tool receives" onChange={(e) => setAt(i, { ...a, value: e.target.value })} />}
          {a.kind === "save_lead" && <span className="text-[12px] text-muted">Saved when we have their phone or email, at most once a day, with the usual new-lead alerts.</span>}
          {a.kind === "webhook" && <span className="text-[12px] text-muted">Sent as “automation.action” to the webhooks you set up in Connectors.</span>}
        </div>
      ))}
      {d.actions.length < 10 && (
        <Button size="sm" variant="outline" onClick={() => onChange({ ...step, data: { actions: [...d.actions, { kind: "add_tag", tag: "", key: "", value: "" }] } })}>
          <Plus className="size-4" aria-hidden /> Add action
        </Button>
      )}
    </>
  );
}

function WaitForm({ step, onChange }: { step: NodeOf<"wait">; onChange: (s: GraphNode) => void }) {
  const unit = step.data.minutes % 1440 === 0 ? 1440 : step.data.minutes % 60 === 0 ? 60 : 1;
  return (
    <div className="flex gap-2">
      <Field label="Wait">
        <Input type="number" min={1} max={unit === 1440 ? 30 : unit === 60 ? 720 : 43200} value={step.data.minutes / unit} onChange={(e) => onChange({ ...step, data: { minutes: Math.max(1, Math.round(Number(e.target.value) || 1)) * unit } })} />
      </Field>
      <Field label="Unit">
        <Select value={String(unit)} onChange={(e) => onChange({ ...step, data: { minutes: Math.max(1, Math.round(step.data.minutes / unit)) * Number(e.target.value) } })}>
          <option value="1">Minutes</option>
          <option value="60">Hours</option>
          <option value="1440">Days</option>
        </Select>
      </Field>
    </div>
  );
}

function HandoverForm({ step, onChange }: { step: NodeOf<"handover">; onChange: (s: GraphNode) => void }) {
  const d = step.data;
  const set = (data: Partial<typeof d>) => onChange({ ...step, data: { ...d, ...data } });
  return (
    <>
      <Field label="Message to the person (optional)">
        <Input maxLength={500} value={d.text} onChange={(e) => set({ text: e.target.value })} />
      </Field>
      <Field label="Note for your team">
        <Input maxLength={300} value={d.note} placeholder="Wants a quote for 3 dresses" onChange={(e) => set({ note: e.target.value })} />
      </Field>
      <Field label="Automations stay quiet in this conversation for">
        <Select value={String(d.pauseHours)} onChange={(e) => set({ pauseHours: Number(e.target.value) })}>
          <option value="4">4 hours</option>
          <option value="12">12 hours</option>
          <option value="24">1 day</option>
          <option value="72">3 days</option>
          <option value="168">1 week</option>
        </Select>
      </Field>
      <p className="text-[12px] text-muted">The team gets an email and a phone alert, and the conversation waits in the Inbox.</p>
    </>
  );
}

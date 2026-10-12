"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Button, Field, Input, Textarea } from "@/components/ui";
import { notice } from "@/components/admin/ui";
import { saveIndustryAction, type IndustryFormState } from "@/app/admin/(console)/industries/actions";

export type IndustryFormValues = {
  id?: string | null;
  name: string;
  slug: string;
  shortDescription: string;
  customers: string;
  offerings: string;
  postIdeas: string;
  tone: string;
  hashtags: string[];
  seasons: string;
  avoid: string;
  active: boolean;
  sortOrder: number;
};

export const EMPTY_INDUSTRY: IndustryFormValues = { name: "", slug: "", shortDescription: "", customers: "", offerings: "", postIdeas: "", tone: "", hashtags: [], seasons: "", avoid: "", active: true, sortOrder: 50 };

const EXAMPLES = {
  shortDescription: "One sentence a client recognises themselves in. Example: Shops and boutiques selling everyday goods, fashion and gifts, in person and through WhatsApp.",
  customers: "Who buys, where, when. Example: Families and young professionals in Kigali; shoppers who browse on Instagram and order by WhatsApp; month-end buyers.",
  offerings: "What this kind of business typically sells. Example: Kitenge fashion, shoes and bags, home goods, gifts; moto delivery in Kigali; MoMo and card in store.",
  postIdeas: "Recommended. Formats that work for this sector. Example: New arrivals with real photos; back in stock; weekend deals; one product, three ways to wear it; how to order on WhatsApp.",
  tone: "How posts should sound. Example: Warm, friendly and concrete. Short sentences, a clear price when given, one call to action.",
  hashtags: "Recommended. Comma or space separated. Example: #Kigali #Rwanda #MadeInRwanda #KigaliShopping",
  seasons: "Recommended. Rwanda and East Africa dates that matter here. Example: Month-end (25th to 5th); Christmas and New Year; back-to-school in September and January; Umuganura (first Friday of August); Kwibohora (4 July); no promotions during Kwibuka (7 to 13 April); rainy seasons March to May and October to December.",
  avoid: "Recommended. Claims, words and compliance notes. Example: Never invent prices or stock; no \"cheapest in Kigali\"; single-use plastic bags are banned; every sale needs an EBM receipt.",
};

/**
 * Create / edit form for one industry. Posts to saveIndustryAction (AAL2 re-checked there, audited). With
 * `suggestion` the industry is created from a sign-up suggestion and the matching companies move to it on save.
 */
export function IndustryForm({ initial, suggestion }: { initial: IndustryFormValues; suggestion?: { key: string; label: string; count: number } | null }) {
  const [state, action, pending] = useActionState<IndustryFormState, FormData>(saveIndustryAction, {});
  const editing = Boolean(initial.id);
  return (
    <form action={action} className="flex flex-col gap-4">
      {initial.id && <input type="hidden" name="id" value={initial.id} />}
      {suggestion && <input type="hidden" name="suggestionKey" value={suggestion.key} />}
      {state.error && <p role="alert" className={notice.bad}>{state.error}</p>}
      {suggestion && (
        <p className="rounded-2xl bg-soft px-4 py-3 text-sm">
          From sign-ups: <strong>{suggestion.count}</strong> {suggestion.count === 1 ? "company wrote" : "companies wrote"} &ldquo;{suggestion.label}&rdquo;. Saving creates the industry and moves {suggestion.count === 1 ? "that company" : "those companies"} to it (audited).
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr]">
        <Field label="Name" required hint="As clients see it in the sign-up list, 2 to 60 characters.">
          <Input name="name" defaultValue={initial.name} required maxLength={60} />
        </Field>
        <Field label="Slug" hint={editing ? "Stable form value; changing it is safe (companies link by id)." : "Left empty: made from the name."}>
          <Input name="slug" defaultValue={initial.slug} maxLength={60} placeholder="car-wash" className="font-mono text-[14px]" />
        </Field>
        <Field label="Order" hint="Lower comes first in the list.">
          <Input name="sortOrder" type="number" defaultValue={initial.sortOrder} min={-1000} max={1000} />
        </Field>
      </div>
      <Field label="Short description" required hint={EXAMPLES.shortDescription}>
        <Textarea name="shortDescription" defaultValue={initial.shortDescription} rows={2} maxLength={200} required />
      </Field>
      <Field label="Typical customers" required hint={EXAMPLES.customers}>
        <Textarea name="customers" defaultValue={initial.customers} rows={3} maxLength={600} required />
      </Field>
      <Field label="Products and services" required hint={EXAMPLES.offerings}>
        <Textarea name="offerings" defaultValue={initial.offerings} rows={3} maxLength={600} required />
      </Field>
      <Field label="Good post ideas" hint={EXAMPLES.postIdeas}>
        <Textarea name="postIdeas" defaultValue={initial.postIdeas} rows={4} maxLength={1200} />
      </Field>
      <Field label="Tone of voice" required hint={EXAMPLES.tone}>
        <Textarea name="tone" defaultValue={initial.tone} rows={2} maxLength={300} required />
      </Field>
      <Field label="Useful hashtags" hint={EXAMPLES.hashtags}>
        <Input name="hashtags" defaultValue={initial.hashtags.join(" ")} />
      </Field>
      <Field label="Important dates and seasons in Rwanda and East Africa" hint={EXAMPLES.seasons}>
        <Textarea name="seasons" defaultValue={initial.seasons} rows={4} maxLength={1500} />
      </Field>
      <Field label="Words or claims to avoid" hint={EXAMPLES.avoid}>
        <Textarea name="avoid" defaultValue={initial.avoid} rows={4} maxLength={1200} />
      </Field>
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input type="checkbox" name="active" defaultChecked={initial.active} className="size-4" /> Offered at sign-up (active)
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : editing ? "Save industry" : suggestion ? "Create and move companies" : "Create industry"}
        </Button>
        <Link href="/admin/industries" className="inline-flex min-h-11 items-center text-sm font-medium underline">
          Cancel
        </Link>
      </div>
    </form>
  );
}

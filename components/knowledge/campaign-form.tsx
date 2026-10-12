"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, Gift, Megaphone, Rocket, Sparkles, type LucideIcon } from "lucide-react";
import { Button, Chip, Field, GlassCard, Input, Select, Textarea, useToast } from "@/components/ui";
import { createCampaign, updateCampaign } from "@/app/dashboard/knowledge/campaigns/actions";
import { CAMPAIGN_LIMITS, CAMPAIGN_TYPE_OPTIONS, campaignInputSchema, MAX_CAMPAIGN_PRODUCTS, MAX_HIGHLIGHTS, type CampaignFormValues, type CampaignTypeValue } from "@/lib/knowledge/campaigns";
import { fieldErrorMap, ITEM_STATUSES, STATUS_LABEL } from "@/lib/knowledge/products";
import { ListField } from "./list-field";

const TYPE_ICONS: Record<CampaignTypeValue, LucideIcon> = { EVENT: CalendarDays, OFFER: Gift, PROMOTION: Megaphone, LAUNCH: Rocket, OTHER: Sparkles };

/** Create or edit a campaign. Checked in the browser with the server's schema; the server checks again. */
export function CampaignForm({ campaignId, initial, products }: { campaignId?: string; initial: CampaignFormValues; products: { id: string; name: string }[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [pending, start] = useTransition();
  const option = CAMPAIGN_TYPE_OPTIONS.find((t) => t.value === values.type) ?? CAMPAIGN_TYPE_OPTIONS[0];
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? products.filter((p) => p.name.toLowerCase().includes(q) || values.productIds.includes(p.id)) : products;
  }, [filter, products, values.productIds]);

  function set<K extends keyof CampaignFormValues>(key: K, value: CampaignFormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: "" }));
  }

  function toggleProduct(id: string) {
    set("productIds", values.productIds.includes(id) ? values.productIds.filter((x) => x !== id) : values.productIds.length < MAX_CAMPAIGN_PRODUCTS ? [...values.productIds, id] : values.productIds);
  }

  function submit() {
    setFormError(null);
    const check = campaignInputSchema.safeParse(values);
    if (!check.success) {
      setErrors(fieldErrorMap(check.error));
      setFormError("Check the highlighted fields.");
      requestAnimationFrame(() => document.querySelector<HTMLElement>("[aria-invalid=true]")?.focus());
      return;
    }
    start(async () => {
      const result = campaignId ? await updateCampaign(campaignId, values) : await createCampaign(values);
      if (result.ok) {
        toast(campaignId ? "Saved." : "Campaign added.", "success");
        router.push(`/dashboard/knowledge/campaigns/${result.campaignId}`);
        return;
      }
      if (result.fieldErrors) setErrors(result.fieldErrors);
      setFormError(result.error);
    });
  }

  return (
    <form
      noValidate
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <GlassCard as="fieldset" className="flex flex-col gap-3 p-5 sm:p-6">
        <legend className="mb-1 text-lg font-semibold tracking-[-0.02em]">
          What kind of campaign?<span aria-hidden className="ml-0.5 text-pulse-violet">*</span>
        </legend>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Campaign type">
          {CAMPAIGN_TYPE_OPTIONS.map((t) => {
            const Icon = TYPE_ICONS[t.value];
            return (
              <Chip key={t.value} selected={values.type === t.value} onClick={() => set("type", t.value)} icon={<Icon aria-hidden className="size-4" />} className="px-4 py-2.5">
                {t.label}
              </Chip>
            );
          })}
        </div>
        <p className="text-[13px] text-muted">{option.hint}</p>
      </GlassCard>

      <GlassCard as="section" aria-labelledby="campaign-about" className="flex flex-col gap-5 p-5 sm:p-6">
        <h2 id="campaign-about" className="text-lg font-semibold tracking-[-0.02em]">
          About it
        </h2>
        <Field label="Name" required error={errors.name}>
          <Input value={values.name} maxLength={CAMPAIGN_LIMITS.name} placeholder={option.namePlaceholder} onChange={(e) => set("name", e.target.value)} />
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Starts" required={values.type === "EVENT"} error={errors.startsOn} hint={values.type === "EVENT" ? "The day of the event." : "Optional."}>
            <Input type="date" value={values.startsOn} onChange={(e) => set("startsOn", e.target.value)} />
          </Field>
          <Field label="Ends" error={errors.endsOn} hint="Optional. Leave empty for a single day or no end.">
            <Input type="date" value={values.endsOn} min={values.startsOn || undefined} onChange={(e) => set("endsOn", e.target.value)} />
          </Field>
        </div>
        <Field label="Price or discount" error={errors.priceInfo} hint="Exactly as customers should read it. BuPulse never invents one.">
          <Input value={values.priceInfo} maxLength={CAMPAIGN_LIMITS.priceInfo} placeholder={option.pricePlaceholder} onChange={(e) => set("priceInfo", e.target.value)} />
        </Field>
        <ListField label="Highlights" items={values.highlights} onChange={(v) => set("highlights", v)} max={MAX_HIGHLIGHTS} each={CAMPAIGN_LIMITS.highlight} placeholder="Live music from 6 pm" hint="Short points people should know. Press Enter to add each." error={errors.highlights} />
        <Field label="Description" error={errors.description} hint="Where, who it is for, how to join or claim it, any conditions.">
          <Textarea rows={5} value={values.description} maxLength={CAMPAIGN_LIMITS.description} onChange={(e) => set("description", e.target.value)} />
        </Field>
      </GlassCard>

      <GlassCard as="section" aria-labelledby="campaign-products" className="flex flex-col gap-3 p-5 sm:p-6">
        <div className="flex flex-col gap-1">
          <h2 id="campaign-products" className="text-lg font-semibold tracking-[-0.02em]">
            Products in this campaign
          </h2>
          <p className="text-[14px] text-muted">Optional. Their details and photos are used in the campaign&apos;s posts. {values.productIds.length} chosen.</p>
        </div>
        {products.length === 0 ? (
          <p className="text-[14px] text-muted">You have no products yet. Add them under Products & services, then link them here.</p>
        ) : (
          <>
            {products.length > 8 && <Input type="search" aria-label="Find a product" placeholder="Find a product" value={filter} onChange={(e) => setFilter(e.target.value)} />}
            <div className="flex max-h-72 flex-wrap gap-2 overflow-y-auto" role="group" aria-label="Linked products">
              {shown.map((p) => (
                <Chip key={p.id} selected={values.productIds.includes(p.id)} onClick={() => toggleProduct(p.id)} className="px-4 py-2 text-[14px]">
                  {p.name}
                </Chip>
              ))}
            </div>
            {errors.productIds && (
              <p role="alert" className="text-[13px] font-medium text-danger">
                {errors.productIds}
              </p>
            )}
          </>
        )}
      </GlassCard>

      <GlassCard as="section" aria-label="Status" className="p-5 sm:p-6">
        <Field label="Status" hint="Drafts are kept out of Autopilot and the chat assistant until you make them active.">
          <Select value={values.status} onChange={(e) => set("status", e.target.value as CampaignFormValues["status"])}>
            {ITEM_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
        </Field>
      </GlassCard>

      {formError && (
        <p role="alert" className="rounded-2xl bg-danger-bg px-4 py-3 text-[14px] font-medium text-danger">
          {formError}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : campaignId ? "Save changes" : "Add campaign"}
        </Button>
        <Button variant="outline" href={campaignId ? `/dashboard/knowledge/campaigns/${campaignId}` : "/dashboard/knowledge/campaigns"}>
          Cancel
        </Button>
      </div>
      <p className="text-[13px] text-muted">Fields marked * are required.</p>
    </form>
  );
}

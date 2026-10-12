"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MonitorSmartphone, Package, Wrench, type LucideIcon } from "lucide-react";
import { Button, Chip, Field, GlassCard, Input, Select, Textarea, useToast } from "@/components/ui";
import { createProduct, updateProduct } from "@/app/dashboard/knowledge/products/actions";
import {
  ACCESS_LABEL,
  ACCESS_METHODS,
  CONDITION_LABEL,
  CONDITIONS,
  CURRENCIES,
  fieldErrorMap,
  KIND_OPTIONS,
  LIMITS,
  MAX_FEATURES,
  MAX_USPS,
  MAX_VARIANTS,
  PLACE_LABEL,
  PRICE_MODEL_OPTIONS,
  productInputSchema,
  SERVICE_PLACES,
  STATUS_LABEL,
  ITEM_STATUSES,
  type ProductFormValues,
  type ProductInput,
  type ProductKindValue,
} from "@/lib/knowledge/products";
import { ListField } from "./list-field";

const KIND_ICONS: Record<ProductKindValue, LucideIcon> = { PHYSICAL: Package, DIGITAL: MonitorSmartphone, SERVICE: Wrench };

/** Create or edit a product or service. Checked in the browser with the server's schema; the server checks again. */
export function ProductForm({ productId, initial }: { productId?: string; initial: ProductFormValues }) {
  const router = useRouter();
  const { toast } = useToast();
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const option = KIND_OPTIONS.find((k) => k.value === values.kind) ?? KIND_OPTIONS[0];
  const details = values.details;
  const currencies = [...new Set([initial.currency, ...CURRENCIES])];

  function set<K extends keyof ProductFormValues>(key: K, value: ProductFormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: "" }));
  }
  function setDetail(key: string, value: unknown) {
    setValues((v) => ({ ...v, details: { ...v.details, [key]: value } }));
    if (errors[`details.${key}`]) setErrors((e) => ({ ...e, [`details.${key}`]: "" }));
  }
  const list = (key: string) => (Array.isArray(details[key]) ? (details[key] as string[]) : []);
  const str = (key: string) => (typeof details[key] === "string" ? (details[key] as string) : "");
  const toggle = (key: string, value: string) => setDetail(key, list(key).includes(value) ? list(key).filter((x) => x !== value) : [...list(key), value]);

  function payload() {
    // Only the fields of the chosen kind are sent.
    const d = values.details;
    const kindDetails =
      values.kind === "PHYSICAL"
        ? { variants: list("variants"), condition: str("condition") || null, delivery: str("delivery"), warranty: str("warranty") }
        : values.kind === "DIGITAL"
          ? { access: list("access"), platform: str("platform"), licence: str("licence"), trial: d.trial === true }
          : { duration: str("duration"), places: list("places"), bookingNeeded: d.bookingNeeded === true };
    return { ...values, details: kindDetails };
  }

  function submit() {
    setFormError(null);
    const body = payload();
    const check = productInputSchema.safeParse(body);
    if (!check.success) {
      setErrors(fieldErrorMap(check.error));
      setFormError("Check the highlighted fields.");
      requestAnimationFrame(() => document.querySelector<HTMLElement>("[aria-invalid=true]")?.focus());
      return;
    }
    start(async () => {
      const result = productId ? await updateProduct(productId, body as ProductInput) : await createProduct(body as ProductInput);
      if (result.ok) {
        toast(productId ? "Saved." : "Added. Now add some photos.", "success");
        router.push(`/dashboard/knowledge/products/${result.productId}`);
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
          What is it?<span aria-hidden className="ml-0.5 text-pulse-violet">*</span>
        </legend>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Kind">
          {KIND_OPTIONS.map((k) => {
            const Icon = KIND_ICONS[k.value];
            return (
              <Chip key={k.value} selected={values.kind === k.value} onClick={() => set("kind", k.value)} icon={<Icon aria-hidden className="size-4" />} className="px-4 py-2.5">
                {k.label}
              </Chip>
            );
          })}
        </div>
        <p className="text-[13px] text-muted">{option.hint}</p>
      </GlassCard>

      <GlassCard as="section" aria-labelledby="product-about" className="flex flex-col gap-5 p-5 sm:p-6">
        <h2 id="product-about" className="text-lg font-semibold tracking-[-0.02em]">
          About it
        </h2>
        <div className="grid gap-5 sm:grid-cols-[2fr_1fr]">
          <Field label="Name" required error={errors.name}>
            <Input value={values.name} maxLength={LIMITS.name} placeholder={option.namePlaceholder} onChange={(e) => set("name", e.target.value)} />
          </Field>
          <Field label="Category" error={errors.category} hint="Helps group your list.">
            <Input value={values.category} maxLength={LIMITS.category} placeholder={option.categoryPlaceholder} onChange={(e) => set("category", e.target.value)} />
          </Field>
        </div>
        <Field label="Short description" required error={errors.summary} hint="One or two sentences a customer understands at a glance.">
          <Textarea rows={2} value={values.summary} maxLength={LIMITS.summary} placeholder={option.summaryPlaceholder} onChange={(e) => set("summary", e.target.value)} />
        </Field>
        <ListField
          label="Why customers choose it"
          required
          items={values.usps}
          onChange={(v) => set("usps", v)}
          max={MAX_USPS}
          placeholder={option.uspPlaceholder}
          hint="What makes it better or different. At least one; press Enter to add each."
          error={errors.usps}
        />
        <ListField label="Key features" items={values.features} onChange={(v) => set("features", v)} max={MAX_FEATURES} placeholder={option.featurePlaceholder} hint="Facts: sizes, materials, what is included." error={errors.features} />
        <Field label="Who it is for" error={errors.targetCustomer} hint="E.g. “Young families in Kigali”, “Small shops that sell on WhatsApp”.">
          <Input value={values.targetCustomer} maxLength={LIMITS.targetCustomer} onChange={(e) => set("targetCustomer", e.target.value)} />
        </Field>
        <Field label="Full description" error={errors.description} hint="Optional. Anything else the writer should know: how it is made, how to order, what customers say.">
          <Textarea rows={5} value={values.description} maxLength={LIMITS.description} onChange={(e) => set("description", e.target.value)} />
        </Field>
      </GlassCard>

      <GlassCard as="section" aria-labelledby="product-price" className="flex flex-col gap-5 p-5 sm:p-6">
        <h2 id="product-price" className="text-lg font-semibold tracking-[-0.02em]">
          Price
        </h2>
        <div className="grid gap-5 sm:grid-cols-3">
          <Field label="How it is priced" required error={errors.priceModel} hint={PRICE_MODEL_OPTIONS.find((p) => p.value === values.priceModel)?.hint}>
            <Select value={values.priceModel} onChange={(e) => set("priceModel", e.target.value as ProductFormValues["priceModel"])}>
              {PRICE_MODEL_OPTIONS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </Select>
          </Field>
          {values.priceModel !== "ON_REQUEST" && (
            <>
              <Field label="Price" required error={errors.price} hint="Numbers only, e.g. 15000.">
                <Input inputMode="decimal" value={values.price} maxLength={20} placeholder="15000" onChange={(e) => set("price", e.target.value)} />
              </Field>
              <Field label="Currency" error={errors.currency}>
                <Select value={values.currency} onChange={(e) => set("currency", e.target.value)}>
                  {currencies.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
              </Field>
            </>
          )}
        </div>
        <Field label="Price note" error={errors.priceNote} hint="Optional, e.g. “Discount from 3 pieces”, “Delivery included in Kigali”, “per kilo”.">
          <Input value={values.priceNote} maxLength={LIMITS.priceNote} onChange={(e) => set("priceNote", e.target.value)} />
        </Field>
      </GlassCard>

      <GlassCard as="section" aria-labelledby="product-kind" className="flex flex-col gap-5 p-5 sm:p-6">
        <h2 id="product-kind" className="text-lg font-semibold tracking-[-0.02em]">
          {values.kind === "PHYSICAL" ? "Stock and delivery" : values.kind === "DIGITAL" ? "Access" : "How it works"}
        </h2>
        {values.kind === "PHYSICAL" && (
          <>
            <ListField label="Variants" items={list("variants")} onChange={(v) => setDetail("variants", v)} max={MAX_VARIANTS} each={LIMITS.variant} placeholder="Size M, blue: 4 in stock" hint="Sizes, colours, flavours, with stock if you like." error={errors["details.variants"]} />
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-[15px] font-medium">Condition</legend>
              <div className="flex flex-wrap gap-2">
                {CONDITIONS.map((c) => (
                  <Chip key={c} selected={str("condition") === c} onClick={() => setDetail("condition", str("condition") === c ? null : c)} className="px-4 py-2">
                    {CONDITION_LABEL[c]}
                  </Chip>
                ))}
              </div>
            </fieldset>
            <Field label="Delivery options and areas" error={errors["details.delivery"]} hint="E.g. “Moto delivery in Kigali the same day, 2,000 RWF; bus to other towns”.">
              <Textarea rows={3} value={str("delivery")} maxLength={LIMITS.delivery} onChange={(e) => setDetail("delivery", e.target.value)} />
            </Field>
            <Field label="Warranty" error={errors["details.warranty"]} hint="E.g. “6 months on parts”. Leave empty if none.">
              <Input value={str("warranty")} maxLength={LIMITS.warranty} onChange={(e) => setDetail("warranty", e.target.value)} />
            </Field>
          </>
        )}
        {values.kind === "DIGITAL" && (
          <>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-[15px] font-medium">How customers get it</legend>
              <div className="flex flex-wrap gap-2">
                {ACCESS_METHODS.map((a) => (
                  <Chip key={a} selected={list("access").includes(a)} onClick={() => toggle("access", a)} className="px-4 py-2">
                    {ACCESS_LABEL[a]}
                  </Chip>
                ))}
              </div>
            </fieldset>
            <Field label="Platform and requirements" error={errors["details.platform"]} hint="E.g. “Android 9 or later, works in any browser”.">
              <Input value={str("platform")} maxLength={LIMITS.platform} onChange={(e) => setDetail("platform", e.target.value)} />
            </Field>
            <Field label="Licence or subscription terms" error={errors["details.licence"]} hint="E.g. “Monthly, cancel any time”, “One licence per device”.">
              <Textarea rows={3} value={str("licence")} maxLength={LIMITS.licence} onChange={(e) => setDetail("licence", e.target.value)} />
            </Field>
            <Chip selected={details.trial === true} onClick={() => setDetail("trial", details.trial !== true)} className="w-fit px-4 py-2">
              A free trial or demo is available
            </Chip>
          </>
        )}
        {values.kind === "SERVICE" && (
          <>
            <Field label="Duration" error={errors["details.duration"]} hint="E.g. “1 hour”, “2 to 3 days”, “a 10-week course”.">
              <Input value={str("duration")} maxLength={LIMITS.duration} onChange={(e) => setDetail("duration", e.target.value)} />
            </Field>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-[15px] font-medium">Where</legend>
              <div className="flex flex-wrap gap-2">
                {SERVICE_PLACES.map((w) => (
                  <Chip key={w} selected={list("places").includes(w)} onClick={() => toggle("places", w)} className="px-4 py-2">
                    {PLACE_LABEL[w]}
                  </Chip>
                ))}
              </div>
            </fieldset>
            <Chip selected={details.bookingNeeded === true} onClick={() => setDetail("bookingNeeded", details.bookingNeeded !== true)} className="w-fit px-4 py-2">
              Customers need to book
            </Chip>
          </>
        )}
      </GlassCard>

      <GlassCard as="section" aria-label="Status" className="flex flex-col gap-3 p-5 sm:p-6">
        <Field label="Status" hint="Drafts are kept out of Autopilot and the chat assistant until you make them active.">
          <Select value={values.status} onChange={(e) => set("status", e.target.value as ProductFormValues["status"])}>
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
          {pending ? "Saving…" : productId ? "Save changes" : "Add product"}
        </Button>
        <Button variant="outline" href={productId ? `/dashboard/knowledge/products/${productId}` : "/dashboard/knowledge/products"}>
          Cancel
        </Button>
      </div>
      <p className="text-[13px] text-muted">Fields marked * are required. You can add photos after saving.</p>
    </form>
  );
}

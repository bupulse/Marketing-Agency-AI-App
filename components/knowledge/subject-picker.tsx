"use client";

import { useRouter } from "next/navigation";
import { Select } from "@/components/ui";

export type SubjectOption = { id: string; name: string; group: "Products & services" | "Campaigns" };

/**
 * "Start from a product or campaign": a select that opens `hrefFor(id)` (the item's page, or the same page with
 * ?for=<id>). Empty when the business has neither.
 */
export function SubjectPicker({ options, value = "", label = "Start from a product or campaign", base, param = "for", none = "Nothing in particular" }: { options: SubjectOption[]; value?: string; label?: string; base: string; param?: string; none?: string }) {
  const router = useRouter();
  if (options.length === 0) return null;
  return (
    <label className="flex min-w-0 max-w-md flex-col gap-1.5 px-1 text-[14px] font-medium">
      {label}
      <Select value={value} onChange={(e) => router.push(e.target.value ? `${base}?${param}=${encodeURIComponent(e.target.value)}` : base)}>
        <option value="">{none}</option>
        {(["Products & services", "Campaigns"] as const).map((group) => {
          const items = options.filter((o) => o.group === group);
          return items.length ? (
            <optgroup key={group} label={group}>
              {items.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </optgroup>
          ) : null;
        })}
      </Select>
    </label>
  );
}

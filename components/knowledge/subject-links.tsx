"use client";

import { useRouter } from "next/navigation";
import { Select } from "@/components/ui";

/** "Write content for…": opens the product's or campaign's page, where its content is written. */
export function SubjectLinks({ options }: { options: { products: { id: string; name: string }[]; campaigns: { id: string; name: string }[] } }) {
  const router = useRouter();
  if (options.products.length + options.campaigns.length === 0) return null;
  return (
    <label className="flex min-w-0 max-w-md flex-col gap-1.5 px-1 text-[14px] font-medium">
      Write content for
      <Select defaultValue="" onChange={(e) => e.target.value && router.push(e.target.value)}>
        <option value="">Choose a product or campaign…</option>
        {options.products.length > 0 && (
          <optgroup label="Products & services">
            {options.products.map((p) => (
              <option key={p.id} value={`/dashboard/knowledge/products/${p.id}`}>
                {p.name}
              </option>
            ))}
          </optgroup>
        )}
        {options.campaigns.length > 0 && (
          <optgroup label="Campaigns">
            {options.campaigns.map((c) => (
              <option key={c.id} value={`/dashboard/knowledge/campaigns/${c.id}`}>
                {c.name}
              </option>
            ))}
          </optgroup>
        )}
      </Select>
    </label>
  );
}

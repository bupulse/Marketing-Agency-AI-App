"use client";

import { Tabs } from "@/components/ui";
import { cn } from "@/lib/cn";
import { CopyButton } from "./copy-button";
import { NETWORKS, aspectNote, formatCopyText, type StudioVariant } from "./helpers";

function Preview({ variant }: { variant: StudioVariant }) {
  const over = variant.limit > 0 && variant.characterCount > variant.limit;
  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-2xl bg-soft p-4">
        <p className="whitespace-pre-wrap break-words text-[15px]">{variant.caption}</p>
        {variant.hashtags.length > 0 && (
          <p className="mt-3 break-words text-[15px] font-medium text-pulse-blue">{variant.hashtags.join(" ")}</p>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5 text-[13px]">
          <span className={cn("font-medium", over ? "text-danger" : "text-muted")}>
            {variant.characterCount}
            {variant.limit > 0 ? ` of ${variant.limit}` : ""} characters{over ? ". Too long for this network." : ""}
          </span>
          <span className="text-muted">{aspectNote(variant.aspectRatio)}</span>
          <span className="font-medium text-success">Ready to post</span>
        </div>
        <CopyButton text={formatCopyText(variant.caption, variant.hashtags)} label="Copy for this network" />
      </div>
    </div>
  );
}

/** One tab per network, showing the version of the text prepared for it. */
export function NetworkPreviews({ variants }: { variants: StudioVariant[] }) {
  const items = NETWORKS.flatMap((n) => {
    const variant = variants.find((v) => v.network === n.value);
    return variant ? [{ value: n.value, label: n.label, content: <Preview variant={variant} /> }] : [];
  });

  if (items.length === 0) {
    return <p className="rounded-2xl bg-soft px-4 py-6 text-center text-[15px] text-muted">Network versions are not available for this text. Regenerate to create them.</p>;
  }
  return <Tabs label="Network previews" items={items} />;
}

"use client";

import { ExternalLink } from "lucide-react";
import { useTransition } from "react";
import { useToast } from "@/components/ui";
import { getInvoiceUrl } from "@/app/dashboard/billing/actions";

const classes = "inline-flex min-h-11 cursor-pointer items-center gap-1.5 text-sm font-semibold text-[color:var(--bp-link)] underline";

/** Receipt links expire, so a fresh one is fetched when the customer clicks. */
export function ReceiptButton({ id, url }: { id: string; url: string | null }) {
  const { toast } = useToast();
  const [pending, start] = useTransition();

  if (url) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className={classes}>
        Open receipt
        <ExternalLink aria-hidden className="size-4" />
      </a>
    );
  }

  function open() {
    // Open the tab now so the popup blocker allows it, then point it at the fresh link.
    const tab = window.open("", "_blank");
    start(async () => {
      const result = await getInvoiceUrl(id);
      if (result.ok) {
        if (tab) {
          tab.opener = null;
          tab.location.href = result.url;
        } else window.location.assign(result.url);
      } else {
        tab?.close();
        toast(result.error, "error");
      }
    });
  }

  return (
    <button type="button" onClick={open} disabled={pending} className={classes}>
      {pending ? "Opening…" : "Open receipt"}
      <ExternalLink aria-hidden className="size-4" />
    </button>
  );
}

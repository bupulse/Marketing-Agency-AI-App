"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Dialog, useToast } from "@/components/ui";
import { openPortal } from "@/app/dashboard/billing/actions";
import { blockCopy, parseUsageBlock, type UsageBlockReason } from "./helpers";

type UpgradeDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reason: UsageBlockReason;
  /** The plan's limit for the blocked metric, for the "used all N" message. */
  limit?: number;
  /** When usage next resets. */
  resetsAt?: Date | string | null;
};

/** The paywall: shown when a generation is blocked. Nothing is lost, and the CTA leads to billing. */
export function UpgradeDialog({ open, onOpenChange, reason, limit, resetsAt }: UpgradeDialogProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, start] = useTransition();
  const copy = blockCopy(reason, { limit, resetsAt });

  function go() {
    if (copy.action === "billing") {
      onOpenChange(false);
      router.push("/dashboard/billing");
      return;
    }
    start(async () => {
      const result = await openPortal();
      if (result.ok) window.location.assign(result.url);
      else toast(result.error, "error");
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={copy.title} description={copy.body}>
      <div className="flex flex-col gap-5">
        <p className="text-sm text-muted">Everything you&apos;ve made is saved.</p>
        <div className="flex flex-wrap justify-end gap-3">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Not now
          </Button>
          <Button onClick={go} disabled={pending}>
            {pending ? "Opening…" : copy.cta}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/**
 * For generators: call `handleBody(json)` on a failed request. When it is a
 * 402 usage block it opens the paywall and returns true, so the caller can skip its own error.
 *
 *   const { handleBody, dialog } = useUsageBlock({ limit, resetsAt });
 *   if (res.status === 402 && handleBody(await res.json())) return;
 *   ...
 *   return <>{...}{dialog}</>;
 */
export function useUsageBlock(options: { limit?: number; resetsAt?: Date | string | null } = {}) {
  const [reason, setReason] = useState<UsageBlockReason | null>(null);
  const [open, setOpen] = useState(false);
  const { limit, resetsAt } = options;

  const handleBody = useCallback((body: unknown) => {
    const parsed = parseUsageBlock(body);
    if (!parsed) return false;
    setReason(parsed);
    setOpen(true);
    return true;
  }, []);

  const dialog = reason ? <UpgradeDialog open={open} onOpenChange={setOpen} reason={reason} limit={limit} resetsAt={resetsAt} /> : null;
  return { handleBody, dialog, blocked: reason };
}

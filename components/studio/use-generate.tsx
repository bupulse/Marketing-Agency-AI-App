"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui";
import { UpgradeDialog } from "@/components/billing/upgrade-dialog";
import type { UsageBlockReason } from "@/components/billing/helpers";
import { generateContent } from "@/app/dashboard/knowledge/actions";

/** Runs "write / rewrite the content" for a product or campaign and handles a blocked plan with the upgrade dialog. */
export function useGenerate(subjectId: string, options: { limit?: number; onDone?: (contentId: string) => void } = {}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, start] = useTransition();
  const [blocked, setBlocked] = useState<UsageBlockReason | null>(null);
  const [open, setOpen] = useState(false);
  const { limit, onDone } = options;

  function run(instruction?: string) {
    start(async () => {
      const text = instruction?.trim();
      const result = await generateContent(subjectId, text ? { instruction: text } : {});
      if (result.ok) {
        onDone?.(result.contentId);
        router.refresh();
        toast("Your content is ready.", "success");
        return;
      }
      if (result.blocked) {
        setBlocked(result.blocked);
        setOpen(true);
        return;
      }
      toast(result.error, "error");
    });
  }

  const dialog = blocked ? <UpgradeDialog open={open} onOpenChange={setOpen} reason={blocked} limit={limit} /> : null;
  return { run, pending, dialog };
}

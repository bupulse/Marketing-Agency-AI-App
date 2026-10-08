"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { Button, useToast } from "@/components/ui";

/** A secret or key that is shown once: select-all text and a copy button. */
export function SecretBox({ title, value, onDone }: { title: string; value: string; onDone: () => void }) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast("Select the text and copy it by hand.", "info");
    }
  }

  return (
    <div role="status" className="flex flex-col gap-2 rounded-2xl border border-line bg-soft p-4" data-secret-box>
      <p className="text-[14px] font-semibold">{title}</p>
      <div className="flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 basis-56 break-all rounded-xl bg-surface px-3 py-2 text-[13px] select-all" data-secret-value>
          {value}
        </code>
        <Button variant="outline" size="sm" onClick={() => void copy()} leading={copied ? <Check aria-hidden className="size-4" /> : <Copy aria-hidden className="size-4" />}>
          {copied ? "Copied" : "Copy"}
        </Button>
        <Button variant="ghost" size="sm" onClick={onDone}>
          I saved it
        </Button>
      </div>
    </div>
  );
}

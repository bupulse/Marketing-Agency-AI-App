"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button, useToast } from "@/components/ui";

async function writeClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older Safari and non-secure pages: fall back to a hidden textarea.
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    document.body.removeChild(area);
    return ok;
  }
}

export function CopyButton({
  text,
  label = "Copy",
  ariaLabel,
  variant = "ghost",
  className,
}: {
  text: string;
  label?: string;
  ariaLabel?: string;
  variant?: "ghost" | "outline";
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  async function copy() {
    const ok = await writeClipboard(text);
    if (!ok) {
      toast("Copy did not work. Select the text and copy it by hand.", "error");
      return;
    }
    setCopied(true);
    toast("Copied.", "success");
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Button
      variant={variant}
      size="sm"
      className={className}
      aria-label={ariaLabel}
      onClick={copy}
      leading={copied ? <Check aria-hidden className="size-4 text-success" /> : <Copy aria-hidden className="size-4" />}
    >
      {copied ? "Copied" : label}
    </Button>
  );
}

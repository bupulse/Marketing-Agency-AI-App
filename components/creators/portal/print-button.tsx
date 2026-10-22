"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui";

/** Opens the browser's Print, where "Save as PDF" keeps the brief on the phone. */
export function PrintButton() {
  return (
    <Button type="button" size="sm" leading={<Printer aria-hidden className="size-4" />} onClick={() => window.print()}>
      Print or save as PDF
    </Button>
  );
}

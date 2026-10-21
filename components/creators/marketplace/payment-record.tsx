import { BadgeCheck, CircleAlert, Sparkles } from "lucide-react";
import { cn } from "@/lib/cn";
import { recordInWords, type PaymentRecord } from "@/lib/creators/record";

/** A company's payment record in a line: "Paid 12 creators · Usually within 3 days of the month's end". */
export function PaymentRecordLine({ record, className }: { record: PaymentRecord; className?: string }) {
  const { lines, late } = recordInWords(record);
  const Icon = late ? CircleAlert : record.isNew ? Sparkles : BadgeCheck;
  return (
    <p className={cn("flex items-start gap-1.5 text-[13px] font-medium", late ? "text-danger" : record.isNew ? "text-muted" : "text-success", className)}>
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span>{lines.join(" · ")}</span>
    </p>
  );
}

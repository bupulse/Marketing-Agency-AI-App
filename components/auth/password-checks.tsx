import { Check, Circle } from "lucide-react";
import { cn } from "@/lib/cn";
import { passwordRules } from "@/lib/auth/schemas";

/** Live password requirement checklist. */
export function PasswordChecks({ value }: { value: string }) {
  return (
    <ul aria-label="Password requirements" className="flex flex-col gap-1.5">
      {passwordRules.map((rule) => {
        const met = rule.test(value);
        return (
          <li key={rule.id} className={cn("flex items-center gap-2 text-[13px]", met ? "text-success" : "text-muted")}>
            {met ? <Check aria-hidden className="size-4 shrink-0" /> : <Circle aria-hidden className="size-4 shrink-0" />}
            <span>
              {rule.label}
              <span className="sr-only">{met ? " (met)" : " (not met)"}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

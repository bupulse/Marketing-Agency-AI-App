"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setDisplayCurrencyAction } from "@/app/admin/(console)/actions";
import { cn } from "@/lib/cn";
import { DISPLAY_CURRENCIES, type DisplayCurrency } from "@/lib/money/display";

/** RWF | USD | EUR at the top of the admin console: every money figure follows it (remembered per admin, a cookie). */
export function CurrencySwitch({ value }: { value: DisplayCurrency }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <div role="group" aria-label="Show amounts in" className={cn("glass inline-flex min-h-11 items-center rounded-full p-1", pending && "opacity-60")}>
      {DISPLAY_CURRENCIES.map((c) => (
        <button
          key={c}
          type="button"
          aria-pressed={c === value}
          disabled={pending}
          onClick={() =>
            start(async () => {
              if (c === value) return;
              await setDisplayCurrencyAction(c);
              router.refresh();
            })
          }
          className={cn("min-h-9 cursor-pointer rounded-full px-3 text-xs font-semibold", c === value ? "bg-text text-surface" : "text-muted hover:text-text")}
        >
          {c}
        </button>
      ))}
    </div>
  );
}

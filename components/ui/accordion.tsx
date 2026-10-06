"use client";

import { Plus } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export type AccordionItem = { question: string; answer: ReactNode };

type AccordionProps = {
  items: AccordionItem[];
  /** Allow several panels open at once (default: one at a time). */
  multiple?: boolean;
  /** Index opened initially. */
  defaultOpen?: number;
  className?: string;
};

/** FAQ-style accordion with the rotating plus icon. Each header is a real button (aria-expanded). */
export function Accordion({ items, multiple = false, defaultOpen, className }: AccordionProps) {
  const uid = useId();
  const [open, setOpen] = useState<number[]>(defaultOpen === undefined ? [] : [defaultOpen]);

  function toggle(i: number) {
    setOpen((cur) =>
      cur.includes(i) ? cur.filter((x) => x !== i) : multiple ? [...cur, i] : [i],
    );
  }

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {items.map((item, i) => {
        const isOpen = open.includes(i);
        return (
          <div key={item.question} className="glass rounded-card px-6">
            <h3 className="m-0">
              <button
                type="button"
                id={`${uid}-q${i}`}
                aria-expanded={isOpen}
                aria-controls={`${uid}-a${i}`}
                onClick={() => toggle(i)}
                className="flex min-h-14 w-full cursor-pointer items-center justify-between gap-4 bg-transparent text-left text-[17px] font-semibold text-text"
              >
                {item.question}
                <Plus
                  aria-hidden
                  className={cn("size-5 shrink-0 transition-transform duration-300", isOpen && "rotate-45")}
                />
              </button>
            </h3>
            <div
              id={`${uid}-a${i}`}
              role="region"
              aria-labelledby={`${uid}-q${i}`}
              className="bp-accordion-body"
              data-open={isOpen}
              inert={!isOpen}
            >
              <div className="overflow-hidden">
                <div className="pb-5 leading-relaxed text-muted">{item.answer}</div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

"use client";

import { Check } from "lucide-react";
import { useEffect, useRef } from "react";
import { Mark } from "@/components/brand";
import { cn } from "@/lib/cn";
import { prefersReducedMotion } from "./scroll-scene";
import "./motion.css";

// An example website chat for a hardware shop that plays itself out when it comes into view: the visitor's lines are
// typed, the assistant "thinks" for a moment, and the lead is saved at the end. Every message is in the HTML from
// the start and keeps its place (only colour and opacity change), so the box never changes size and nothing moves.

type Line = { from: "visitor" | "bot"; text: string };

const lines: Line[] = [
  { from: "visitor", text: "Hello! Do you have 20 litre buckets of white paint?" },
  { from: "bot", text: "Yes, we do: white and cream, in 20 L buckets. Would you like us to keep one for you?" },
  { from: "visitor", text: "Yes please. Can I pay with Mobile Money?" },
  { from: "bot", text: "Of course, you can pay with Mobile Money when you collect it. What’s your name and phone number, so the shop can confirm?" },
  { from: "visitor", text: "Eric, 0788 000 000" },
];

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function ChatDemo() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const box = ref.current;
    if (!box || prefersReducedMotion()) return;
    let cancelled = false;
    const msgs = Array.from(box.querySelectorAll<HTMLElement>("[data-msg]"));
    const lead = box.querySelector<HTMLElement>("[data-lead]");
    const typing = box.querySelector<HTMLElement>("[data-typing]");
    box.dataset.play = "ready";

    const run = async () => {
      for (const msg of msgs) {
        if (cancelled) return;
        if (msg.dataset.msg === "bot") {
          if (typing) {
            typing.dataset.on = "1";
            typing.style.setProperty("--y", `${msg.offsetTop}px`);
          }
          await wait(900);
          if (typing) typing.dataset.on = "0";
          msg.dataset.shown = "1";
          await wait(500);
        } else {
          msg.dataset.shown = "1";
          // Type the visitor's line: each letter is already in place, it only becomes visible.
          const chars = Array.from(msg.querySelectorAll<HTMLElement>("[data-c]"));
          for (const c of chars) {
            if (cancelled) return;
            c.dataset.c = "1";
            await wait(28);
          }
          await wait(350);
        }
      }
      if (lead && !cancelled) lead.dataset.shown = "1";
    };

    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        io.disconnect();
        run();
      },
      { threshold: 0.45 },
    );
    io.observe(box);
    return () => {
      cancelled = true;
      io.disconnect();
    };
  }, []);

  return (
    <div ref={ref} className="cd glass-strong" role="group" aria-label="Example website chat for a hardware shop">
      <div className="cd-top">
        <span className="cd-avatar">
          <Mark variant="icon" size={22} alt="" />
        </span>
        <div className="flex min-w-0 flex-col">
          <strong className="text-sm">Your shop’s assistant</strong>
          <span className="text-xs text-muted">Answers from what you told BuPulse</span>
        </div>
        <span className="cd-online">Online</span>
      </div>
      <div className="cd-body">
        {lines.map((l, i) => (
          <p key={i} data-msg={l.from} className={cn("cd-msg", l.from === "visitor" ? "cd-visitor" : "cd-bot")}>
            {l.from === "visitor" ? (
              <>
                {/* Read as one sentence; the letter-by-letter copy is only for the typing effect. */}
                <span className="sr-only">{l.text}</span>
                <span aria-hidden>
                  {Array.from(l.text).map((ch, j) => (
                    <span key={j} data-c="0">
                      {ch}
                    </span>
                  ))}
                </span>
              </>
            ) : (
              l.text
            )}
          </p>
        ))}
        <span aria-hidden data-typing className="cd-typing">
          <i />
          <i />
          <i />
        </span>
        <p data-lead className="cd-lead">
          <Check aria-hidden className="size-4 shrink-0" />
          <span>
            <strong>New lead saved:</strong> Eric · 0788 000 000 · wants a 20 L bucket of white paint
          </span>
        </p>
      </div>
    </div>
  );
}

"use client";

import { Check, Image as ImageIcon, MessageCircle, Phone, Sparkles, Store } from "lucide-react";
import { useEffect, useRef } from "react";
import { Container } from "@/components/ui";
import { useCtaMode } from "@/components/marketing/quote/cta";
import { prefersReducedMotion } from "./scroll-scene";
import "./motion.css";

// "How BuPulse works", pinned: the steps scroll by on one side while a panel on the other side builds up one card
// per step. The first step follows the visitor's region (lib/quote/cta.ts): a free quote in Rwanda, the free trial
// elsewhere.

const later = [
  {
    title: "Tell BuPulse about your business, once",
    text: "What you sell and for how much, your opening hours, where you deliver, your logo and colours, and how you talk to customers. It’s a short quiz, and we can fill it in with you.",
  },
  {
    title: "Your posts and videos are made for you",
    text: "Every day, a post with its picture and caption, in your brand. Videos too, on the plans that include them. You see everything before it goes out, and approve with one tap.",
  },
  {
    title: "Customers find you, and you hear from them",
    text: "Your posts go out on your pages at the right time. The chat on your website answers visitors day and night and saves their name and number in your Leads.",
  },
];

export function HowItWorks() {
  const mode = useCtaMode();
  const ref = useRef<HTMLElement>(null);
  const steps = [
    mode === "quote"
      ? { title: "Ask for a free quote", text: "Leave your name, phone number and business. We call you back, listen to what you need and suggest the plan that fits. You pay monthly or yearly, by Mobile Money or card." }
      : { title: "Start your free trial", text: "Sign up, tell us a little about your business and pick the plan you want to try. No card needed, and you can cancel any time." },
    ...later,
  ];

  useEffect(() => {
    const section = ref.current;
    if (!section || prefersReducedMotion()) return;
    section.dataset.live = "on";
    section.dataset.step = "1";
    const blocks = Array.from(section.querySelectorAll<HTMLElement>("[data-step-block]"));
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) section.dataset.step = (e.target as HTMLElement).dataset.stepBlock!;
        }
      },
      // A step is "current" while it crosses the middle band of the screen.
      { rootMargin: "-45% 0px -45% 0px" },
    );
    blocks.forEach((b) => io.observe(b));
    return () => io.disconnect();
  }, []);

  return (
    <section ref={ref} id="how" aria-labelledby="how-title" className="hw scroll-mt-24 py-20 sm:py-28">
      <Container>
        <div className="mb-10 flex max-w-3xl flex-col gap-3 sm:mb-14">
          <p className="m-0 text-sm font-semibold tracking-[0.14em] text-ok uppercase">How it works</p>
          <h2 id="how-title" className="m-0 text-[clamp(30px,4.6vw,54px)] leading-[1.05] font-bold tracking-[-0.035em]">
            Four steps. Then it runs every day.
          </h2>
        </div>
        <div className="hw-grid">
          <div aria-hidden className="hw-panel-wrap">
            <div className="hw-panel glass-strong">
              <div className="hw-card" data-n="1">
                <span className="hw-ico">
                  <Phone className="size-4" />
                </span>
                <div className="min-w-0">
                  <strong>{mode === "quote" ? "Free quote requested" : "Free trial started"}</strong>
                  <span>{mode === "quote" ? "We call you back" : "No card needed"}</span>
                </div>
                <Check className="hw-ok size-4" />
              </div>
              <div className="hw-card" data-n="2">
                <span className="hw-ico">
                  <Store className="size-4" />
                </span>
                <div className="min-w-0">
                  <strong>Your business</strong>
                  <span className="hw-chips">
                    <i>Products</i>
                    <i>Prices</i>
                    <i>Hours</i>
                    <i>Logo</i>
                    <i>Your tone</i>
                  </span>
                </div>
                <Check className="hw-ok size-4" />
              </div>
              <div className="hw-card" data-n="3">
                <span className="hw-ico">
                  <ImageIcon className="size-4" />
                </span>
                <div className="min-w-0">
                  <strong>Today’s post is ready</strong>
                  <span>Picture, caption and hashtags</span>
                </div>
                <span className="hw-approve">
                  <Sparkles className="size-3.5" /> Approve
                </span>
              </div>
              <div className="hw-card" data-n="4">
                <span className="hw-ico">
                  <MessageCircle className="size-4" />
                </span>
                <div className="min-w-0">
                  <strong>New lead from your website</strong>
                  <span>Eric wants a price for 20 L of paint</span>
                </div>
                <span className="hw-dot" />
              </div>
            </div>
          </div>
          <ol className="hw-steps m-0 list-none p-0">
            {steps.map((s, i) => (
              <li key={s.title} className="hw-step" data-step-block={i + 1}>
                <span aria-hidden className="hw-num">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <h3 className="m-0 text-[clamp(22px,2.6vw,30px)] leading-tight font-bold tracking-[-0.02em]">
                  <span className="sr-only">Step {i + 1}: </span>
                  {s.title}
                </h3>
                <p className="m-0 max-w-lg text-[17px] leading-relaxed text-muted">{s.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </Container>
    </section>
  );
}

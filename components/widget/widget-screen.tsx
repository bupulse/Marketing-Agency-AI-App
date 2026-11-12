import { MessageCircle } from "lucide-react";
import type { ComponentProps } from "react";
import { KitStyles, PageHeader } from "@/components/admin/kit";
import { WidgetSettings } from "./widget-settings";

/** The Website chat page (plain data in, so the page and the dev preview draw the same). */
export function WidgetScreen(props: ComponentProps<typeof WidgetSettings>) {
  return (
    <div className="flex flex-col gap-6">
      <KitStyles />
      <PageHeader icon={MessageCircle} title="Website chat" description="A chat bubble on your website. It answers visitors from your business facts and keeps their details as leads." />
      <WidgetSettings {...props} />
    </div>
  );
}

/** Ready greetings for an English-speaking business (other languages get only their standard greeting). */
export function greetingIdeasFor(language: string | null | undefined): string[] {
  if (language && language !== "English") return [];
  return ["Hello! Ask us about prices, delivery or opening hours.", "Hi there! Looking for something? I can help you choose."];
}

import { MessageCircle } from "lucide-react";
import { whatsappLink } from "@/lib/content/contact";

/**
 * Floating "Chat on WhatsApp" button on the public pages. Rendered only when NEXT_PUBLIC_WHATSAPP_NUMBER is set, so
 * the number lives in the environment (never in this public repository).
 */
export function WhatsAppButton() {
  const href = whatsappLink(process.env.NEXT_PUBLIC_WHATSAPP_NUMBER, "Hello BuPulse, I'd like to know more.");
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Chat with BuPulse on WhatsApp"
      className="fixed right-4 bottom-4 z-40 inline-flex min-h-12 items-center gap-2 rounded-full bg-[#25D366] px-4 text-sm font-semibold text-white no-underline shadow-lg transition hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 sm:right-6 sm:bottom-6"
    >
      <MessageCircle aria-hidden className="size-5" />
      <span className="hidden sm:inline">Chat on WhatsApp</span>
    </a>
  );
}

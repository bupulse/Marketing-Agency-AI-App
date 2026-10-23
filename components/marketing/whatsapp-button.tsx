import { MessageCircle } from "lucide-react";
import { whatsappLink } from "@/lib/content/contact";

/**
 * Floating "Chat on WhatsApp" button on the public pages. Rendered only when NEXT_PUBLIC_WHATSAPP_NUMBER is set, so
 * the number lives in the environment (never in this public repository). It sits just above the help chat button and
 * hides while the chat is open (`.bp-whatsapp-fab` in app/globals.css).
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
      title="Chat on WhatsApp"
      className="bp-whatsapp-fab fixed z-40 inline-flex size-12 items-center justify-center rounded-full bg-[#25D366] text-white no-underline shadow-lg transition hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 print:hidden"
    >
      <MessageCircle aria-hidden className="size-6" />
    </a>
  );
}

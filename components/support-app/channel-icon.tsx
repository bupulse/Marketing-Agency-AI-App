import { Globe, Mail, MessageSquareText, QrCode, Sparkles } from "lucide-react";
import { NetworkIcon } from "@/components/connections/network-icon";
import type { ChannelKey } from "@/lib/links/rules";
import { cn } from "@/lib/cn";

// The logo of each place a tracked link is shared (lib/links/rules.ts CHANNELS): the social networks' own brand icons,
// WhatsApp and Google drawn here, and plain icons on a coloured square for the rest. Inline SVG: no image requests.

function Square({ className, bg, children }: { className: string; bg: string; children: React.ReactNode }) {
  return (
    <span aria-hidden className={cn("inline-flex items-center justify-center rounded-[28%] text-white", bg, className)}>
      {children}
    </span>
  );
}

export function ChannelIcon({ channel, className = "size-8" }: { channel: ChannelKey | string; className?: string }) {
  const common = { viewBox: "0 0 24 24", className, "aria-hidden": true, focusable: false } as const;
  switch (channel) {
    case "instagram":
    case "facebook":
    case "linkedin":
    case "tiktok":
    case "youtube":
      return <NetworkIcon network={channel} className={className} />;
    case "x":
      return <NetworkIcon network="twitter" className={className} />;
    case "whatsapp":
      return (
        <svg {...common}>
          <rect width="24" height="24" rx="6.5" fill="#25D366" />
          <path
            fill="#fff"
            d="M12 4.6a7.3 7.3 0 0 0-6.3 11l-1 3.8 3.9-1A7.3 7.3 0 1 0 12 4.6Zm0 13.3c-1.1 0-2.2-.3-3.1-.9l-.2-.1-2.3.6.6-2.2-.1-.2A6 6 0 1 1 12 17.9Zm3.3-4.5c-.2-.1-1.1-.5-1.2-.6-.2-.1-.3-.1-.4.1l-.6.7c-.1.1-.2.1-.4 0a4.9 4.9 0 0 1-2.4-2.1c-.2-.3.2-.3.5-1 .1-.1 0-.2 0-.3l-.5-1.3c-.1-.3-.3-.3-.4-.3h-.4a.7.7 0 0 0-.5.3c-.2.2-.7.7-.7 1.6s.7 1.8.8 2c.1.1 1.4 2.1 3.4 3 1.3.5 1.8.6 2.4.5.4-.1 1.1-.5 1.3-.9.2-.4.2-.8.1-.9l-.5-.3Z"
          />
        </svg>
      );
    case "google":
      return (
        <svg {...common}>
          <rect width="24" height="24" rx="6.5" fill="#fff" stroke="#e5e7eb" strokeWidth="0.8" />
          <path fill="#4285F4" d="M19.6 12.2c0-.6-.1-1.1-.2-1.6H12v3h4.3a3.7 3.7 0 0 1-1.6 2.4v2h2.6c1.5-1.4 2.3-3.4 2.3-5.8Z" />
          <path fill="#34A853" d="M12 20c2.2 0 4-.7 5.3-1.9l-2.6-2c-.7.5-1.6.8-2.7.8-2.1 0-3.9-1.4-4.5-3.3H4.8v2.1A8 8 0 0 0 12 20Z" />
          <path fill="#FBBC05" d="M7.5 13.6a4.8 4.8 0 0 1 0-3.1V8.4H4.8a8 8 0 0 0 0 7.2l2.7-2Z" />
          <path fill="#EA4335" d="M12 7.2c1.2 0 2.3.4 3.1 1.2l2.3-2.3A8 8 0 0 0 4.8 8.4l2.7 2.1C8.1 8.6 9.9 7.2 12 7.2Z" />
        </svg>
      );
    case "email":
      return (
        <Square className={className} bg="bg-[linear-gradient(135deg,#2f6bff,#5b8cff)]">
          <Mail className="size-[58%]" strokeWidth={2.2} />
        </Square>
      );
    case "sms":
      return (
        <Square className={className} bg="bg-[linear-gradient(135deg,#16a34a,#4ade80)]">
          <MessageSquareText className="size-[58%]" strokeWidth={2.2} />
        </Square>
      );
    case "print":
      return (
        <Square className={className} bg="bg-[linear-gradient(135deg,#111827,#4b5563)]">
          <QrCode className="size-[58%]" strokeWidth={2.2} />
        </Square>
      );
    case "other":
      return (
        <Square className={className} bg="bg-[linear-gradient(135deg,#7b5cff,#c084fc)]">
          <Sparkles className="size-[58%]" strokeWidth={2.2} />
        </Square>
      );
    default:
      return (
        <Square className={className} bg="bg-[linear-gradient(135deg,#64748b,#94a3b8)]">
          <Globe className="size-[58%]" strokeWidth={2.2} />
        </Square>
      );
  }
}

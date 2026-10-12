import { Building2, CalendarRange, MapPin, MessageSquareQuote, MessagesSquare, Package, Palette, Plug, Sparkles, Swords, UsersRound, type LucideIcon } from "lucide-react";
import type { SectionKey } from "@/lib/knowledge/sections";

/** One icon per Knowledge base section (the type makes a new section's icon mandatory). */
export const SECTION_ICONS: Record<SectionKey, LucideIcon> = {
  profile: Building2,
  products: Package,
  campaigns: CalendarRange,
  locations: MapPin,
  brand: Palette,
  channels: Plug,
  audience: UsersRound,
  competitors: Swords,
  faqs: MessagesSquare,
  reviews: MessageSquareQuote,
  interview: Sparkles,
};

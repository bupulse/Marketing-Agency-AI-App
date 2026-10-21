import Link from "next/link";
import { CalendarDays, Users } from "lucide-react";
import { Badge } from "@/components/ui";
import { formatSpan, isCreatorNetwork, NETWORK_LABEL } from "@/lib/creators/describe";
import { whenOf } from "@/lib/creators/market-filters";
import type { MarketCard } from "@/lib/creators/marketplace";
import { PaymentRecordLine } from "./payment-record";

/** The company's logo, or its first letter on a soft square. */
export function CompanyLogo({ name, url, size = 48 }: { name: string; url: string | null; size?: number }) {
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed Storage URL
    <img src={url} alt="" width={size} height={size} style={{ width: size, height: size }} className="shrink-0 rounded-2xl bg-surface object-contain" />
  ) : (
    <span aria-hidden style={{ width: size, height: size }} className="inline-flex shrink-0 items-center justify-center rounded-2xl bg-new-bg text-lg font-bold text-new">
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

/** "12 places left", "1 place left" or "Full". */
export const placesInWords = (n: number) => (n === 0 ? "Full" : `${n} place${n === 1 ? "" : "s"} left`);

/** One campaign on the marketplace, linking to its page /c/<slug>. */
export function CampaignCard({ card }: { card: MarketCard }) {
  const networks = card.platforms.filter(isCreatorNetwork);
  const soon = whenOf(card) === "soon";
  return (
    <Link href={`/c/${card.slug}`} className="glass flex flex-col gap-3 rounded-glass p-4 no-underline transition-colors hover:bg-soft sm:p-5">
      <div className="flex items-center gap-3">
        <CompanyLogo name={card.company.name} url={card.company.logoUrl} />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-muted">{card.company.name}</p>
          <h2 className="text-lg font-semibold leading-snug tracking-tight">{card.name}</h2>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {networks.map((n) => (
          <Badge key={n} tone="violet">{NETWORK_LABEL[n]}</Badge>
        ))}
        <Badge tone={soon ? "blue" : "success"}>{soon ? "Starting soon" : "Open now"}</Badge>
      </div>
      {card.pay.length > 0 && <p className="text-[15px] font-semibold">{card.pay[0]}</p>}
      {card.pay.length > 1 && <p className="-mt-2 line-clamp-2 text-sm text-muted">{card.pay.slice(1).join(". ")}.</p>}
      <div className="mt-auto flex flex-col gap-1.5 text-sm text-muted">
        <span className="flex items-center gap-1.5">
          <CalendarDays aria-hidden className="size-4" />
          {formatSpan(card.startsOn, card.endsOn)}
        </span>
        <span className={`flex items-center gap-1.5 ${card.placesLeft === 0 ? "font-semibold text-danger" : ""}`}>
          <Users aria-hidden className="size-4" />
          {placesInWords(card.placesLeft)}
        </span>
        <PaymentRecordLine record={card.record} />
      </div>
    </Link>
  );
}

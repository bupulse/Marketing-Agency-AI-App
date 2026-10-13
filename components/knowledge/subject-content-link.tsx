import Link from "next/link";
import { ArrowRight } from "lucide-react";

/** The product's or campaign's posts live on the Content page, a day at a time (docs/CONTENT.md): a small link there. */
export function SubjectContentLink({ href, label }: { href: string; label: string }) {
  return (
    <p className="px-1">
      <Link href={href} className="inline-flex min-h-11 items-center gap-1.5 text-[15px] font-semibold text-pulse-blue no-underline hover:underline">
        {label} <ArrowRight aria-hidden className="size-4" />
      </Link>
    </p>
  );
}

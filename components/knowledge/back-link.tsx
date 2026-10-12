import Link from "next/link";
import { ChevronLeft } from "lucide-react";

/** "← Knowledge base" (or another parent) above a section page. */
export function BackLink({ href = "/dashboard/knowledge", label = "Knowledge base" }: { href?: string; label?: string }) {
  return (
    <Link href={href} className="-mb-2 inline-flex min-h-11 w-fit items-center gap-1 px-1 text-[14px] font-semibold text-muted no-underline hover:text-text">
      <ChevronLeft aria-hidden className="size-4" />
      {label}
    </Link>
  );
}

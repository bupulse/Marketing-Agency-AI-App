import type { ReactNode } from "react";

/**
 * Page title block used at the top of every dashboard section: one clear title, a single plain line under it, and the
 * page's main buttons on the right (under the title on a phone). The same type scale on every page.
 */
export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4 pt-1 pb-1">
      <div className="flex min-w-0 flex-col gap-1.5">
        <h1 className="text-[28px] font-semibold leading-[1.1] tracking-[-0.03em] sm:text-[34px]">{title}</h1>
        {description && <p className="max-w-2xl text-[15px] leading-relaxed text-muted sm:text-base">{description}</p>}
      </div>
      {action}
    </header>
  );
}

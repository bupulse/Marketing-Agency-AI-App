import type { ReactNode } from "react";

/** Page title block used at the top of every dashboard section. */
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
    <header className="flex flex-wrap items-end justify-between gap-4 px-1">
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.03em] sm:text-[30px]">{title}</h1>
        {description && <p className="max-w-2xl text-[15px] text-muted">{description}</p>}
      </div>
      {action}
    </header>
  );
}

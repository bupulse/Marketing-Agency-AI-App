import { requirePermission } from "@/lib/admin/auth";
import { nowMs, param } from "@/lib/admin/format";
import { AdminError, getErrors } from "@/lib/admin/service";
import { chosen } from "@/components/admin/kit";
import { ErrorsView } from "@/components/admin/system/logs-view";

export const metadata = { title: "Errors" };

const DAYS = ["1", "7", "30", "all"] as const;

/** Admin -> Errors: the error log, newest first, filtered by kind, period and exact source (and a user, from links). */
export default async function ErrorsPage({ searchParams }: PageProps<"/admin/errors">) {
  await requirePermission("system"); // pages render alongside the layout, so check here too
  const sp = await searchParams;
  const level = chosen(sp, "level", ["error", "warn"], "");
  const source = param(sp.source);
  const userId = param(sp.userId);
  const days = chosen(sp, "days", DAYS, "7");
  const cursor = param(sp.cursor);
  const since = days === "all" ? undefined : new Date(nowMs() - Number(days) * 86_400_000);
  let page;
  let bad: string | null = null;
  try {
    page = await getErrors({ level: level || undefined, source: source || undefined, userId: userId || undefined, since, cursor: cursor || undefined, limit: 50 });
  } catch (e) {
    if (!(e instanceof AdminError)) throw e;
    bad = e.message;
  }
  const next = page?.nextCursor ? `/admin/errors?${new URLSearchParams({ ...(level && { level }), ...(source && { source }), ...(userId && { userId }), days, cursor: page.nextCursor })}` : null;
  return <ErrorsView items={page?.items ?? null} more={Boolean(page?.nextCursor)} next={next} f={{ level, source, userId, days }} sp={sp} bad={bad} />;
}

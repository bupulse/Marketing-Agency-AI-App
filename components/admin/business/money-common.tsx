import { notice } from "@/components/admin/ui";
import type { SearchParamsLike } from "@/components/admin/kit";

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** The ?notice= (green) and ?error= (red) messages a server action leaves on the Money pages. */
export function MoneyNotices({ sp }: { sp: SearchParamsLike }) {
  const ok = first(sp.notice);
  const bad = first(sp.error);
  return (
    <>
      {ok && <p role="status" className={notice.ok}>{ok}</p>}
      {bad && <p role="alert" className={notice.bad}>{bad}</p>}
    </>
  );
}

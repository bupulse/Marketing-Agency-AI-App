import { notice } from "@/components/admin/ui";

/** The `?notice=` / `?error=` a server action came back with (lib/admin/console.ts finish()). */
export function Notices({ ok, bad }: { ok?: string; bad?: string }) {
  return (
    <>
      {ok && (
        <p role="status" className={notice.ok}>
          {ok}
        </p>
      )}
      {bad && (
        <p role="alert" className={notice.bad}>
          {bad}
        </p>
      )}
    </>
  );
}

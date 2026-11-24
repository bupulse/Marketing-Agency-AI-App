import { ConsoleNav } from "@/components/mail/console-ui";
import { requireMailAdmin } from "@/lib/mail/session";

// The Mail console frame (docs/MAIL_CRM.md "Mail console"): mail admins only, its own side menu instead of the Mail
// folders, the design's soft warm-to-violet background.
const BACKDROP =
  "radial-gradient(1100px 700px at 8% -10%, #ffe1cc 0%, rgba(255,225,204,0) 60%), radial-gradient(900px 700px at 95% 0%, #cddcff 0%, rgba(205,220,255,0) 58%), radial-gradient(1100px 800px at 55% 110%, #e0d4ff 0%, rgba(224,212,255,0) 62%), #eef1f8";

export default async function MailConsoleLayout({ children }: { children: React.ReactNode }) {
  await requireMailAdmin();
  return (
    <div className="min-h-dvh text-text" style={{ background: BACKDROP }}>
      <div className="flex min-h-dvh flex-col items-start gap-[18px] p-3 md:flex-row md:p-[18px] dark:bg-[rgba(10,10,14,0.88)]">
        <ConsoleNav />
        <main className="flex w-full min-w-0 flex-1 flex-col gap-4">{children}</main>
      </div>
    </div>
  );
}

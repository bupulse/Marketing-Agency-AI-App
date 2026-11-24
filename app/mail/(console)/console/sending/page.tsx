import { card, h1, panel, sub } from "@/components/mail/console-styles";
import { cn } from "@/lib/cn";
import { loadSendWeek } from "@/lib/mail/console-data";
import { DAILY_LIMIT, UNDO_SECONDS } from "@/lib/mail/send";
import { requireMailAdmin } from "@/lib/mail/session";

export const metadata = { title: "Sending and limits" };

// Mail console: Sending and limits (read only): the free Resend plan's daily sends, today's count, the undo window.
export default async function MailConsoleSendingPage() {
  await requireMailAdmin();
  const week = await loadSendWeek();
  const days = week.map((w) => w.day);
  const sent = new Map(week.map((w) => [w.day, w.sent]));
  const todayCount = week[6].sent;
  const pct = Math.min(100, Math.round((todayCount / Math.max(1, DAILY_LIMIT)) * 100));
  const facts = [
    ["Free plan", `Resend's free plan sends ${DAILY_LIMIT} emails a day. When they are used up, Send says so until the count starts again.`],
    ["Resets at 02:00", "The count starts again at midnight UTC, which is 02:00 Kigali time."],
    ["Each copy is one send", "An email to 6 people, or to a department of 6, uses 6 sends."],
    ["Forwarding is free", "Inside forwarding is a copy in B Mail, and outside forwarding goes through Cloudflare: neither uses a send."],
    ["Undo send", `Every email waits ${UNDO_SECONDS} seconds before it goes, so Undo can stop it.`],
    ["More later", "A paid Resend plan raises the limit. Nothing is bought yet."],
  ];
  return (
    <>
      <header><h1 className={h1}>Sending and limits</h1><p className={sub}>How much B Mail can send, and what counts.</p></header>
      <section aria-label="Today" className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3.5">
        <div className={card}>
          <span className="text-[13px] text-muted">Sent today</span>
          <span className="text-[28px] font-bold tracking-[-0.02em]">{todayCount} <span className="text-[15px] font-medium text-muted">/ {DAILY_LIMIT}</span></span>
          <div className="h-2 overflow-hidden rounded-full bg-[rgba(60,60,67,0.1)] dark:bg-white/10"><div className={cn("h-2 rounded-full", pct > 80 ? "bg-[#ff9500]" : "bg-[#1f5ae6]")} style={{ width: `${pct}%` }} /></div>
          <span className="text-[13px] text-[#3c3c43] dark:text-white/70">{Math.max(0, DAILY_LIMIT - todayCount)} left · resets at 02:00 Kigali time</span>
        </div>
        <div className={card}>
          <span className="text-[13px] text-muted">Undo send</span>
          <span className="text-[28px] font-bold tracking-[-0.02em]">{UNDO_SECONDS} <span className="text-[15px] font-medium text-muted">seconds</span></span>
          <span className="text-[13px] text-[#3c3c43] dark:text-white/70">Before each email leaves</span>
        </div>
        <div className={card}>
          <span className="text-[13px] text-muted">Last 7 days</span>
          <div className="flex h-[52px] items-end gap-1.5" role="img" aria-label={days.map((d) => `${d}: ${sent.get(d) ?? 0}`).join(", ")}>
            {days.map((d) => (
              <span key={d} className="flex flex-1 flex-col items-center gap-1">
                <span className={cn("w-full rounded-[4px]", d === days[6] ? "bg-[#1f5ae6]" : "bg-[#b9ccff] dark:bg-[#3d5bb0]")} style={{ height: `${Math.max(3, Math.round(((sent.get(d) ?? 0) / Math.max(1, DAILY_LIMIT)) * 40))}px` }} />
              </span>
            ))}
          </div>
          <span className="text-[13px] text-[#3c3c43] dark:text-white/70">{days.reduce((a, d) => a + (sent.get(d) ?? 0), 0)} sent this week</span>
        </div>
      </section>
      <section aria-label="What counts" className={cn(panel, "grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-4 p-5")}>
        {facts.map(([t, x]) => (
          <div key={t} className="flex flex-col gap-1"><span className="text-[14.5px] font-bold">{t}</span><span className="text-[13.5px] leading-normal text-[#3c3c43] dark:text-white/70">{x}</span></div>
        ))}
      </section>
    </>
  );
}

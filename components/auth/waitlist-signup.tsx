import Link from "next/link";
import { QuoteForm } from "@/components/marketing/quote/quote-form";
import type { WaitlistInfo } from "@/lib/waitlist";

/**
 * /signup (and a refused Google sign-up) while the pre-launch waiting list is on (lib/waitlist.ts): new accounts open on
 * the launch day, so the page takes a waiting-list request instead. People who already have an account still log in.
 */
export function WaitlistSignup({ info, refused = false }: { info: WaitlistInfo; refused?: boolean }) {
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-semibold tracking-[-0.03em]">BuPulse opens on {info.dateLabel} 🎄</h1>
        <p className="text-[15px] text-muted">
          {refused ? "New accounts open on launch day, so we did not create one yet. " : ""}
          Reserve your spot now and our team will call you before launch to learn what your business needs.
        </p>
      </div>
      <QuoteForm source="signup" pageUrl="/signup" waitlist={info} />
      <p className="text-center text-sm text-muted">
        Already have an account?{" "}
        <Link href="/login" className="font-semibold text-text underline">
          Log in
        </Link>
      </p>
    </>
  );
}

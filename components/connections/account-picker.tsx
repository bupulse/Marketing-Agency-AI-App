import { savePickedAccountsAction, cancelPickAction } from "@/app/dashboard/connections/actions";
import { Button, GlassCard } from "@/components/ui";
import type { AccountChoice } from "@/lib/social/types";
import { NetworkIcon } from "./network-icon";
import type { Network } from "@/lib/social/types";

const WHAT: Partial<Record<Network, string>> = { facebook: "Pages", instagram: "Instagram accounts", linkedin: "profiles and Pages", youtube: "channels" };

/** After sign-in with several accounts (e.g. Facebook Pages): tick the ones BuPulse may post to. */
export function AccountPicker({ network, label, accounts }: { network: Network; label: string; accounts: AccountChoice[] }) {
  return (
    <GlassCard strong as="section" aria-labelledby="pick-title" className="flex animate-pop flex-col gap-4 rounded-card p-5 sm:p-6">
      <div className="flex items-center gap-3">
        <NetworkIcon network={network} className="size-9" />
        <div>
          <h2 id="pick-title" className="text-lg font-semibold">
            Choose your {label} {WHAT[network] ?? "accounts"}
          </h2>
          <p className="text-[13px] text-muted">BuPulse will only post to the ones you tick.</p>
        </div>
      </div>
      <form action={savePickedAccountsAction} className="flex flex-col gap-4">
        <ul className="flex flex-col">
          {accounts.map((a) => (
            <li key={a.externalAccountId}>
              <label className="flex min-h-14 cursor-pointer items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-soft">
                <input type="checkbox" name="account" value={a.externalAccountId} defaultChecked={accounts.length === 1} className="size-5 shrink-0 accent-[var(--color-pulse-blue)]" />
                {a.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={a.avatarUrl} alt="" width={36} height={36} referrerPolicy="no-referrer" className="size-9 shrink-0 rounded-full object-cover" />
                ) : (
                  <span aria-hidden className="size-9 shrink-0 rounded-full bg-soft" />
                )}
                <span className="min-w-0 flex-1 truncate font-medium">{a.displayName}</span>
              </label>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap justify-end gap-3">
          <Button type="submit" formAction={cancelPickAction} variant="outline" size="sm" formNoValidate>
            Cancel
          </Button>
          <Button type="submit" size="sm">
            Connect selected
          </Button>
        </div>
      </form>
    </GlassCard>
  );
}

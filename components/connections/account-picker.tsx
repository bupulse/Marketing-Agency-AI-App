import { savePickedAccountsAction, cancelPickAction } from "@/app/dashboard/connections/actions";
import { Badge, Button, GlassCard } from "@/components/ui";
import { choiceTag, isCompanyPage, noLinkedInPage, orderChoices, preselectedChoices } from "@/lib/social/choices";
import type { AccountChoice } from "@/lib/social/types";
import { NetworkIcon } from "./network-icon";
import type { Network } from "@/lib/social/types";

const WHAT: Partial<Record<Network, string>> = { facebook: "Pages", instagram: "Instagram accounts", linkedin: "profiles and Pages", youtube: "channels" };

/**
 * After a sign-in with several accounts (Facebook Pages, a LinkedIn profile and its Pages): tick the ones BuPulse may
 * post to; each one ticked becomes its own connection. LinkedIn asks "Where should BuPulse post?" with its Pages first.
 */
export function AccountPicker({ network, label, accounts, pageAccess = false }: { network: Network; label: string; accounts: AccountChoice[]; pageAccess?: boolean }) {
  const ordered = orderChoices(network, accounts);
  const ticked = new Set(preselectedChoices(network, accounts));
  const linkedin = network === "linkedin";
  const noPage = noLinkedInPage(network, accounts);
  return (
    <GlassCard strong as="section" aria-labelledby="pick-title" className="flex animate-pop flex-col gap-4 rounded-card p-4 sm:p-6">
      <div className="flex items-center gap-3">
        <NetworkIcon network={network} className="size-9 shrink-0" />
        <div className="min-w-0">
          <h2 id="pick-title" className="text-lg font-semibold">
            {linkedin ? "Where should BuPulse post?" : `Choose your ${label} ${WHAT[network] ?? "accounts"}`}
          </h2>
          <p className="text-[13px] text-muted">{linkedin ? "Tick one or more. BuPulse will only post where you tick." : "BuPulse will only post to the ones you tick."}</p>
        </div>
      </div>
      <form action={savePickedAccountsAction} className="flex flex-col gap-4">
        <ul className="flex flex-col gap-1">
          {ordered.map((a) => {
            const tag = choiceTag(network, a.accountType);
            const page = isCompanyPage(network, a.accountType);
            const shape = page ? "rounded-lg" : "rounded-full";
            return (
              <li key={a.externalAccountId}>
                <label className="flex min-h-14 cursor-pointer items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-soft">
                  <input type="checkbox" name="account" value={a.externalAccountId} defaultChecked={ticked.has(a.externalAccountId)} className="size-5 shrink-0 accent-[var(--color-pulse-blue)]" />
                  {a.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={a.avatarUrl} alt="" width={36} height={36} referrerPolicy="no-referrer" className={`size-9 shrink-0 object-cover ${shape}`} />
                  ) : (
                    <span aria-hidden className={`inline-flex size-9 shrink-0 items-center justify-center bg-soft text-sm font-semibold text-muted ${shape}`}>
                      {a.displayName.trim()[0]?.toUpperCase() ?? ""}
                    </span>
                  )}
                  {/* Name and tag go under each other on a phone instead of pushing the row wider than the screen. */}
                  <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="min-w-0 max-w-full truncate font-medium">{a.displayName}</span>
                    {tag && <Badge tone={page ? "blue" : "neutral"}>{tag}</Badge>}
                  </span>
                </label>
                {noPage && a.accountType === "member" && (
                  <p className="pb-2 pl-12 pr-2 text-[13px] text-muted">
                    {/* pageAccess: the sign-in went through a LinkedIn app that can see Pages (Upload-Post), so a missing Page means the person is not its admin. */}
                    {pageAccess
                      ? "No LinkedIn Page found. To post as your company, you must be an admin of its LinkedIn Page: ask the Page's admin to add you, then connect LinkedIn again. For now BuPulse can post on your profile."
                      : "No LinkedIn Page found. To post as your company, you must be an admin of its LinkedIn Page. If you are an admin and your Page is still missing, BuPulse may not have LinkedIn Page access yet. We are working on it. For now BuPulse can post on your profile."}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
        <div className="flex flex-wrap justify-end gap-3">
          <Button type="submit" formAction={cancelPickAction} variant="outline" size="sm" formNoValidate>
            Cancel
          </Button>
          <Button type="submit" size="sm">
            {linkedin ? "Save" : "Connect selected"}
          </Button>
        </div>
      </form>
    </GlassCard>
  );
}

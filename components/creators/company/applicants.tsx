"use client";

import { BadgeCheck, Check, Copy, ExternalLink, MessageCircle, Paperclip, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { declineApplicantAction, offerCreatorAction, resendInviteAction, selectApplicantAction, withdrawOfferAction } from "@/app/dashboard/creators/actions";
import { formatCompact } from "@/components/analytics/format";
import { Badge, Button, Dialog, GlassCard, useToast } from "@/components/ui";
import { sortByMatch, type MatchState } from "@/lib/creators/applicant-facts";
import type { AccountLine, ApplicantDetails } from "@/lib/creators/applicants-view";
import { CREATOR_STATUS_LABEL, inviteMessage, offerExpired, offerExpiresAt, PLATFORM_LABEL, whatsappLink, type Platform } from "@/lib/creators/company-forms";
import type { CampaignCreatorRow } from "@/lib/creators/campaigns";
import { useCopy } from "./campaign-controls";

type Invite = { link: string; sent: boolean; expiresAt: string; name: string; phone: string | null; companyName: string; campaignName: string };

const ago = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

/** The invite link, once: Copy, Send on WhatsApp, and whether the email went out. */
function InviteDialog({ invite, onClose }: { invite: Invite | null; onClose: () => void }) {
  const copy = useCopy();
  const wa = invite ? whatsappLink(invite.phone, inviteMessage(invite.name, invite.campaignName, invite.companyName, invite.link)) : null;
  return (
    <Dialog open={invite !== null} onOpenChange={(o) => !o && onClose()} title={invite ? `${invite.name} is invited` : "Invited"} description="Send them this link. It works once and for 14 days; they make their creator login with it.">
      {invite && (
        <div className="mt-2 flex flex-col gap-3">
          <p className="break-all rounded-2xl bg-soft px-4 py-3 font-mono text-[13px]">{invite.link}</p>
          <div className="flex flex-wrap gap-2">
            <Button leading={<Copy aria-hidden className="size-4" />} onClick={() => copy(invite.link, "Link copied.")}>
              Copy link
            </Button>
            {wa && (
              <Button href={wa} variant="outline" target="_blank" rel="noopener noreferrer" leading={<MessageCircle aria-hidden className="size-4" />}>
                Send on WhatsApp
              </Button>
            )}
          </div>
          <p className="text-[14px] text-muted">{invite.sent ? "We also emailed it to them." : "The email could not be sent: send the link on WhatsApp or copy it."} If they lose it, use New link: the old one stops working.</p>
        </div>
      )}
    </Dialog>
  );
}

/** "Matches", "Doesn't match: <reasons>" or what they did not say (docs/CREATOR_CAMPAIGN_WIZARD.md, "Requirements"). */
function MatchLine({ match }: { match: MatchState }) {
  if (match.kind === "none") return null;
  if (match.kind === "match") return <Badge tone="success" className="self-start">Matches</Badge>;
  if (match.kind === "unknown") return <span className="text-[13px] text-muted">{match.unknown.join(" · ")}</span>;
  return (
    <span className="text-[13px] font-medium text-danger">
      Doesn&apos;t match: {match.misses.join(" · ")}
      {match.unknown.length > 0 && <span className="font-normal text-muted"> · {match.unknown.join(" · ")}</span>}
    </span>
  );
}

/** One account: the network, the username, the followers they typed, and the connected account's check once there is one. */
export function AccountChip({ account }: { account: AccountLine }) {
  return (
    <li className="rounded-full bg-soft px-3 py-1.5 text-[14px]">
      <span className="font-medium">{account.label}</span> {account.handle.startsWith("@") || account.handle.startsWith("http") ? account.handle : `@${account.handle}`}
      {account.check ? (
        <span className={account.verified ? "text-success" : "text-danger"}>
          {" "}
          · {account.verified && <BadgeCheck aria-hidden className="mb-0.5 inline size-3.5" />} {account.check}
        </span>
      ) : (
        account.followers !== null && <span className="text-muted"> · {formatCompact(account.followers)} followers</span>
      )}
    </li>
  );
}

function ApplicantCard({ row, details, children }: { row: CampaignCreatorRow; details?: ApplicantDetails; children?: React.ReactNode }) {
  return (
    <GlassCard className="flex flex-col gap-3 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-[16px] font-semibold">
            {row.name}
            {row.status !== "APPLIED" && row.status !== "OFFERED" && <Badge tone={row.status === "SELECTED" ? "violet" : "neutral"}>{CREATOR_STATUS_LABEL[row.status] ?? row.status}</Badge>}
            {row.status === "OFFERED" && (offerExpired(row.offeredAt) ? <Badge tone="neutral">Expired</Badge> : <Badge tone="violet">Waiting for their answer</Badge>)}
            {row.profileId && row.source !== "OFFER" && <Badge tone="blue">Has a creator account</Badge>}
          </p>
          {row.source === "OFFER" ? (
            <p className="text-[13px] text-muted">
              Invited by you {row.offeredAt ? ago(row.offeredAt) : ""} from Find creators.{row.email ? ` ${row.email}${row.phone ? ` · ${row.phone}` : ""}` : " Their WhatsApp and email show once they join."}
            </p>
          ) : (
            <p className="text-[13px] text-muted">
              Applied {ago(row.appliedAt)} · {row.email}
              {row.phone ? ` · ${row.phone}` : ""}
            </p>
          )}
        </div>
      </div>
      {details && <MatchLine match={details.match} />}
      {details?.accounts.length ? (
        <ul className="flex flex-wrap gap-2">
          {details.accounts.map((a) => (
            <AccountChip key={`${a.network}:${a.handle}`} account={a} />
          ))}
        </ul>
      ) : (
        row.handles.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {row.handles.map((h) => (
              <li key={`${h.network}:${h.handle}`} className="rounded-full bg-soft px-3 py-1.5 text-[14px]">
                <span className="font-medium">{PLATFORM_LABEL[h.network as Platform] ?? h.network}</span> {h.handle.startsWith("@") ? h.handle : `@${h.handle}`}
                {h.followers !== null && <span className="text-muted"> · {formatCompact(h.followers)} followers</span>}
              </li>
            ))}
          </ul>
        )
      )}
      {row.samples.length > 0 && (
        <div className="flex flex-col gap-1 text-[14px]">
          <span className="font-medium">Best posts</span>
          {row.samples.map((s) => (
            <a key={s} href={s} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 break-all text-[color:var(--bp-link)] underline">
              {s.replace(/^https?:\/\/(www\.)?/, "").slice(0, 70)}
              <ExternalLink aria-hidden className="size-3.5 shrink-0" />
            </a>
          ))}
        </div>
      )}
      {details && details.answers.length > 0 && (
        <dl className="flex flex-col gap-2 text-[14px]">
          {details.answers.map((a) => (
            <div key={a.id}>
              <dt className="font-medium">{a.label}</dt>
              <dd className="whitespace-pre-wrap text-muted">
                {a.file !== undefined ? (
                  a.file ? (
                    <a href={a.file} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1.5 font-medium text-[color:var(--bp-link)] underline">
                      <Paperclip aria-hidden className="size-4" /> View file
                    </a>
                  ) : (
                    "File no longer kept"
                  )
                ) : (
                  a.text
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {children && <div className="flex flex-wrap gap-2">{children}</div>}
    </GlassCard>
  );
}

/**
 * Applicants waiting for an answer, creators the company invited from the marketplace (waiting for theirs), invited
 * applicants who have not joined yet, and those declined. Picking someone with a creator account adds them at once.
 * Each card shows the answers in words, uploads as links, every account's followers (verified once connected) and
 * whether they match the campaign's requirements; those who match come first.
 */
export function Applicants({ campaignId, rows, details, places, ended }: { campaignId: string; rows: CampaignCreatorRow[]; details: Record<string, ApplicantDetails>; places: { taken: number; limit: number }; ended: boolean }) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [invite, setInvite] = useState<Invite | null>(null);
  const [showDeclined, setShowDeclined] = useState(false);
  // Those who match the campaign's requirements first (docs/CREATOR_CAMPAIGN_WIZARD.md), newest first within each.
  const applied = sortByMatch(rows.filter((r) => r.status === "APPLIED"), (r) => details[r.id]?.match);
  const invited = rows.filter((r) => r.status === "SELECTED");
  const offered = rows.filter((r) => r.status === "OFFERED");
  const declined = rows.filter((r) => r.status === "DECLINED");
  const full = places.taken >= places.limit;

  async function pick(row: CampaignCreatorRow, again = false) {
    setBusy(row.id);
    const r = again ? await resendInviteAction(campaignId, row.id) : await selectApplicantAction(campaignId, row.id);
    setBusy(null);
    if (!r.ok) return toast(r.error, "error");
    const picked = "picked" in r ? r.picked : { joined: false as const, ...r.invite };
    // A creator with an account is in at once: no link to send.
    if (picked.joined) toast(`${picked.name} is in the campaign. ${picked.sent ? "We emailed them, and it shows" : "It shows"} in their creator account.`, "success");
    else setInvite(picked);
    router.refresh();
  }
  async function withdraw(row: CampaignCreatorRow) {
    setBusy(row.id);
    const r = await withdrawOfferAction(campaignId, row.id);
    setBusy(null);
    if (!r.ok) return toast(r.error, "error");
    toast(`Invitation to ${row.name} withdrawn.`, "success");
    router.refresh();
  }
  async function offerAgain(row: CampaignCreatorRow) {
    if (!row.profileId) return;
    setBusy(row.id);
    const r = await offerCreatorAction(campaignId, row.profileId);
    setBusy(null);
    if (!r.ok) return toast(r.error, "error");
    toast(`${row.name} is invited again. ${r.offer.sent ? "We emailed them." : ""}`.trim(), "success");
    router.refresh();
  }
  async function decline(row: CampaignCreatorRow) {
    setBusy(row.id);
    const r = await declineApplicantAction(campaignId, row.id);
    setBusy(null);
    if (!r.ok) return toast(r.error, "error");
    toast(`${row.name} declined.`, "success");
    router.refresh();
  }

  const selectButton = (row: CampaignCreatorRow, label = "Select") => (
    <Button size="sm" disabled={busy !== null || full || ended} title={full ? "All places on your plan are taken" : undefined} leading={<Check aria-hidden className="size-4" />} onClick={() => pick(row)}>
      {busy === row.id ? "One moment…" : label}
    </Button>
  );

  return (
    <div className="flex flex-col gap-5">
      <p className="px-1 text-[14px] text-muted">
        {places.taken} of {places.limit} places taken on your plan (invited and joined creators, and invitations waiting for an answer).{full ? " Remove a creator, or cancel or withdraw an invitation, to pick someone else." : ""}
      </p>
      <section className="flex flex-col gap-3">
        <h2 className="px-1 text-[17px] font-semibold">Waiting for your answer ({applied.length})</h2>
        {applied.length === 0 && (
          <p className="px-1 text-[15px] text-muted">
            Nobody is waiting. Share the campaign&apos;s application page to get applicants, or{" "}
            <Link href="/dashboard/creators/find" className="font-medium text-[color:var(--bp-link)] underline">
              find creators
            </Link>{" "}
            and invite them.
          </p>
        )}
        {applied.map((row) => (
          <ApplicantCard key={row.id} row={row} details={details[row.id]}>
            {selectButton(row)}
            <Button size="sm" variant="outline" disabled={busy !== null} leading={<X aria-hidden className="size-4" />} onClick={() => decline(row)}>
              Decline
            </Button>
          </ApplicantCard>
        ))}
      </section>
      {offered.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="px-1 text-[17px] font-semibold">Invited by you, waiting for their answer ({offered.length})</h2>
          {offered.map((row) => {
            const expired = offerExpired(row.offeredAt);
            return (
              <ApplicantCard key={row.id} row={row} details={details[row.id]}>
                <span className="self-center text-[13px] text-muted">{expired ? "They did not answer in 14 days." : row.offeredAt ? `They can answer until ${ago(offerExpiresAt(row.offeredAt).toISOString())}.` : ""}</span>
                {expired && row.profileId && (
                  <Button size="sm" disabled={busy !== null || full || ended} onClick={() => offerAgain(row)}>
                    {busy === row.id ? "One moment…" : "Invite again"}
                  </Button>
                )}
                <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => withdraw(row)}>
                  Withdraw
                </Button>
              </ApplicantCard>
            );
          })}
        </section>
      )}
      {invited.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="px-1 text-[17px] font-semibold">Invited, not joined yet ({invited.length})</h2>
          {invited.map((row) => (
            <ApplicantCard key={row.id} row={row} details={details[row.id]}>
              <span className="self-center text-[13px] text-muted">{row.inviteExpiresAt && new Date(row.inviteExpiresAt) < new Date() ? "The link expired." : row.inviteExpiresAt ? `Link works until ${ago(row.inviteExpiresAt)}.` : ""}</span>
              <Button size="sm" variant="outline" disabled={busy !== null || ended} onClick={() => pick(row, true)}>
                {busy === row.id ? "One moment…" : "New link"}
              </Button>
              <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => decline(row)}>
                Cancel invite
              </Button>
            </ApplicantCard>
          ))}
        </section>
      )}
      {declined.length > 0 && (
        <section className="flex flex-col gap-3">
          <button type="button" onClick={() => setShowDeclined(!showDeclined)} aria-expanded={showDeclined} className="min-h-11 self-start px-1 text-[15px] font-semibold text-muted hover:text-text">
            {showDeclined ? "Hide" : "Show"} declined ({declined.length})
          </button>
          {showDeclined &&
            declined.map((row) => (
              <ApplicantCard key={row.id} row={row} details={details[row.id]}>
                {row.source !== "OFFER" ? (
                  selectButton(row, "Select after all")
                ) : row.profileId ? (
                  <Button size="sm" variant="outline" disabled={busy !== null || full || ended} onClick={() => offerAgain(row)}>
                    {busy === row.id ? "One moment…" : "Invite again"}
                  </Button>
                ) : null}
              </ApplicantCard>
            ))}
        </section>
      )}
      <InviteDialog invite={invite} onClose={() => setInvite(null)} />
    </div>
  );
}

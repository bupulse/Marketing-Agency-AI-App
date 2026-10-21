"use client";

import { BadgeCheck, ExternalLink, MapPin, MessageCircle, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { offerCreatorAction } from "@/app/dashboard/creators/actions";
import { formatCompact } from "@/components/analytics/format";
import { Button, Dialog, Field, GlassCard, Select, useToast } from "@/components/ui";
import { CAMPAIGN_STATUS_LABEL, CREATOR_STATUS_LABEL, OFFER_DAYS, PLATFORM_LABEL, whatsappLink, type CampaignStatus, type Platform } from "@/lib/creators/company-forms";
import type { FoundCreator } from "@/lib/creators/finder";
import type { OfferCampaign } from "@/lib/creators/offers";
import { ReportCreator } from "./report-creator";

const handleText = (h: string) => (h.startsWith("@") ? h : `@${h}`);

/** Where the creator already stands in a campaign of this company, or null when they can be invited to it. */
function standing(creator: FoundCreator, campaignId: string): string | null {
  const s = creator.campaigns.find((c) => c.campaignId === campaignId);
  if (!s || (s.status === "OFFERED" && s.expired) || s.status === "DECLINED") return null;
  return s.status === "OFFERED" ? "invited, waiting for their answer" : (CREATOR_STATUS_LABEL[s.status] ?? s.status).toLowerCase();
}

/** The campaign record in words: counts only, across every company. */
function Record({ r }: { r: FoundCreator["record"] }) {
  if (r.joined === 0) return <p className="text-[14px] text-muted">New to BuPulse campaigns.</p>;
  const items: [string, string][] = [
    ["Campaigns", `${r.joined} joined · ${r.ended} ended`],
    ["Posts that counted", formatCompact(r.countedPosts)],
    ["Views", formatCompact(r.views)],
    ["Removed or rejected", String(r.removedPosts)],
  ];
  return (
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {items.map(([label, value]) => (
        <div key={label} className="rounded-2xl bg-soft px-3 py-2">
          <dt className="text-[12px] text-muted">{label}</dt>
          <dd className={label === "Removed or rejected" && r.removedPosts > 0 ? "text-[15px] font-semibold tabular-nums text-danger" : "text-[15px] font-semibold tabular-nums"}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function CreatorCard({ creator, onInvite }: { creator: FoundCreator; onInvite: () => void }) {
  const wa = creator.contact ? whatsappLink(creator.contact.phone, `Hi ${creator.name.split(/\s+/)[0]}, `) : null;
  return (
    <GlassCard className="flex flex-col gap-3 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-[17px] font-semibold">{creator.name}</h2>
          {creator.location && (
            <p className="inline-flex items-center gap-1 text-[14px] text-muted">
              <MapPin aria-hidden className="size-4" /> {creator.location}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" leading={<Send aria-hidden className="size-4" />} onClick={onInvite}>
            Invite
          </Button>
          <ReportCreator profileId={creator.id} name={creator.name} />
        </div>
      </div>
      {creator.bio && <p className="whitespace-pre-wrap text-[15px]">{creator.bio}</p>}
      {creator.handles.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {creator.handles.map((h) => (
            <li key={`${h.network}:${h.handle}`} className="inline-flex items-center gap-1 rounded-full bg-soft px-3 py-1.5 text-[14px]">
              <span className="font-medium">{PLATFORM_LABEL[h.network as Platform] ?? h.network}</span> {handleText(h.handle)}
              {h.followers !== null && <span className="text-muted"> · {formatCompact(h.followers)} followers</span>}
              {h.verified && (
                <span className="inline-flex items-center gap-0.5 text-success" title="They connected this account to BuPulse">
                  <BadgeCheck aria-hidden className="size-4" />
                  <span className="text-[13px] font-medium">Verified</span>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {creator.samples.length > 0 && (
        <div className="flex flex-col gap-1 text-[14px]">
          <span className="font-medium">Best posts</span>
          {creator.samples.map((s) => (
            <a key={s} href={s} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 break-all text-[color:var(--bp-link)] underline">
              {s.replace(/^https?:\/\/(www\.)?/, "").slice(0, 70)}
              <ExternalLink aria-hidden className="size-3.5 shrink-0" />
            </a>
          ))}
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <span className="text-[14px] font-medium">Record in BuPulse campaigns</span>
        <Record r={creator.record} />
      </div>
      {creator.contact ? (
        <div className="flex flex-wrap items-center gap-2 text-[14px]">
          <span className="text-muted">
            {creator.contact.email}
            {creator.contact.phone ? ` · ${creator.contact.phone}` : ""}
          </span>
          {wa && (
            <Button href={wa} size="sm" variant="outline" target="_blank" rel="noopener noreferrer" leading={<MessageCircle aria-hidden className="size-4" />}>
              WhatsApp
            </Button>
          )}
        </div>
      ) : (
        <p className="text-[13px] text-muted">Their WhatsApp and email show once they apply to or join one of your campaigns.</p>
      )}
    </GlassCard>
  );
}

/** The creators found, each with Invite (pick a live or draft campaign) and Report. */
export function CreatorFinder({ creators, campaigns }: { creators: FoundCreator[]; campaigns: OfferCampaign[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [inviting, setInviting] = useState<FoundCreator | null>(null);
  const [campaignId, setCampaignId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function open(creator: FoundCreator) {
    setInviting(creator);
    setError(null);
    setCampaignId(campaigns.find((c) => standing(creator, c.id) === null)?.id ?? "");
  }
  async function invite() {
    if (!inviting || !campaignId) return;
    setBusy(true);
    setError(null);
    const r = await offerCreatorAction(campaignId, inviting.id);
    setBusy(false);
    if (!r.ok) return setError(r.error);
    toast(`${r.offer.name} is invited to "${r.offer.campaignName}".${r.offer.sent ? " We emailed them." : ""} See their answer on the campaign's Applicants.`, "success");
    setInviting(null);
    router.refresh();
  }

  const free = inviting ? campaigns.filter((c) => standing(inviting, c.id) === null) : [];
  return (
    <>
      <ul className="flex flex-col gap-3">
        {creators.map((c) => (
          <li key={c.id}>
            <CreatorCard creator={c} onInvite={() => open(c)} />
          </li>
        ))}
      </ul>
      <Dialog
        open={inviting !== null}
        onOpenChange={(o) => !o && setInviting(null)}
        title={`Invite ${inviting?.name ?? "this creator"}`}
        description={`They get an email and see the invitation in their creator account. They have ${OFFER_DAYS} days to accept or decline. Until then the invitation takes one of the campaign's places.`}
      >
        {inviting && (
          <div className="mt-2 flex flex-col gap-4">
            {campaigns.length === 0 ? (
              <p className="text-[15px] text-muted">You have no live or draft campaign to invite them to. Make one first.</p>
            ) : (
              <>
                <Field label="Campaign" required>
                  <Select value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
                    <option value="" disabled>
                      Pick a campaign
                    </option>
                    {campaigns.map((c) => {
                      const s = standing(inviting, c.id);
                      return (
                        <option key={c.id} value={c.id} disabled={s !== null}>
                          {c.name} ({CAMPAIGN_STATUS_LABEL[c.status as CampaignStatus] ?? c.status}){s ? `: ${s}` : ""}
                        </option>
                      );
                    })}
                  </Select>
                </Field>
                {free.length === 0 && <p className="text-[14px] text-muted">They are already in, or invited to, all your live and draft campaigns.</p>}
              </>
            )}
            {error && (
              <p role="alert" className="rounded-2xl bg-danger-bg px-4 py-3 text-[15px] font-medium text-danger">
                {error}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button disabled={busy || !campaignId} onClick={invite}>
                {busy ? "Sending…" : "Send invitation"}
              </Button>
              <Button variant="outline" onClick={() => setInviting(null)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </>
  );
}

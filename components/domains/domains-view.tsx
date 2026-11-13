import { Cloud, Globe, KeyRound } from "lucide-react";
import { ExpandCard, KitStyles, PageHeader, StatusPill } from "@/components/admin/kit";
import { BPanel } from "@/components/app/kit/b-cards";
import { DisconnectCloudflareButton } from "@/components/domains/disconnect-button";
import { TokenForm } from "@/components/domains/token-form";
import { ZoneList, type ZoneItem } from "@/components/domains/zone-list";

/**
 * /dashboard/domains: not connected (or the token stopped working): four short numbered steps and one box for the
 * token. Connected: a slim Cloudflare card and the domains with "Install chat" each. Presentational.
 */
export function DomainsView({ connected, problem, tokenUrl, zones, snippet }: { connected: boolean; problem: string | null; tokenUrl: string; zones: ZoneItem[]; snippet: string }) {
  return (
    <>
      <KitStyles />
      <PageHeader icon={Globe} tone="teal" title="Your domains" description="Connect Cloudflare to see your domains and add the BuPulse chat to a website in one click." />
      {!connected ? (
        <BPanel id="connect" icon={KeyRound} tone="teal" title="Connect Cloudflare" hint="About 2 minutes. You copy one code from Cloudflare and paste it here.">
          {problem && (
            <p role="alert" className="rounded-2xl bg-danger-bg px-4 py-3 text-[14px] text-danger">
              {problem} Paste a new token below.
            </p>
          )}
          <ol className="kit-rise flex flex-col gap-2">
            {[
              <>
                <a href={tokenUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-pulse-blue">
                  Open Cloudflare&apos;s token page
                </a>{" "}
                (it opens with the right permissions ticked).
              </>,
              <>
                Check these two permissions are listed: <strong>Zone, Zone, Read</strong> and <strong>Zone, Zaraz, Edit</strong>. If not, add them with &quot;Add more&quot;. Leave &quot;Zone Resources&quot; on <em>All zones</em> (or choose just your site).
              </>,
              <>
                Click <strong>Continue to summary</strong>, then <strong>Create Token</strong>, and copy the token. Cloudflare shows it only once.
              </>,
              <>Paste it below. BuPulse keeps it encrypted and never shows it again.</>,
            ].map((step, i) => (
              <li key={i} className="flex items-start gap-3 rounded-2xl bg-soft px-3.5 py-3 text-[14px] leading-snug">
                <span aria-hidden className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-gradient text-[12px] font-bold text-white">
                  {i + 1}
                </span>
                <span className="min-w-0 pt-0.5">{step}</span>
              </li>
            ))}
          </ol>
          <TokenForm />
        </BPanel>
      ) : (
        <>
          <BPanel
            id="cloudflare"
            icon={Cloud}
            tone="teal"
            title={
              <span className="inline-flex flex-wrap items-center gap-2">
                Cloudflare
                <StatusPill tone="good" dot>
                  Connected
                </StatusPill>
              </span>
            }
            hint={`${zones.length} ${zones.length === 1 ? "domain" : "domains"} found. Tap Install chat on the site you want it on.`}
            aside={<DisconnectCloudflareButton />}
          />
          <ZoneList zones={zones} snippet={snippet} />
          <ExpandCard icon={Globe} tone="slate" title="What installing does" summary="A small tool in Zaraz, undone by Remove">
            <p className="text-[14px] text-muted">
              Installing adds a small &quot;Custom HTML&quot; tool in your domain&apos;s Zaraz settings and the domain to your chat&apos;s allowed websites. Remove undoes it. Disconnecting keeps chats that are already installed.
            </p>
          </ExpandCard>
        </>
      )}
    </>
  );
}

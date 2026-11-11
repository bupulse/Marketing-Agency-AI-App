import { ArrowRight, BadgeCheck, Briefcase, Compass, KeyRound, LayoutDashboard, Megaphone, MessageSquareReply, Search } from "lucide-react";
import { Button, Container } from "@/components/ui";
import { RiseIn } from "./rise-in";
import "./motion.css";

// BuPulse Agency, coming soon (the Agency OS, agencyos.bupulse.com; its README in the bupulse-agency-os project).
// Claims stay modest: what phase 1 is built to do, and that it is not open yet. "Tell me when it's ready" makes the
// one BuPulse account and lands on the "What do you want to start?" step with Agency ticked (app/apps/start), which
// puts the person on the list; no new backend.

export const AGENCY_WAITLIST_HREF = `/signup?next=${encodeURIComponent("/apps/start?want=agency")}`;

const points = [
  { icon: KeyRound, title: "One BuPulse account", text: "Sign in once at bupulse.com for Marketing and Agency." },
  { icon: LayoutDashboard, title: "Clients and projects in one place", text: "Run your agency’s clients, projects and reports from one screen." },
  { icon: Compass, title: "AI departments do the work", text: "Ask in plain words: research, lead pages and lead follow-ups are prepared for you." },
  { icon: BadgeCheck, title: "You approve first", text: "Nothing that spends money or reaches a customer goes out before you say yes." },
];

const departments = [
  { icon: Search, name: "Research", task: "Market and competitor teardown" },
  { icon: Megaphone, name: "Marketing", task: "One-page lead site, ready to preview" },
  { icon: MessageSquareReply, name: "Sales", task: "Reply to 3 new leads" },
];

export function AgencySection() {
  return (
    <section id="agency" aria-labelledby="agency-title" data-scene="deep" className="ag scene-dark scroll-mt-24 py-24 sm:py-32">
      <Container>
        <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,460px)] lg:gap-16">
          <div className="flex min-w-0 flex-col gap-6">
            <RiseIn>
              <p className="m-0 inline-flex items-center gap-2 rounded-full border border-line bg-soft px-3 py-1.5 text-sm font-semibold">
                <Briefcase aria-hidden className="size-4 text-new" />
                BuPulse Agency
                <span className="rounded-full bg-brand-gradient px-2 py-0.5 text-xs text-white">Coming soon</span>
              </p>
              <h2 id="agency-title" className="m-0 mt-5 text-[clamp(32px,5vw,60px)] leading-[1.03] font-bold tracking-[-0.04em]">
                An AI team for your agency. <span className="ag-grad">Almost here.</span>
              </h2>
            </RiseIn>
            <RiseIn>
              <p className="m-0 max-w-2xl text-lg leading-relaxed text-muted">
                BuPulse Agency is the next part of BuPulse. You ask in plain words, AI departments prepare the work, and you
                approve it before anything goes out. It isn’t open yet: join the list and we’ll tell you the day it is.
              </p>
            </RiseIn>
            <ul className="m-0 grid list-none gap-4 p-0 sm:grid-cols-2">
              {points.map(({ icon: Icon, title, text }) => (
                <RiseIn as="li" key={title} className="glass flex gap-3.5 rounded-[22px] p-4">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-gradient text-white">
                    <Icon aria-hidden className="size-[18px]" />
                  </span>
                  <div className="flex min-w-0 flex-col gap-1">
                    <h3 className="m-0 text-[16px] font-semibold">{title}</h3>
                    <p className="m-0 text-[14px] leading-relaxed text-muted">{text}</p>
                  </div>
                </RiseIn>
              ))}
            </ul>
            <RiseIn className="flex flex-wrap items-center gap-4">
              <Button href={AGENCY_WAITLIST_HREF} size="lg" trailing={<ArrowRight aria-hidden className="size-[18px]" />}>
                Tell me when it’s ready
              </Button>
              <span className="text-sm text-muted">Free to join the list. Uses your one BuPulse account.</span>
            </RiseIn>
          </div>

          <div className="ag-visual">
            <div aria-hidden className="ag-orbit" />
            {/* An AI photo (the app's image model) of the kind of team BuPulse Agency is for; the panel is a preview. */}
            {/* eslint-disable-next-line @next/next/no-img-element -- pre-sized WebP with srcset; next/image would add a server round trip per size */}
            <img
              src="/marketing/photos/agency-480.webp"
              srcSet="/marketing/photos/agency-480.webp 480w, /marketing/photos/agency-880.webp 880w"
              sizes="(min-width: 1024px) 440px, calc(100vw - 32px)"
              alt="A small agency team in a bright Kigali office, gathered around a laptop"
              width={480}
              height={360}
              loading="lazy"
              decoding="async"
              className="ag-photo"
            />
            <div aria-hidden className="ag-panel glass-strong">
              <div className="ag-panel-top">
                <span className="ag-dot" />
                <strong>Agency</strong>
                <span className="ag-soon">Preview</span>
              </div>
              <div className="ag-ask">“Find me 20 new clients for a salon in Kigali”</div>
              <ul className="ag-deps">
                {departments.map(({ icon: Icon, name, task }, i) => (
                  <li key={name} style={{ ["--i" as string]: i }}>
                    <span className="ag-ico">
                      <Icon className="size-4" />
                    </span>
                    <span className="ag-dep">
                      <b>{name}</b>
                      <small>{task}</small>
                    </span>
                    <span className="ag-bar">
                      <i />
                    </span>
                  </li>
                ))}
              </ul>
              <div className="ag-approve">
                <span>
                  <b>Approval needed</b>
                  <small>Send replies to 3 leads</small>
                </span>
                <span className="ag-btn">Approve</span>
              </div>
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}

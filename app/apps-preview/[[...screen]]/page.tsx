import { notFound } from "next/navigation";
import { ServiceChooser, ServicePicker, ServicesPage, type CardView, type PickState } from "@/components/platform/service-cards";
import { ServiceSwitcher } from "@/components/platform/service-switcher";
import { SERVICES } from "@/lib/platform/app-hosts";
import { previewAllowed } from "@/lib/support/preview";

export const metadata = { title: "Services preview", robots: { index: false, follow: false } };

const marketing = SERVICES.find((s) => s.id === "marketing")!;
const agency = SERVICES.find((s) => s.id === "agency")!;
const CARDS: CardView[] = [
  { id: "marketing", name: marketing.name, tagline: marketing.tagline, href: "#", company: "Kigali Coffee Roasters", status: "Free trial, 9 days left" },
  { id: "creator", name: "Creator portal", tagline: "Your campaigns, tasks and earnings as a content creator.", href: "#", company: null, status: null },
];
const WAITING: CardView[] = [{ id: "agency", name: agency.name, tagline: agency.tagline, href: null, company: null, status: "Coming soon. We will email you when it is ready" }];

async function noSave(): Promise<PickState> {
  "use server";
  return { error: "This is the preview: nothing is saved." };
}

/**
 * Development only: the service chooser (/apps), the "What do you want to start?" step (/apps/start) and the Marketing
 * top bar's service switcher, with made-up data, no sign-in and no database (docs/HOSTS.md). Not found in production.
 * /apps-preview, /apps-preview/start, /apps-preview/listed, /apps-preview/switcher.
 */
export default async function AppsPreview({ params }: PageProps<"/apps-preview/[[...screen]]">) {
  if (!previewAllowed()) notFound();
  const screen = (await params).screen?.[0] ?? "chooser";
  if (screen === "start" || screen === "listed")
    return (
      <ServicesPage email="owner@example.com">
        <ServicePicker action={noSave} initial={["marketing"]} listed={screen === "listed"} />
      </ServicesPage>
    );
  if (screen === "switcher")
    return (
      <div className="min-h-dvh bg-bg p-4 sm:p-8">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 rounded-[24px] border border-line bg-surface p-3">
          <span className="text-[15px] font-semibold">Welcome back, Aline</span>
          <ServiceSwitcher chooser="#" agencyPicked />
        </div>
        <p className="mx-auto mt-3 max-w-3xl text-sm text-muted">Tap the switcher to open it.</p>
      </div>
    );
  return (
    <ServicesPage email="owner@example.com">
      <ServiceChooser firstName="Aline" cards={CARDS} waiting={WAITING} addHref={null} />
    </ServicesPage>
  );
}

import { Camera, Plug, Sparkles } from "lucide-react";
import { getAppContext } from "@/components/app/context";
import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { PlanBoard } from "@/components/autopilot/plan-board";
import { SettingsCard } from "@/components/autopilot/settings-card";
import { Button } from "@/components/ui";
import { loadAutopilotView } from "@/lib/autopilot/view";

export const metadata = { title: "Autopilot" };

export default async function AutopilotPage() {
  const { user, usage } = await getAppContext();
  const view = await loadAutopilotView(user.id);
  const creditsLeft = Math.max(0, usage.limits.text - usage.used.text);

  return (
    <>
      <PageHeader title="Autopilot" description="AI plans your week of posts, writes one for each network and gets them ready for you to approve." />
      {!view || view.accounts.length === 0 ? (
        <EmptyState
          icon={Sparkles}
          title="Connect an account to start"
          text="Autopilot writes for the accounts you connect: LinkedIn posts and articles, Instagram and Facebook pictures, and TikTok or YouTube scripts. It works best with a few of your own photos."
          points={["Connect Instagram, Facebook, LinkedIn, TikTok or YouTube", "Upload photos of your products, team and work", "Switch Autopilot on and approve your week in one tap"]}
          action={
            <div className="flex flex-wrap justify-center gap-3">
              <Button href="/dashboard/connections" leading={<Plug aria-hidden className="size-5" />}>
                Connect accounts
              </Button>
              <Button href="/dashboard/gallery" variant="outline" leading={<Camera aria-hidden className="size-5" />}>
                Upload photos
              </Button>
            </div>
          }
        />
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
          <SettingsCard initial={view.config} accounts={view.accounts} timeZone={view.timeZone} />
          <PlanBoard view={view} creditsLeft={creditsLeft} />
        </div>
      )}
    </>
  );
}

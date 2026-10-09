import { Camera, Plug, Sparkles } from "lucide-react";
import { getAppContext } from "@/components/app/context";
import { EmptyState } from "@/components/app/empty-state";
import { featureGate } from "@/components/app/no-access";
import { PageHeader } from "@/components/app/page-header";
import { PlanBoard } from "@/components/autopilot/plan-board";
import { SettingsCard } from "@/components/autopilot/settings-card";
import { Button, GlassCard } from "@/components/ui";
import { askMessage, can } from "@/lib/team/roles";
import { loadAutopilotView } from "@/lib/autopilot/view";

export const metadata = { title: "Autopilot" };

export default async function AutopilotPage() {
  const blocked = await featureGate("autopilot");
  if (blocked) return blocked;
  const { user, usage, role } = await getAppContext();
  const canConfigure = can(role, "autopilotSettings");
  const canConnect = can(role, "channels");
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
              {canConnect ? (
                <Button href="/dashboard/connections" leading={<Plug aria-hidden className="size-5" />}>
                  Connect accounts
                </Button>
              ) : (
                <p className="text-sm text-muted">{askMessage("channels")}</p>
              )}
              <Button href="/dashboard/gallery" variant="outline" leading={<Camera aria-hidden className="size-5" />}>
                Upload photos
              </Button>
            </div>
          }
        />
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
          {canConfigure ? (
            <SettingsCard initial={view.config} accounts={view.accounts} timeZone={view.timeZone} />
          ) : (
            <GlassCard as="section" aria-labelledby="ap-settings" className="flex flex-col gap-2 p-5">
              <h2 id="ap-settings" className="text-lg font-semibold">Autopilot settings</h2>
              <p className="text-sm text-muted">{view.config.enabled ? "Autopilot is on." : "Autopilot is off."} {askMessage("autopilotSettings")}</p>
            </GlassCard>
          )}
          <PlanBoard view={view} creditsLeft={creditsLeft} />
        </div>
      )}
    </>
  );
}

import { getAppContext } from "@/components/app/context";
import { PageHeader } from "@/components/app/page-header";
import { Badge, GlassCard, Meter } from "@/components/ui";

export const metadata = { title: "Usage" };

export default async function UsagePage() {
  const { usage, isTrial, entitlements } = await getAppContext();
  const { used, limits, plan, subscription } = usage;
  const rows = [
    { label: "Text generations", unit: "generations", key: "text" as const },
    { label: "AI image credits", unit: "credits", key: "image" as const },
    { label: "Videos", unit: "videos", key: "videos" as const },
    { label: "Voice characters", unit: "characters", key: "voiceCharacters" as const },
    // Video Studio credits (docs/VIDEO_APP_INTEGRATION.md): only for plans with the studio; unused ones do not roll over.
    ...(entitlements.inPlan.has("videoStudio") ? [{ label: "Video Studio credits", unit: "credits", key: "videoCredits" as const }] : []),
  ];
  const periodEnd = subscription.currentPeriodEnd;

  return (
    <>
      <PageHeader
        title="Usage"
        description={
          isTrial
            ? "What you have used during your free trial."
            : `What you have used this billing period${periodEnd ? `, which ends ${periodEnd.toLocaleDateString("en-US", { month: "long", day: "numeric" })}` : ""}.`
        }
        action={<Badge tone="blue">{plan.name}</Badge>}
      />
      <GlassCard className="p-5 sm:p-6">
        <table className="w-full text-left text-[15px]">
          <caption className="sr-only">Usage against your plan limits</caption>
          <thead>
            <tr className="text-[13px] text-muted">
              <th scope="col" className="pb-3 pr-4 font-medium">Metric</th>
              <th scope="col" className="hidden pb-3 pr-4 font-medium sm:table-cell">Progress</th>
              <th scope="col" className="pb-3 text-right font-medium">Used / limit</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ label, key }) => {
              const unavailable = limits[key] === 0;
              return (
                <tr key={key} className="border-t border-line">
                  <th scope="row" className="py-4 pr-4 font-medium">{label}</th>
                  <td className="hidden w-1/2 py-4 pr-4 sm:table-cell">
                    <Meter value={used[key]} max={limits[key]} label={label} />
                  </td>
                  <td className="py-4 text-right tabular-nums text-muted">
                    {unavailable ? "Not in plan" : `${used[key]} / ${limits[key]}`}
                    {/* Videos: at most 30 seconds each and a few a day (lib/usage.ts consumeDailyVideo). */}
                    {key === "videos" && !unavailable && (
                      <span className="block text-[13px]">
                        {usage.videosToday} of {usage.videosPerDay} today · up to 30 s each
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </GlassCard>
    </>
  );
}

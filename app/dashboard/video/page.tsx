import { Clapperboard } from "lucide-react";
import { getAppContext } from "@/components/app/context";
import { EmptyState } from "@/components/app/empty-state";
import { featureGate } from "@/components/app/no-access";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui";
import { CreateStudio, type StudioTemplate } from "@/components/video-studio/create-studio";
import { subjectOptions } from "@/lib/knowledge/service";
import { CLAUDE_VIDEO_CREDITS, VOICE_OVER_CREDITS } from "@/lib/video-engine/credits";
import { TEMPLATE_CATEGORIES, VIDEO_TEMPLATES } from "@/lib/video-engine/templates";
import { listStudioJobs, studioTracks } from "@/lib/video-studio/library";

export const metadata = { title: "Video Studio" };

// The Video Studio's Create page (docs/VIDEO_APP_INTEGRATION.md, task 6), first release: Motion videos only. Claude
// designs the video (POST /api/video/design, video credits), this browser draws and encodes the MP4, and the MP4 is
// saved into the Gallery's "Video Studio" folder.
export default async function VideoStudioPage() {
  const blocked = await featureGate("videoStudio");
  if (blocked) return blocked;
  const { business, usage } = await getAppContext();
  const [options, jobs, tracks] = await Promise.all([subjectOptions(business.id), listStudioJobs(business.id), studioTracks()]);
  // Presenter templates wait for the AI presenters (a later release); the designer would fall back to the product anyway.
  const templates: StudioTemplate[] = VIDEO_TEMPLATES.filter((t) => !t.presenter).map(({ id, category, name, blurb, seconds, hook }) => ({ id, category, name, blurb, seconds: seconds ?? null, hook: hook ?? null }));
  const categories = TEMPLATE_CATEGORIES.filter((c) => templates.some((t) => t.category === c.id)).map((c) => ({ id: c.id as string, name: c.name as string }));

  return (
    <>
      <PageHeader title="Video Studio" description={`Animated product videos designed by AI from your products, prices and photos. Each video uses ${CLAUDE_VIDEO_CREDITS} video credits; making the MP4 is free.`} />
      {options.products.length === 0 ? (
        <EmptyState
          icon={Clapperboard}
          title="Add a product first"
          text="Videos are made from a product or service: its name, price and photos. Add one to your knowledge base, then come back."
          action={<Button href="/dashboard/knowledge/products">Add a product</Button>}
        />
      ) : (
        <CreateStudio
          products={options.products.map((p) => ({ id: p.id, name: p.name }))}
          templates={templates}
          categories={categories}
          initialJobs={jobs}
          credits={{ used: usage.used.videoCredits, limit: usage.limits.videoCredits ?? 0, resetsAt: usage.resetsAt ? new Date(usage.resetsAt).toISOString() : null }}
          price={CLAUDE_VIDEO_CREDITS}
          voicePrice={VOICE_OVER_CREDITS}
          tracks={tracks}
          timeZone={business.timezone || "Africa/Kigali"}
        />
      )}
    </>
  );
}

import { pageGate } from "@/components/app/no-access";
import { getAppContext } from "@/components/app/context";
import { PageHeader } from "@/components/app/page-header";
import { BackLink } from "@/components/knowledge/back-link";
import { MarketingInterview } from "@/components/knowledge/interview";
import { getInterviewView } from "@/lib/knowledge/interview-service";

export const metadata = { title: "Digital marketing profile" };

export default async function InterviewPage() {
  const blocked = await pageGate("settings");
  if (blocked) return blocked;
  const { business } = await getAppContext();
  const view = await getInterviewView(business.id);
  return (
    <>
      <BackLink />
      <PageHeader title="Digital marketing profile" description="A short AI interview about how your brand should sound. The voice you approve is used for every post, plan and design text." />
      <MarketingInterview view={view} />
    </>
  );
}

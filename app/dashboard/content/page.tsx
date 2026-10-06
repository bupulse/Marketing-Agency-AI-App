import { PenLine } from "lucide-react";
import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";

export const metadata = { title: "Content" };

export default function ContentPage() {
  return (
    <>
      <PageHeader title="Content" description="Every caption, script and ad headline BuPulse writes for you, in one place." />
      <EmptyState
        comingSoon
        icon={PenLine}
        title="Your content studio is on its way"
        text="Generate posts from any project, edit them, regenerate and keep every version."
        points={[
          "Captions and hashtags written in your brand voice",
          "30-second video scripts and 2 to 3 ad headlines",
          "Versions for each network: length, hashtags and image shape",
        ]}
      />
    </>
  );
}

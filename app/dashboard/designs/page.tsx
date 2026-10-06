import { Image as ImageIcon } from "lucide-react";
import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";

export const metadata = { title: "Designs" };

export default function DesignsPage() {
  return (
    <>
      <PageHeader title="Designs" description="Branded images made with your logo, colours and photos." />
      <EmptyState
        comingSoon
        icon={ImageIcon}
        title="Branded designs, ready to post"
        text="Pick a template or describe an image, and BuPulse creates it in your brand style."
        points={[
          "Templates for new arrivals, offers, events, announcements and more",
          "Your logo, colours and photos applied automatically",
          "Describe the picture you want and let AI create it",
        ]}
      />
    </>
  );
}

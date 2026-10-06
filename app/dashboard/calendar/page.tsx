import { CalendarDays } from "lucide-react";
import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";

export const metadata = { title: "Calendar" };

export default function CalendarPage() {
  return (
    <>
      <PageHeader title="Calendar" description="See what is planned, what is live and what needs attention." />
      <EmptyState
        comingSoon
        icon={CalendarDays}
        title="Plan your posts on a calendar"
        text="Schedule content for your connected accounts and watch it go out at the right time."
        points={[
          "Drag posts to reschedule",
          "See scheduled, published and failed posts at a glance",
          "Retry or edit a post before it goes out",
        ]}
      />
    </>
  );
}

import { requirePermission } from "@/lib/admin/auth";
import { robotStatus } from "@/lib/visuals/robot";
import { VideoRobotPage } from "@/components/admin/system/services/more-services";

export const metadata = { title: "Video robot" };

/** Admin -> Services -> Video robot: the GitHub Actions robot that makes content videos. */
export default async function VideoRobotRoute() {
  await requirePermission("system"); // pages render alongside the layout, so check here too
  return <VideoRobotPage robot={await robotStatus()} />;
}

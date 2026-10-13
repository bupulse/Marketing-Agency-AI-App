import type { NextRequest } from "next/server";
import { readBody, robotGuard, robotJson } from "@/lib/visuals/robot-auth";
import { peekRobotVideos, recordRobotRun } from "@/lib/visuals/robot";

// Video robot (docs/VIDEO_ROBOT.md): how many videos wait. The workflow installs Chrome tooling only when some do;
// an idle run still leaves its heartbeat here.
export async function POST(request: NextRequest) {
  const denied = await robotGuard(request);
  if (denied) return denied;
  await readBody(request);
  const waiting = await peekRobotVideos();
  if (waiting === 0) await recordRobotRun({ claimed: 0, made: 0, failed: 0, waiting: 0 });
  return robotJson({ waiting }, 200);
}

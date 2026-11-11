import type { NextRequest } from "next/server";
import { readBody, robotGuard, robotJson } from "@/lib/visuals/robot-auth";
import { peekRobotVideos, recordRobotRun } from "@/lib/visuals/robot";

// Video robot (docs/VIDEO_ROBOT.md): how many videos wait. The workflow installs Chrome tooling only when some do;
// an idle run still leaves its heartbeat here. The PC's render worker (docs/SELF_HOST.md, "Videos made on the PC")
// asks every few seconds with { quiet: true }: no heartbeat row each time (it leaves one every 15 minutes instead).
export async function POST(request: NextRequest) {
  const denied = await robotGuard(request);
  if (denied) return denied;
  const body = await readBody(request);
  const waiting = await peekRobotVideos();
  if (waiting === 0 && body?.quiet !== true) await recordRobotRun({ claimed: 0, made: 0, failed: 0, waiting: 0 });
  return robotJson({ waiting }, 200);
}

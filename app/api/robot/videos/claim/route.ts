import type { NextRequest } from "next/server";
import { z } from "zod";
import { readBody, robotGuard, robotJson } from "@/lib/visuals/robot-auth";
import { claimRobotVideos, ROBOT_MAX_CLAIM } from "@/lib/visuals/robot";

export const maxDuration = 60;

const schema = z.object({ max: z.number().int().min(1).max(ROBOT_MAX_CLAIM).optional(), format: z.enum(["mp4", "webm"]).optional() });

// Video robot (docs/VIDEO_ROBOT.md): claims a few pending videos under the render lease, each with its plan, photo
// download URLs and a reserved upload URL.
export async function POST(request: NextRequest) {
  const denied = await robotGuard(request);
  if (denied) return denied;
  const parsed = schema.safeParse((await readBody(request)) ?? {});
  if (!parsed.success) return robotJson({ error: "Bad request" }, 400);
  return robotJson({ jobs: await claimRobotVideos(parsed.data) }, 200);
}

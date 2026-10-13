import type { NextRequest } from "next/server";
import { z } from "zod";
import { readBody, robotGuard, robotJson } from "@/lib/visuals/robot-auth";
import { failRobotVideo, ROBOT_FAILURES } from "@/lib/visuals/robot";

const schema = z.object({ job: z.uuid(), reason: z.enum(ROBOT_FAILURES) });

// Video robot (docs/VIDEO_ROBOT.md): the video could not be made; release it and count the attempt.
export async function POST(request: NextRequest) {
  const denied = await robotGuard(request);
  if (denied) return denied;
  const parsed = schema.safeParse(await readBody(request));
  if (!parsed.success) return robotJson({ error: "Bad request" }, 400);
  const result = await failRobotVideo(parsed.data.job, parsed.data.reason);
  return robotJson({ ok: result.ok }, result.ok ? 200 : 404);
}

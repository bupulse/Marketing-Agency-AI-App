import type { NextRequest } from "next/server";
import { z } from "zod";
import { readBody, robotGuard, robotJson } from "@/lib/visuals/robot-auth";
import { completeRobotVideo } from "@/lib/visuals/robot";

export const maxDuration = 60;

const schema = z.object({ job: z.uuid() });

// Video robot (docs/VIDEO_ROBOT.md): the file is uploaded; confirm it exactly like the browser's upload.
export async function POST(request: NextRequest) {
  const denied = await robotGuard(request);
  if (denied) return denied;
  const parsed = schema.safeParse(await readBody(request));
  if (!parsed.success) return robotJson({ error: "Bad request" }, 400);
  const result = await completeRobotVideo(parsed.data.job);
  return robotJson(result, result.ok ? 200 : result.error === "unknown_job" ? 404 : 422);
}

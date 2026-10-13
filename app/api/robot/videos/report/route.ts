import type { NextRequest } from "next/server";
import { z } from "zod";
import { readBody, robotGuard, robotJson } from "@/lib/visuals/robot-auth";
import { recordRobotRun } from "@/lib/visuals/robot";

const count = z.number().int().min(0).max(1000);
const schema = z.object({ claimed: count, made: count, failed: count });

// Video robot (docs/VIDEO_ROBOT.md): the end-of-run heartbeat, counts only.
export async function POST(request: NextRequest) {
  const denied = await robotGuard(request);
  if (denied) return denied;
  const parsed = schema.safeParse(await readBody(request));
  if (!parsed.success) return robotJson({ error: "Bad request" }, 400);
  await recordRobotRun(parsed.data);
  return robotJson({ ok: true }, 200);
}

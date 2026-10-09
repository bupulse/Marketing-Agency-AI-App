import { z } from "zod";
import { checkActiveUser } from "@/lib/auth/require-user";
import { isCanvaEnabled } from "@/lib/canva/config";
import { isServiceEnabled, UNAVAILABLE_MESSAGE } from "@/lib/admin/switch";
import { CanvaError, openDesignInCanva } from "@/lib/canva/service";

const body = z.object({ designId: z.string().min(1).max(60) });

/** Uploads one of the user's designs to their Canva and returns the Canva editor URL. */
export async function POST(request: Request) {
  if (!isCanvaEnabled()) return new Response("Not found", { status: 404 });
  if (!(await isServiceEnabled("canva"))) return Response.json({ error: UNAVAILABLE_MESSAGE, code: "failed" }, { status: 503 });
  const check = await checkActiveUser();
  if (check.status === "signed_out") return Response.json({ error: "Please sign in again.", code: "signed_out" }, { status: 401 });
  if (check.status !== "ok") return Response.json({ error: "This account is not available right now.", code: "locked" }, { status: 403 });

  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Pick a design first.", code: "failed" }, { status: 400 });

  try {
    return Response.json(await openDesignInCanva(check.user.id, parsed.data.designId, check.user.actorId));
  } catch (error) {
    if (!(error instanceof CanvaError)) throw error;
    const status = error.code === "not_connected" || error.code === "reconnect" ? 409 : error.code === "not_found" ? 404 : error.code === "timeout" ? 429 : 502;
    return Response.json({ error: error.message, code: error.code }, { status });
  }
}

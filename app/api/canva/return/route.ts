import { getCloudflareContext } from "@opennextjs/cloudflare";
import { NextResponse } from "next/server";
import { checkActiveUser } from "@/lib/auth/require-user";
import { siteUrl } from "@/lib/auth/site-url";
import { isCanvaEnabled } from "@/lib/canva/config";
import { CanvaError, finishCanvaReturn, startCanvaReturn } from "@/lib/canva/service";

/** How long the browser waits for the export before being told it is still being saved. */
const WAIT_MS = 30 * 1000;

function toDesigns(params: Record<string, string>) {
  const url = new URL("/dashboard/designs", siteUrl());
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return NextResponse.redirect(url);
}

/** Lets the work finish after the response: Cloudflare's waitUntil, or simply continuing in Node (development). */
function runInBackground(work: Promise<unknown>) {
  try {
    getCloudflareContext().ctx.waitUntil(work);
  } catch {
    // Not on Cloudflare: the promise keeps running on its own and never rejects.
  }
}

/**
 * Canva's return navigation lands here with ?correlation_jwt=... when the user clicks "Return to BuPulse".
 * Exports the edited design, saves it as a new design and sends the user back to the designs page.
 * If Canva is slow, the user is sent back after 30 s and the save finishes in the background.
 */
export async function GET(request: Request) {
  if (!isCanvaEnabled()) return new Response("Not found", { status: 404 });
  const jwt = new URL(request.url).searchParams.get("correlation_jwt");
  if (!jwt) return toDesigns({ canva: "error" });

  const check = await checkActiveUser();
  if (check.status === "signed_out") {
    const next = `/api/canva/return?correlation_jwt=${encodeURIComponent(jwt)}`;
    return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(next)}`, siteUrl()));
  }
  if (check.status === "unconfirmed") return NextResponse.redirect(new URL("/login?error=confirm", siteUrl()));
  if (check.status === "locked") return NextResponse.redirect(new URL("/account/deletion", siteUrl()));

  try {
    const job = await startCanvaReturn(check.user.id, jwt);
    const work = finishCanvaReturn(job).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), WAIT_MS)));
    const outcome = await Promise.race([work, late]);
    clearTimeout(timer);
    if (!outcome) {
      runInBackground(work);
      return toDesigns({ canva: "processing" });
    }
    if (!outcome.ok) throw outcome.error;
    return toDesigns({ canva: "saved", design: outcome.value.designId });
  } catch (error) {
    if (!(error instanceof CanvaError)) throw error;
    const code = error.code;
    return toDesigns({
      canva: code === "timeout" ? "timeout" : code === "reconnect" || code === "not_connected" ? "reconnect" : code === "processing" ? "processing" : "error",
    });
  }
}

import { isAdminSession } from "@/lib/admin/auth";
import { prisma } from "@/lib/db";
import { readProofObject } from "@/lib/billing/momo-proofs";
import { PROOF_TYPES } from "@/lib/billing/momo-shared";

// The screenshot of a Mobile Money payment, for the admin console (docs/MOMO.md, "Proof"). Signed-in AAL2 admins only;
// anyone else gets a 404 like the rest of the console. The private bucket is read with the server key, the bytes are
// sniffed again, and they are served with that type only, nosniff, inline, never cached and sandboxed, so nothing in
// the file can run as a page on the console's origin.
export async function GET(request: Request) {
  if (!(await isAdminSession())) return new Response("Not found", { status: 404 });
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!id || id.length > 64) return new Response("Not found", { status: 404 });
  const payment = await prisma.manualPayment.findUnique({ where: { id }, select: { proofPath: true, proofBytes: true, reference: true } });
  if (!payment?.proofPath || payment.proofBytes == null) return new Response("Not found", { status: 404 });
  const proof = await readProofObject(payment.proofPath);
  if (!proof) return new Response("Not found", { status: 404 });
  return new Response(proof.bytes as BodyInit, {
    headers: {
      "Content-Type": proof.type,
      "Content-Disposition": `inline; filename="${payment.reference.replace(/[^A-Za-z0-9-]/g, "")}.${PROOF_TYPES[proof.type]}"`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}

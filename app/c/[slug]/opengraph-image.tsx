import { ImageResponse } from "next/og";
import { loadPublicCampaign } from "@/lib/creators/apply";
import { creatorPayInWords } from "@/lib/creators/describe";

export const alt = "A creator campaign on BuPulse";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// A campaign's picture when its link is shared: the campaign, the company and the pay. Drafts get the plain picture.
export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const c = await loadPublicCampaign(slug.toLowerCase()).catch(() => null);
  const shown = c && c.status !== "DRAFT" ? c : null;
  const pay = shown ? creatorPayInWords(shown.payRules, shown.goals, shown.currency)[0] : null;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", padding: "0 90px", color: "white", background: "linear-gradient(135deg, #2f6bff 0%, #7b5cff 100%)" }}>
        <div style={{ display: "flex", fontSize: 36, fontWeight: 700, opacity: 0.95 }}>{shown ? clip(`Creator campaign by ${shown.company.name}`, 60) : "BuPulse for creators"}</div>
        <div style={{ display: "flex", fontSize: 84, fontWeight: 800, letterSpacing: -3, lineHeight: 1.05, marginTop: 24 }}>{shown ? clip(shown.name, 60) : "Get paid for your posts."}</div>
        {pay && <div style={{ display: "flex", fontSize: 38, marginTop: 32, opacity: 0.92 }}>{clip(pay, 90)}</div>}
        <div style={{ display: "flex", fontSize: 28, marginTop: 40, opacity: 0.8 }}>bupulse.com/creators</div>
      </div>
    ),
    size,
  );
}

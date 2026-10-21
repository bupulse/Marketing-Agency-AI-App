import { ImageResponse } from "next/og";

export const alt = "BuPulse for creators: get paid for your posts";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// The marketplace's picture when /creators is shared (WhatsApp, Facebook, X).
export default function Image() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", padding: "0 90px", color: "white", background: "linear-gradient(135deg, #2f6bff 0%, #7b5cff 100%)" }}>
        <div style={{ display: "flex", fontSize: 40, fontWeight: 700, letterSpacing: -1, opacity: 0.95 }}>BuPulse for creators</div>
        <div style={{ display: "flex", fontSize: 92, fontWeight: 800, letterSpacing: -3, lineHeight: 1.05, marginTop: 28 }}>Get paid for your posts.</div>
        <div style={{ display: "flex", fontSize: 34, marginTop: 32, opacity: 0.9 }}>Campaigns from companies in Rwanda. Paid by Mobile Money for your views.</div>
      </div>
    ),
    size,
  );
}

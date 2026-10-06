import { ImageResponse } from "next/og";

export const alt = "BuPulse: the marketing team for every small business";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "0 90px",
          color: "white",
          background: "linear-gradient(135deg, #2f6bff 0%, #7b5cff 100%)",
        }}
      >
        <div style={{ display: "flex", fontSize: 40, fontWeight: 700, letterSpacing: -1, opacity: 0.95 }}>BuPulse</div>
        <div style={{ display: "flex", fontSize: 84, fontWeight: 800, letterSpacing: -3, lineHeight: 1.05, marginTop: 28 }}>
          The marketing team for every small business.
        </div>
        <div style={{ display: "flex", fontSize: 32, marginTop: 32, opacity: 0.9 }}>Posts, designs and leads, in your brand voice.</div>
      </div>
    ),
    size,
  );
}

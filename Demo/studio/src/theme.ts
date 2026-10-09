import { loadFont } from "@remotion/google-fonts/Geist";

export const { fontFamily } = loadFont("normal", { weights: ["400", "500", "600", "700"], subsets: ["latin"] });

// BuPulse tokens (app/globals.css, light theme).
export const C = {
  bg: "#F5F5F7",
  text: "#1D1D1F",
  muted: "#5E5E63",
  line: "rgba(210,210,215,0.75)",
  glass: "rgba(255,255,255,0.58)",
  glassStrong: "rgba(255,255,255,0.84)",
  blue: "#2F6BFF",
  violet: "#7B5CFF",
  success: "#0F7A4A",
  successBg: "rgba(15,122,74,0.12)",
  gradient: "linear-gradient(135deg, #2F6BFF 0%, #7B5CFF 100%)",
};

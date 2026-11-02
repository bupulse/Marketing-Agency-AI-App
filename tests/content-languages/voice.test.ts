import { describe, expect, it } from "vitest";
import { languageVoice, needsApprovedVoice, noVoiceNote, readApprovedVoice } from "@/lib/content-languages/voice";

describe("which voice speaks a video's language", () => {
  it("Kinyarwanda and Swahili wait for the owner's approved voice; until then no voice-over", () => {
    expect(languageVoice("Kinyarwanda", {})).toEqual({ speak: "none", note: noVoiceNote("Kinyarwanda") });
    expect(languageVoice("Swahili", { Kinyarwanda: "RwandaVoice123" })).toEqual({ speak: "none", note: noVoiceNote("Swahili") });
    expect(languageVoice("Kinyarwanda", { Kinyarwanda: "RwandaVoice123" })).toEqual({ speak: "approved", voiceId: "RwandaVoice123" });
    expect(noVoiceNote("Kinyarwanda")).toBe("BuPulse has no Kinyarwanda voice yet, so Kinyarwanda videos have music with Kinyarwanda subtitles and caption, and no voice-over.");
  });

  it("other languages, or none, use the company's voice", () => {
    expect(languageVoice("English", {})).toEqual({ speak: "own" });
    expect(languageVoice("French", {})).toEqual({ speak: "own" });
    expect(languageVoice(null, {})).toEqual({ speak: "own" });
    expect(needsApprovedVoice("English")).toBe(false);
  });

  it("read the AdminSetting value", () => {
    expect(readApprovedVoice({ approvedVoiceId: "RwandaVoice123" })).toBe("RwandaVoice123");
    expect(readApprovedVoice({ approvedVoiceId: null })).toBeNull();
    expect(readApprovedVoice({ approvedVoiceId: "bad id!" })).toBeNull();
    expect(readApprovedVoice(null)).toBeNull();
  });
});

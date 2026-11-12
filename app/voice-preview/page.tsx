import { notFound } from "next/navigation";
import { voicePreviewUrl } from "@/lib/ai/tts";
import { previewAllowed } from "@/lib/support/preview";
import { GEMINI_VOICES, VOICES } from "@/lib/voice/voices";

export const metadata = { title: "Voice candidates", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * Development only: the voice candidates for English voice-overs (docs/VOICE_AND_MUSIC.md, "Voice providers") so the
 * owner can listen and pick. ElevenLabs voices play their own free preview (no characters used); Gemini's prebuilt
 * voices are heard in Google AI Studio until scripts/voice/make-samples.mjs has made the same-script samples.
 * Not found in production.
 */
export default async function VoicePreview() {
  if (!previewAllowed()) notFound();
  const eleven = await Promise.all(VOICES.map(async (v) => ({ ...v, preview: await voicePreviewUrl(v.id) })));
  return (
    <main className="min-h-dvh bg-bg p-4 sm:p-8">
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <h1 className="text-2xl font-bold tracking-[-0.02em]">Voice candidates</h1>
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">ElevenLabs (Multilingual v2)</h2>
          <ul className="flex flex-col gap-3">
            {eleven.map((v) => (
              <li key={v.id} className="flex flex-col gap-2 rounded-2xl border border-line bg-glass p-4">
                <span className="font-semibold">
                  {v.name} <span className="font-normal text-muted">· {v.gender} · {v.description}</span>
                </span>
                {v.preview ? <audio controls preload="none" src={v.preview} className="w-full" /> : <span className="text-[13px] text-muted">No preview (ElevenLabs key missing or the voice is not in this account).</span>}
              </li>
            ))}
          </ul>
        </section>
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Gemini text-to-speech (gemini-3.8-flash-tts)</h2>
          <p className="text-[14px] text-muted">
            Listen in Google AI Studio (Generate speech, choose the voice), or run scripts/voice/make-samples.mjs once the Gemini key has credit.
          </p>
          <ul className="grid gap-2 sm:grid-cols-2">
            {GEMINI_VOICES.map((v) => (
              <li key={v.id} className="rounded-2xl border border-line bg-glass p-3 text-[14px]">
                <span className="font-semibold">{v.name}</span> <span className="text-muted">· {v.gender} · {v.description}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}

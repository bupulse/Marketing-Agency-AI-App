// Growing the music library with generated tracks (owner, 11 November 2026; docs/VOICE_AND_MUSIC.md, "Growing the
// library"): about 30 original instrumentals across the moods BuPulse's reels need, composed by ElevenLabs Music through
// the same generateTrack as Admin -> Music -> "Generate a track" (ledger, 20 a day, library size, audit). The admin runs
// it a few tracks at a time ("Generate a batch"); a track whose title is already in the library is skipped, so running
// it again continues where it stopped. Nothing here runs by itself.
import "server-only";
import { prisma } from "@/lib/db";
import { AdminError, type AdminContext } from "@/lib/admin/types";
import type { Mood } from "./tracks";
import { generateTrack } from "./service";

/** The owner's moods, mapped to the library's (celebration → energetic, chill → acoustic). */
export type BatchMood = "afrobeat" | "calm" | "inspiring" | "corporate" | "celebration" | "chill";
const LIBRARY_MOOD: Record<BatchMood, Mood> = { afrobeat: "afro", calm: "calm", inspiring: "inspiring", corporate: "corporate", celebration: "energetic", chill: "acoustic" };

const T = (mood: BatchMood, title: string, prompt: string) => ({ mood: LIBRARY_MOOD[mood], group: mood, title, prompt });

/** 30 tracks, 5 per mood. Prompts describe instruments and feel only (no artist names: ElevenLabs refuses them). */
export const MUSIC_BATCH = [
  T("afrobeat", "Kigali Sunrise Groove", "Upbeat Afrobeat groove with talking drum, shakers, bright guitar riffs and a warm bassline, 110 BPM."),
  T("afrobeat", "Market Day Bounce", "Feel-good Afrobeat with log drum, snappy percussion and a catchy marimba hook, 112 BPM."),
  T("afrobeat", "Amapiano Evening", "Smooth amapiano-style groove with deep log drum, soft piano chords and light shakers, 113 BPM."),
  T("afrobeat", "Highland Highlife", "Joyful highlife-inspired Afro-pop with clean guitar picking, congas and a brass stab hook, 118 BPM."),
  T("afrobeat", "Moto Ride", "Energetic Afro-fusion beat with punchy kick, rolling percussion and a playful synth lead, 115 BPM."),
  T("calm", "Lake Kivu Morning", "Calm ambient instrumental with soft piano, gentle pads and light field-guitar, slow and peaceful."),
  T("calm", "Quiet Workshop", "Calm lo-fi instrumental with mellow electric piano, soft brushed drums and warm vinyl texture, 80 BPM."),
  T("calm", "Soft Focus", "Minimal calm instrumental with felt piano and airy strings, unhurried, for a gentle product story."),
  T("calm", "Tea Garden", "Peaceful acoustic instrumental with fingerpicked guitar and soft kalimba, relaxed and warm."),
  T("calm", "Evening Light", "Calm downtempo with warm Rhodes chords, soft sub bass and slow light percussion, 75 BPM."),
  T("inspiring", "Rise Together", "Inspiring cinematic build with piano ostinato, swelling strings and steady drums that lift at the end."),
  T("inspiring", "First Customer", "Uplifting indie-pop instrumental with bright guitars, claps and a hopeful melody, 120 BPM."),
  T("inspiring", "Big Dreams", "Motivational instrumental with pulsing synths, piano and a big drum lift, positive and modern."),
  T("inspiring", "New Chapter", "Inspiring acoustic-pop with strummed guitar, glockenspiel and a warm build, 105 BPM."),
  T("inspiring", "Open Road", "Hopeful instrumental with soft piano, light electronic beat and rising strings, 100 BPM."),
  T("corporate", "Clean Start", "Modern corporate instrumental with light electric guitar, soft synth plucks and a steady beat, 110 BPM."),
  T("corporate", "Smart Solutions", "Positive tech-corporate track with crisp percussion, marimba and airy pads, confident, 115 BPM."),
  T("corporate", "Trusted Partner", "Warm corporate instrumental with piano, light strings and a calm steady groove, 95 BPM."),
  T("corporate", "Forward Motion", "Upbeat corporate pop with bright synths, claps and a clean guitar riff, 118 BPM."),
  T("corporate", "Simple Steps", "Friendly explainer-style instrumental with ukulele, light percussion and whistle-like synth, 108 BPM."),
  T("celebration", "Grand Opening", "Festive celebration instrumental with brass hits, energetic drums and a joyful melody, 124 BPM."),
  T("celebration", "Weekend Party", "Party dance-pop instrumental with four-on-the-floor kick, bright synths and claps, 122 BPM."),
  T("celebration", "Big Sale Day", "High-energy celebration track with Afro-house groove, horns and an exciting build, 120 BPM."),
  T("celebration", "Cheers", "Happy celebratory instrumental with handclaps, bouncy bass, piano stabs and a sing-along hook feel, 118 BPM."),
  T("celebration", "Festival Lights", "Upbeat festival instrumental with marching drums, brass and sparkling synths, 126 BPM."),
  T("chill", "Sunday Brunch", "Chill acoustic instrumental with nylon guitar, soft bongos and a relaxed bass, 90 BPM."),
  T("chill", "Coffee Break", "Chill lo-fi hip-hop instrumental with jazzy keys, dusty drums and soft bass, 85 BPM."),
  T("chill", "Rooftop Breeze", "Laid-back chill-house instrumental with soft synth chords and gentle groove, 100 BPM."),
  T("chill", "Easy Afternoon", "Chill acoustic-pop with ukulele, light shaker and warm bass, easygoing, 95 BPM."),
  T("chill", "Golden Hour", "Chillwave-style instrumental with dreamy synths, soft beat and warm bass, 92 BPM."),
] as const;

/**
 * The price (checked 11 November 2026 on elevenlabs.io/pricing/api): ElevenLabs Music is $0.15 a minute of music on
 * the API (900 credits a minute when taken from a subscription's credits). A 30-second track: $0.075; 30 of them $2.25.
 */
export const MUSIC_USD_PER_MINUTE = 0.15;
export function batchCostUsd(tracks: number, seconds: number): number {
  return Math.round(tracks * (seconds / 60) * MUSIC_USD_PER_MINUTE * 1000) / 1000;
}

/** Tracks per click: each takes 10 to 40 seconds to compose, so a click finishes within a few minutes. */
export const BATCH_MAX = 5;

/**
 * Generates the next `count` tracks of MUSIC_BATCH not yet in the library (by title), one after the other through
 * generateTrack. Stops at the first refusal (20 a day, library full, service down) and says how many were made.
 */
export async function generateMusicBatch(ctx: AdminContext, input: { count: number; seconds: number; confirmUsd: number }): Promise<{ made: number; left: number; stopped: string | null }> {
  const count = Math.min(BATCH_MAX, Math.max(1, Math.floor(input.count)));
  const seconds = Math.min(60, Math.max(10, Math.floor(input.seconds)));
  // The admin confirmed this cost on the form; a different figure means the form was stale or edited.
  if (Math.abs(input.confirmUsd - batchCostUsd(count, seconds)) > 0.0005) throw new AdminError("invalid", "Confirm the cost shown on the form.");
  const have = new Set((await prisma.musicTrack.findMany({ select: { title: true } })).map((t) => t.title));
  const todo = MUSIC_BATCH.filter((t) => !have.has(t.title));
  let made = 0;
  let stopped: string | null = null;
  for (const t of todo.slice(0, count)) {
    try {
      await generateTrack(ctx, { title: t.title, prompt: t.prompt, mood: t.mood, seconds });
      made += 1;
    } catch (error) {
      stopped = error instanceof AdminError ? error.message : "The music service did not answer. Try again later.";
      break;
    }
  }
  return { made, left: todo.length - made, stopped };
}

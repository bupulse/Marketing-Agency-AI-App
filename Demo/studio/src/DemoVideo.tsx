import { linearTiming, TransitionSeries } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { AbsoluteFill, Audio, interpolate, Sequence, staticFile, useVideoConfig } from "remotion";
import manifest from "./audio-manifest.json";
import { Backdrop } from "./components/Backdrop";
import { SceneContext } from "./scene-context";
import { CHAPTERS, FULL_ID, VIDEOS, type Scene } from "./script";
import { cuesFor, Subtitles, type Cue } from "./ui/Subtitles";
import { Visual } from "./visuals";

export type Variant = "social" | "demo";
export type DemoProps = { videoId: string; variant: Variant };

const FPS = 30;
const LEAD = 0.35; // seconds of picture before the voice starts
const FADE = 12; // frames of cross-fade between scenes

type Audio = { file: string; duration: number; lines: { start: number; end: number }[] };
const audioOf = (videoId: string, sceneId: string) => (manifest as Record<string, Record<string, Audio>>)[videoId][sceneId];

/** The scenes of a video. The full walkthrough chains every video, with a chapter title before each part and one end card. */
function scenesOf(videoId: string, variant: Variant): { src: string; scene: Scene }[] {
  const keep = (s: Scene) => variant === "demo" || !s.demoOnly;
  if (videoId !== FULL_ID) return VIDEOS.find((v) => v.id === videoId)!.scenes.filter(keep).map((scene) => ({ src: videoId, scene }));
  return VIDEOS.flatMap((v, vi) => [
    ...(CHAPTERS[v.id] ? [{ src: "chapters", scene: CHAPTERS[v.id] }] : []),
    ...v.scenes.filter(keep).filter((s) => s.id !== "end" || vi === VIDEOS.length - 1).map((scene) => ({ src: v.id, scene })),
  ]);
}

export function plan(videoId: string, variant: Variant) {
  let t = 0;
  const items = scenesOf(videoId, variant).map(({ src, scene }) => {
    const a = audioOf(src, scene.id);
    const hold = scene.hold ?? (variant === "demo" ? 1.8 : 0.6);
    const durationInFrames = Math.round((LEAD + a.duration + hold) * FPS) + FADE;
    const item = { scene, key: `${src}-${scene.id}`, audio: a, from: t, durationInFrames, voiceFrom: Math.round(LEAD * FPS) };
    t += durationInFrames - FADE;
    return item;
  });
  return { items, total: t + FADE };
}

export const DemoVideo: React.FC<DemoProps> = ({ videoId, variant }) => {
  const { width, height, durationInFrames } = useVideoConfig();
  const vertical = height > width;
  const { items } = plan(videoId, variant);
  const cues: Cue[] = items.flatMap(({ scene, audio, from, voiceFrom }) =>
    scene.lines.flatMap(([, rw], i) => {
      const l = audio.lines[i] ?? { start: 0, end: audio.duration };
      return cuesFor(rw, from + voiceFrom + l.start * FPS, from + voiceFrom + l.end * FPS, vertical ? 58 : 90);
    }),
  );
  return (
    <AbsoluteFill>
      <Backdrop />
      <TransitionSeries>
        {items.flatMap(({ scene, key, audio, durationInFrames: d, voiceFrom }, i) => {
          const info = {
            arg: scene.visual.split(":")[1] ?? "",
            durationInFrames: d,
            voiceEnd: voiceFrom + Math.round(audio.duration * FPS),
            lines: scene.lines.map((_, li) => {
              const l = audio.lines[li] ?? { start: 0, end: audio.duration };
              return { start: voiceFrom + Math.round(l.start * FPS), end: voiceFrom + Math.round(l.end * FPS) };
            }),
            variant,
          };
          const seq = (
            <TransitionSeries.Sequence key={key} durationInFrames={d}>
              <SceneContext.Provider value={info}>
                <Visual name={scene.visual.split(":")[0]} />
              </SceneContext.Provider>
              <Sequence from={voiceFrom} layout="none">
                <Audio src={staticFile(audio.file)} />
              </Sequence>
            </TransitionSeries.Sequence>
          );
          return i === 0 ? [seq] : [<TransitionSeries.Transition key={`t-${key}`} presentation={fade()} timing={linearTiming({ durationInFrames: FADE })} />, seq];
        })}
      </TransitionSeries>
      <Audio
        src={staticFile("audio/music/bed.mp3")}
        volume={(f) => interpolate(f, [0, 30, durationInFrames - 60, durationInFrames], [0, 0.09, 0.09, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })}
        loop
      />
      <Subtitles cues={cues} />
    </AbsoluteFill>
  );
};

export type SceneProps = { videoId: string; sceneId: string; variant: Variant };

/** One scene alone, for checking a visual: npx remotion still src/index.ts Scene-16x9 out/x.png --props='{"videoId":"02-starter","sceneId":"momo","variant":"demo"}' --frame=60 */
export const SceneOnly: React.FC<SceneProps> = ({ videoId, sceneId, variant }) => {
  const { items } = plan(videoId, "demo");
  const it = items.find((i) => i.scene.id === sceneId)!;
  const info = {
    arg: it.scene.visual.split(":")[1] ?? "",
    durationInFrames: it.durationInFrames,
    voiceEnd: it.voiceFrom + Math.round(it.audio.duration * FPS),
    lines: it.scene.lines.map((_, li) => {
      const l = it.audio.lines[li] ?? { start: 0, end: it.audio.duration };
      return { start: it.voiceFrom + Math.round(l.start * FPS), end: it.voiceFrom + Math.round(l.end * FPS) };
    }),
    variant,
  };
  return (
    <AbsoluteFill>
      <Backdrop />
      <SceneContext.Provider value={info}>
        <Visual name={it.scene.visual.split(":")[0]} />
      </SceneContext.Provider>
    </AbsoluteFill>
  );
};

export const sceneLength = ({ props }: { props: SceneProps }) => {
  const it = plan(props.videoId, "demo").items.find((i) => i.scene.id === props.sceneId);
  return { durationInFrames: it?.durationInFrames ?? 300 };
};

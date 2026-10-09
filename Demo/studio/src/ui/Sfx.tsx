import { Audio, Sequence, staticFile } from "remotion";

export type SfxName = "click" | "ping" | "chime" | "whoosh" | "typing" | "buzz";

/** A sound effect at `at` frames into the current sequence. */
export const Sfx: React.FC<{ name: SfxName; at: number; volume?: number }> = ({ name, at, volume = 0.45 }) => (
  <Sequence from={Math.max(0, Math.round(at))} layout="none">
    <Audio src={staticFile(`audio/sfx/${name}.mp3`)} volume={volume} />
  </Sequence>
);

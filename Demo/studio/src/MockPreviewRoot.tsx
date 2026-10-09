// Preview of the drawn app screens (src/visuals/appmock.tsx). Entry: src/mock-preview-entry.ts
import { AbsoluteFill, Composition } from "remotion";
import { Backdrop } from "./components/Backdrop";
import { plan } from "./DemoVideo";
import { SceneContext } from "./scene-context";
import { APP_MOCKS } from "./visuals/appmock";

type P = { mockKey: string; videoId: string; sceneId: string };

const MockScene: React.FC<P> = ({ mockKey, videoId, sceneId }) => {
  const it = plan(videoId, "demo").items.find((i) => i.scene.id === sceneId)!;
  const info = {
    arg: mockKey,
    durationInFrames: it.durationInFrames,
    voiceEnd: it.voiceFrom + Math.round(it.audio.duration * 30),
    lines: it.scene.lines.map((_, li) => {
      const l = it.audio.lines[li] ?? { start: 0, end: it.audio.duration };
      return { start: it.voiceFrom + Math.round(l.start * 30), end: it.voiceFrom + Math.round(l.end * 30) };
    }),
    variant: "demo" as const,
  };
  const M = APP_MOCKS[mockKey];
  return (
    <AbsoluteFill>
      <Backdrop />
      <SceneContext.Provider value={info}><M /></SceneContext.Provider>
    </AbsoluteFill>
  );
};

export const MockPreviewRoot: React.FC = () => (
  <>
    {[["16x9", 1920, 1080], ["9x16", 1080, 1920]].map(([id, w, h]) => (
      <Composition key={id as string} id={`Mock-${id}`} component={MockScene} durationInFrames={600} fps={30} width={w as number} height={h as number} defaultProps={{ mockKey: "inzu/content", videoId: "02-starter", sceneId: "generate" }} />
    ))}
  </>
);

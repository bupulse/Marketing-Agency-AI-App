import { Composition } from "remotion";
import { DemoVideo, plan, SceneOnly, sceneLength, type DemoProps, type SceneProps, type Variant } from "./DemoVideo";
import { FULL_ID, VIDEOS } from "./script";

const FORMATS = [
  { id: "16x9", width: 1920, height: 1080 },
  { id: "9x16", width: 1080, height: 1920 },
];
const VARIANTS: Variant[] = ["social", "demo"];

export const Root: React.FC = () => (
  <>
    {[...VIDEOS, { id: FULL_ID }].flatMap((v) =>
      VARIANTS.flatMap((variant) =>
        FORMATS.map((fmt) => (
          <Composition
            key={`${v.id}-${variant}-${fmt.id}`}
            id={`${v.id}-${variant}-${fmt.id}`}
            component={DemoVideo}
            durationInFrames={plan(v.id, variant).total}
            fps={30}
            width={fmt.width}
            height={fmt.height}
            defaultProps={{ videoId: v.id, variant }}
          />
        )),
      ),
    )}
    {FORMATS.map((fmt) => (
      <Composition
        key={`scene-${fmt.id}`}
        id={`Scene-${fmt.id}`}
        component={SceneOnly}
        durationInFrames={300}
        calculateMetadata={sceneLength}
        fps={30}
        width={fmt.width}
        height={fmt.height}
        defaultProps={{ videoId: "02-starter", sceneId: "momo", variant: "demo" }}
      />
    ))}
  </>
);

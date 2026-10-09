import { Composition } from "remotion";
import { EndCard } from "./scenes/EndCard";

export const Root: React.FC = () => (
  <>
    <Composition id="EndCard-16x9" component={EndCard} durationInFrames={150} fps={30} width={1920} height={1080} />
    <Composition id="EndCard-9x16" component={EndCard} durationInFrames={150} fps={30} width={1080} height={1920} />
  </>
);

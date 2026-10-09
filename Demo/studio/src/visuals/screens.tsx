import React from "react";
import { Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import dims from "../screen-dims.json";
import { useScene } from "../scene-context";
import { APP_MOCKS } from "./appmock";
import { ease } from "../ui/motion";
import { BrowserFrame, Callout, Cursor } from "../ui/primitives";
import { Grad, SceneLayout } from "../ui/SceneLayout";
import { Sfx } from "../ui/Sfx";

/** A camera keyframe: at fraction `p` of the voice, centre (x, y) of the screenshot (0..1) at zoom z. */
type Cam = { p: number; x: number; y: number; z: number };
/** A shot: one screenshot (or several in a row) with camera moves, labels and clicks. */
export type Shot = {
  eyebrow: string;
  title: React.ReactNode;
  text?: string;
  url: string;
  /** Screenshots shown one after another; `from` is the fraction of the voice where each starts. */
  frames: { file: string; from: number; cam: Cam[]; scroll?: [number, number] }[];
  callouts?: { p: number; to?: number; text: string; x: number; y: number }[];
  /** Clicks in canvas coordinates at fraction p. */
  clicks?: { p: number; x: number; y: number }[];
};

const W = 1100, H = 708; // browser content area on the canvas

const ScreenImage: React.FC<{ file: string; cam: Cam[]; scroll?: [number, number]; voiceEnd: number; start: number }> = ({ file, cam, scroll, voiceEnd, start }) => {
  const f = useCurrentFrame();
  const [iw, ih] = (dims as unknown as Record<string, [number, number]>)[file] ?? [2880, 1800];
  const imgH = (W * ih) / iw;
  const ps = cam.map((c) => Math.round(c.p * voiceEnd));
  const val = (k: "x" | "y" | "z") => (cam.length === 1 ? cam[0][k] : interpolate(f, ps, cam.map((c) => c[k]), { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease }));
  const z = val("z"), cx = val("x"), cy = val("y");
  // Scroll (full-page captures): top of the visible window as a fraction of the scrollable height.
  const sc = scroll ? interpolate(f, [Math.max(start, scroll[0] * voiceEnd), scroll[1] * voiceEnd], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease }) : null;
  const ty = sc !== null ? -sc * Math.max(0, imgH * z - H) : 0;
  const tx = W / 2 - cx * W * z;
  const tyz = sc !== null ? ty : H / 2 - cy * imgH * z;
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", background: "#F5F5F7" }}>
      <Img src={staticFile(`screens/${file}.png`)} style={{ position: "absolute", width: W * z, height: imgH * z, left: tx, top: tyz }} />
    </div>
  );
};

export const ShotScene: React.FC<{ shot: Shot }> = ({ shot }) => {
  const f = useCurrentFrame();
  const s = useScene();
  const ve = Math.max(30, s.voiceEnd);
  const idx = shot.frames.reduce((k, fr, i) => (f >= fr.from * ve ? i : k), 0);
  const fr = shot.frames[idx];
  const clicks = shot.clicks ?? [];
  const path: [number, number, number, boolean?][] = clicks.length ? [[0, clicks[0].x + 160, clicks[0].y + 200], ...clicks.flatMap((c) => [[Math.round(c.p * ve) - 14, c.x, c.y] as [number, number, number], [Math.round(c.p * ve), c.x, c.y, true] as [number, number, number, boolean]])] : [];
  return (
    <SceneLayout eyebrow={shot.eyebrow} title={shot.title} text={shot.text}>
      <BrowserFrame url={shot.url} width={1100} height={760}>
        <ScreenImage key={fr.file + idx} file={fr.file} cam={fr.cam} scroll={fr.scroll} voiceEnd={ve} start={fr.from * ve} />
      </BrowserFrame>
      {clicks.map((c, i) => <Sfx key={i} name="click" at={c.p * ve} volume={0.3} />)}
      {path.length > 0 && <Cursor path={path} />}
      {(shot.callouts ?? []).map((c, i) => <Callout key={i} at={Math.round(c.p * ve)} until={c.to === undefined ? undefined : Math.round(c.to * ve)} x={c.x} y={c.y}>{c.text}</Callout>)}
    </SceneLayout>
  );
};


const whole: Cam[] = [{ p: 0, x: 0.5, y: 0.5, z: 1 }];
const push = (x: number, y: number, z = 1.35, from = 0.15, to = 0.85): Cam[] => [{ p: from, x: 0.5, y: 0.5, z: 1 }, { p: to, x, y, z }];

/** Screenshot scenes by key ("inzu/content"). Filled in from Demo/capture/MANIFEST.md. */
export const SHOTS: Record<string, Shot> = {
  "marketing/landing": {
    eyebrow: "bupulse.com", title: <>Your marketing team, <Grad>online.</Grad></>, text: "Captions, designs, a calendar and new customers.", url: "bupulse.com",
    frames: [{ file: "marketing/home", from: 0, cam: [{ p: 0, x: 0.5, y: 0.5, z: 1 }, { p: 0.35, x: 0.5, y: 0.5, z: 1 }, { p: 0.95, x: 0.3, y: 0.42, z: 1.25 }] }],
    callouts: [{ p: 0.45, text: "Writes · designs · plans · brings customers", x: 40, y: 640 }],
  },
  "marketing/features": {
    eyebrow: "Everything in one place", title: <>All your marketing, <Grad>one app.</Grad></>, url: "bupulse.com",
    frames: [{ file: "marketing/home-full", from: 0, cam: whole, scroll: [0.05, 1] }],
  },
  "marketing/signup": {
    eyebrow: "Step 1 · Sign up", title: <>Sign up in <Grad>a minute.</Grad></>, text: "Email or Google, then your business details.", url: "bupulse.com/signup",
    frames: [{ file: "marketing/signup", from: 0, cam: push(0.76, 0.47, 1.5, 0.05, 0.45) }],
    callouts: [{ p: 0.35, text: "Email or Google", x: 700, y: 120 }],
  },
  "onboarding/steps": {
    eyebrow: "Step 2 · Your brand", title: <>BuPulse learns <Grad>your business.</Grad></>, text: "Four short steps, under five minutes.", url: "bupulse.com/onboarding",
    frames: [
      { file: "onboarding/step-1-offer", from: 0, cam: [{ p: 0, x: 0.5, y: 0.42, z: 1.12 }] },
      { file: "onboarding/step-2-voice", from: 0.28, cam: [{ p: 0, x: 0.5, y: 0.42, z: 1.12 }] },
      { file: "onboarding/step-3-look-extracted", from: 0.55, cam: [{ p: 0.55, x: 0.5, y: 0.42, z: 1.12 }, { p: 0.8, x: 0.42, y: 0.55, z: 1.4 }] },
      { file: "onboarding/step-4-chat", from: 0.86, cam: [{ p: 0, x: 0.5, y: 0.42, z: 1.12 }] },
    ],
    callouts: [{ p: 0.05, to: 0.27, text: "What you sell", x: 40, y: 640 }, { p: 0.3, to: 0.54, text: "How you talk", x: 40, y: 640 }, { p: 0.62, to: 0.85, text: "Colours picked from your logo", x: 40, y: 640 }, { p: 0.88, text: "Facts for your website chat", x: 40, y: 640 }],
  },
  "inzu/project": {
    eyebrow: "New product", title: <>Add what you <Grad>sell.</Grad></>, text: "Name, price, key features and photos.", url: "bupulse.com/dashboard/projects/new",
    frames: [{ file: "inzu/new-project-form-full", from: 0, cam: [{ p: 0, x: 0.57, y: 0.5, z: 1.22 }], scroll: [0.12, 0.95] }],
    callouts: [{ p: 0.1, to: 0.5, text: "Kitenge summer dress · 25,000 RWF", x: 40, y: 70 }, { p: 0.55, text: "Key features and photos", x: 40, y: 70 }],
  },
  "onboarding/dashboard": {
    eyebrow: "Ready", title: <>Your brand, <Grad>everywhere.</Grad></>, text: "Your logo and colours on every screen.", url: "bupulse.com/dashboard",
    frames: [{ file: "onboarding/done-dashboard", from: 0, cam: push(0.55, 0.42, 1.3, 0.05, 0.7) }],
    callouts: [{ p: 0.4, text: "Inzu Fashion's logo and colours", x: 40, y: 640 }],
  },
};

/** Scene visual "Screen:<key>". */
export const Screen: React.FC = () => {
  const { arg } = useScene();
  const shot = SHOTS[arg];
  const Mock = APP_MOCKS[arg];
  if (!shot && Mock) return <Mock />;
  if (!shot) return <SceneLayout eyebrow="Missing screen" title={<Grad>{arg}</Grad>}><div /></SceneLayout>;
  return <ShotScene shot={shot} />;
};

const named = (key: string): React.FC => () => <ShotScene shot={SHOTS[key]} />;
export const Landing = named("marketing/landing");
export const LandingFeatures = named("marketing/features");
export const SignUp = named("marketing/signup");
export const Onboarding = named("onboarding/steps");
export const Dashboard = named("onboarding/dashboard");


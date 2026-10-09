// Drawn versions of the real BuPulse app screens, used when a screenshot is missing.
// Keyed like the script's "Screen:<key>" visuals. Same look as the app: glass sidebar, rounded cards, Geist, Pulse gradient.
import React from "react";
import { Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import manifest from "../audio-manifest.json";
import { BIZ, type Biz } from "../data";
import { at, lineStart, useScene, type SceneInfo } from "../scene-context";
import { C } from "../theme";
import { prog, rise } from "../ui/motion";
import { Avatar, Badge, BrowserFrame, Button, Callout, Cursor } from "../ui/primitives";
import { Grad, SceneLayout } from "../ui/SceneLayout";
import { Sfx } from "../ui/Sfx";

const SIDEBAR = 206;
const TOP = 52; // browser bar height on the canvas
const MAIN_X = SIDEBAR + 24; // left edge of the main column on the canvas

const typeIn = (text: string, f: number, a: number, b: number) => text.slice(0, Math.round(text.length * prog(f, a, Math.max(1, b - a))));
const mock = (name: string) => staticFile(`mock/${name}`);

/** True when the current scene is `sceneId` of `videoId` (scenes that share a visual). */
function isScene(s: SceneInfo, videoId: string, sceneId: string) {
  const a = (manifest as Record<string, Record<string, { duration: number }>>)[videoId]?.[sceneId];
  if (!a) return false;
  return Math.abs(Math.round(0.35 * 30) + Math.round(a.duration * 30) - s.voiceEnd) <= 1;
}

// ---- Icons (simple strokes, lucide-like) ----
const ICON: Record<string, React.ReactNode> = {
  Home: <path d="M3 10.5 12 3l9 7.5V21H3z M9 21v-6h6v6" />,
  Projects: <path d="M3 6h7l2 2h9v12H3z" />,
  Content: <path d="M4 20h4L19 9l-4-4L4 16z M14 6l4 4" />,
  Calendar: <path d="M4 5h16v15H4z M4 10h16 M8 3v4 M16 3v4" />,
  Analytics: <path d="M4 20V4 M4 20h16 M8 16l4-5 3 3 5-7" />,
  Autopilot: <path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z M19 15l1 2 2 1-2 1-1 2-1-2-2-1 2-1z" />,
  Gallery: <path d="M3 5h14v12H3z M7 21h14V9 M3 14l4-4 4 4 3-3 3 3" />,
  Designs: <path d="M4 4h16v16H4z M4 15l5-5 4 4 3-3 4 4 M15 8h.01" />,
  Leads: <path d="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M2 21a7 7 0 0 1 14 0 M17 11a3 3 0 1 0 0-6 M22 21a6 6 0 0 0-4-5.6" />,
  "Website chat": <path d="M4 5h16v11H9l-5 4z" />,
  Channels: <path d="M9 3v6 M15 3v6 M6 9h12v3a6 6 0 0 1-12 0z M12 18v3" />,
  Connectors: <path d="M4 4h7v7H4z M13 13h7v7h-7z M13 4h7v7h-7z M4 13h7v7H4z" />,
  Brand: <path d="M12 3a9 9 0 1 0 0 18c1.5 0 2-1 2-2s-1-2 0-3 3 0 5-1 2-3 2-4a9 9 0 0 0-9-8z M7.5 11h.01 M10 7h.01 M15 7h.01" />,
  Usage: <path d="M6 20V10 M12 20V4 M18 20v-7" />,
  Billing: <path d="M3 6h18v12H3z M3 10h18" />,
  Settings: <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M19 12l2-1-1-3-2 .5-1.5-1.5.5-2-3-1-1 2h-2l-1-2-3 1 .5 2L6 7.5 4 7l-1 3 2 1v2l-2 1 1 3 2-.5 1.5 1.5-.5 2 3 1 1-2h2l1 2 3-1-.5-2 1.5-1.5 2 .5 1-3-2-1z" />,
};
const NAV = ["Home", "Projects", "Content", "Calendar", "Analytics", "Autopilot", "Gallery", "Designs", "Leads", "Website chat", "Channels", "Connectors", "Brand", "Usage", "Billing", "Settings"];

const Icon: React.FC<{ name: string; size?: number; color?: string }> = ({ name, size = 17, color = C.muted }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    {ICON[name] ?? <circle cx="12" cy="12" r="8" />}
  </svg>
);

/** The app window: sidebar with the business, header, and the page. */
const Shell: React.FC<{ biz: Biz; active: string; url: string; title: string; sub?: string; action?: React.ReactNode; children: React.ReactNode }> = ({ biz, active, url, title, sub, action, children }) => (
  <BrowserFrame url={url} width={1100} height={760}>
    <div style={{ position: "absolute", inset: 0, display: "flex", background: "#F5F5F7" }}>
      <div style={{ width: SIDEBAR, flexShrink: 0, padding: "16px 12px", borderRight: `1px solid ${C.line}`, background: "rgba(255,255,255,0.7)", display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 8px 12px" }}>
          <Img src={staticFile("brand/logo.png")} style={{ height: 22 }} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "7px 9px", borderRadius: 12, background: "rgba(47,107,255,0.08)", marginBottom: 8 }}>
          <Img src={mock(`${biz.key}.png`)} style={{ width: 26, height: 26, borderRadius: 13, objectFit: "cover" }} />
          <div style={{ fontSize: 14, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{biz.name}</div>
        </div>
        {NAV.map((n) => {
          const on = n === active;
          return (
            <div key={n} style={{ position: "relative", display: "flex", alignItems: "center", gap: 10, height: 32, padding: "0 10px", borderRadius: 10, fontSize: 14, fontWeight: on ? 600 : 500, color: on ? C.text : "#3A3A3F", background: on ? "rgba(47,107,255,0.10)" : undefined }}>
              {on && <div style={{ position: "absolute", left: -2, top: 7, bottom: 7, width: 3, borderRadius: 2, background: biz.colors[0] }} />}
              <Icon name={n} color={on ? C.blue : "#6E6E73"} />
              {n}
            </div>
          );
        })}
      </div>
      <div style={{ flex: 1, minWidth: 0, padding: "18px 24px", display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: -0.5 }}>{title}</div>
            {sub && <div style={{ fontSize: 14, color: C.muted, marginTop: 2 }}>{sub}</div>}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {action}
            <Avatar name={biz.owner} size={34} color={biz.colors[0]} />
          </div>
        </div>
        <div style={{ position: "relative", flex: 1, minHeight: 0 }}>{children}</div>
      </div>
    </div>
  </BrowserFrame>
);

const Card: React.FC<{ children: React.ReactNode; style?: React.CSSProperties; pad?: number }> = ({ children, style, pad = 16 }) => (
  <div style={{ background: "white", border: `1px solid ${C.line}`, borderRadius: 18, padding: pad, boxShadow: "0 8px 24px rgba(29,29,31,0.05)", ...style }}>{children}</div>
);

const Label: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: 1, textTransform: "uppercase", color: C.muted, ...style }}>{children}</div>
);

const Small: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => <span style={{ fontSize: 13, height: 36, display: "inline-flex", alignItems: "center", padding: "0 16px", borderRadius: 999, background: C.gradient, color: "white", fontWeight: 600, ...style }}>{children}</span>;

const Photo: React.FC<{ name: string; w: number | string; h: number; r?: number; style?: React.CSSProperties }> = ({ name, w, h, r = 12, style }) => (
  <Img src={mock(name)} style={{ width: w, height: h, borderRadius: r, objectFit: "cover", display: "block", ...style }} />
);

const Field: React.FC<{ label: string; value: string; caret?: boolean; h?: number; focus?: boolean }> = ({ label, value, caret, h = 40, focus }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
    <div style={{ fontSize: 13, fontWeight: 500, color: "#3A3A3F" }}>{label}</div>
    <div style={{ minHeight: h, border: `1.5px solid ${focus ? C.blue : C.line}`, boxShadow: focus ? "0 0 0 3px rgba(47,107,255,0.15)" : undefined, borderRadius: 12, padding: "9px 12px", fontSize: 14.5, lineHeight: 1.4, background: "white", whiteSpace: "pre-wrap" }}>
      {value}
      {caret && <span style={{ display: "inline-block", width: 2, height: 16, background: C.blue, marginLeft: 1, verticalAlign: "middle" }} />}
    </div>
  </div>
);

const Meter: React.FC<{ label: string; value: number; max: number; f: number; start: number }> = ({ label, value, max, f, start }) => {
  const p = prog(f, start, 30);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 15 }}>
        <span style={{ fontWeight: 600 }}>{label}</span>
        <span style={{ color: C.muted, fontVariantNumeric: "tabular-nums" }}>{Math.round(value * p)} of {max}</span>
      </div>
      <div style={{ height: 10, borderRadius: 5, background: "rgba(47,107,255,0.10)", overflow: "hidden" }}>
        <div style={{ width: `${(value / max) * 100 * p}%`, height: "100%", borderRadius: 5, background: C.gradient }} />
      </div>
    </div>
  );
};

// ======================= Inzu Fashion (Starter) =======================
const INZU = BIZ.inzu;

const CAPTION_EN = "New in at Inzu Fashion ✨ Our Kitenge summer dress is here: light, bright and made for Kigali sunshine 🌞 Sizes S–XL, 25,000 RWF. Visit our Kimironko shop or send us a DM to reserve yours! 💛";
const CAPTION_RW = "Igishya kuri Inzu Fashion ✨ Ikanzu yacu ya Kitenge y'impeshyi yageze: yoroshye, ifite amabara meza, ikwiriye izuba rya Kigali 🌞 Ingano S–XL, 25,000 RWF. Ngwino ku iduka ryacu i Kimironko cyangwa utwandikire uyitumize! 💛";
const TAGS = "#KigaliFashion #Kitenge #InzuFashion #MadeInRwanda #Kimironko";

const InzuProject: React.FC = () => {
  const f = useCurrentFrame();
  const s = useScene();
  const e = s.voiceEnd;
  const t1 = at(s, 0.05), t2 = at(s, 0.3), t3 = at(s, 0.45), t4 = at(s, 0.62), tGen = Math.max(at(s, 0.92), t4 + 30);
  const name = typeIn("Kitenge summer dress", f, t1, t1 + 22);
  const price = typeIn("25,000 RWF", f, t2, t2 + 12);
  const feats = typeIn("Bright kitenge print · light cotton · sizes S–XL · made in Kigali", f, t3, t4);
  const photos = ["inzu-dress-1.jpg", "inzu-dress-2.jpg", "inzu-dress-3.jpg"];
  const pressed = f >= tGen && f < tGen + 8;
  return (
    <SceneLayout eyebrow="Step 3 · Add a product" title={<>Add it <Grad>once.</Grad></>} text="Name, price, features and photos.">
      <Shell biz={INZU} active="Projects" url="bupulse.com/dashboard/projects/new" title="New project" sub="Anything you want to promote: a product, a service, an offer.">
        <Card pad={20} style={{ display: "flex", gap: 22, height: 560 }}>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 14 }}>
            <Field label="Name" value={name} caret={f >= t1 && f < t2} focus={f >= t1 && f < t2} />
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: "#3A3A3F" }}>Type</div>
              <div style={{ display: "flex", gap: 8 }}>
                {["Product", "Service", "Offer", "Event"].map((t, i) => (
                  <span key={t} style={{ fontSize: 14, padding: "8px 14px", borderRadius: 999, fontWeight: 600, border: `1.5px solid ${i === 0 ? C.blue : C.line}`, color: i === 0 ? C.blue : C.text, background: i === 0 ? "rgba(47,107,255,0.08)" : "white" }}>{t}</span>
                ))}
              </div>
            </div>
            <Field label="Price" value={price} caret={f >= t2 && f < t3} focus={f >= t2 && f < t3} />
            <Field label="Key features" value={feats} caret={f >= t3 && f < t4} focus={f >= t3 && f < t4} h={70} />
            <div style={{ marginTop: "auto", display: "flex", justifyContent: "flex-end" }}>
              <Button style={{ height: 46, fontSize: 17, transform: pressed ? "scale(0.95)" : undefined }}>✨ Generate content</Button>
            </div>
          </div>
          <div style={{ width: 300, display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: "#3A3A3F" }}>Photos</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              {photos.map((p, i) => {
                const a = t4 - 30 + i * 8;
                const q = prog(f, a, 12);
                return <div key={p} style={{ opacity: q, transform: `translateY(${(1 - q) * -40}px) scale(${0.9 + 0.1 * q})` }}><Photo name={p} w="100%" h={i === 0 ? 180 : 130} /></div>;
              })}
              <div style={{ height: 130, borderRadius: 12, border: `2px dashed ${C.line}`, display: "flex", alignItems: "center", justifyContent: "center", color: C.muted, fontSize: 14 }}>+ Add photo</div>
            </div>
            {f > t4 && <div style={{ ...rise(f, t4), fontSize: 13, color: C.success, fontWeight: 600 }}>3 photos added</div>}
          </div>
        </Card>
      </Shell>
      <Sfx name="typing" at={t1} volume={0.25} />
      <Sfx name="typing" at={t3} volume={0.25} />
      <Sfx name="click" at={tGen} volume={0.35} />
      <Cursor path={[[0, 600, 700], [t1 - 6, 420, 210, true], [t4 - 34, 820, 300], [tGen - 16, 620, 652], [tGen, 620, 652, true], [e + 40, 640, 670]]} />
    </SceneLayout>
  );
};

const ContentPanels: React.FC<{ biz: Biz; caption: string; tags: string; script: [string, string][]; headlines: string[]; start: number; photo: string; product: string; price: string; lang?: "EN" | "RW"; compact?: boolean }> = ({ biz, caption, tags, script, headlines, start, photo, product, price, lang = "EN", compact }) => {
  const f = useCurrentFrame();
  const capEnd = start + 50;
  return (
    <div style={{ display: "flex", gap: 14, height: "100%" }}>
      {!compact && (
        <Card pad={12} style={{ width: 210, display: "flex", flexDirection: "column", gap: 10, alignSelf: "flex-start" }}>
          <Photo name={photo} w="100%" h={220} />
          <div style={{ fontSize: 15, fontWeight: 700 }}>{product}</div>
          <Badge tone="neutral">{price}</Badge>
          <div style={{ fontSize: 13, color: C.muted }}>Voice: Friendly · {biz.name}</div>
        </Card>
      )}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
        <Card style={{ ...rise(f, start - 6) }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <Label>Instagram caption</Label>
            <div style={{ display: "flex", gap: 4, background: "#F2F2F5", borderRadius: 999, padding: 3 }}>
              {(["EN", "RW"] as const).map((l) => (
                <span key={l} style={{ fontSize: 12, fontWeight: 600, padding: "4px 10px", borderRadius: 999, background: lang === l ? "white" : undefined, boxShadow: lang === l ? "0 1px 4px rgba(0,0,0,0.1)" : undefined, color: lang === l ? C.text : C.muted }}>{l === "EN" ? "English" : "Kinyarwanda"}</span>
              ))}
            </div>
          </div>
          <div style={{ fontSize: 15, lineHeight: 1.5 }}>{typeIn(caption, f, start, capEnd)}</div>
          <div style={{ fontSize: 14.5, lineHeight: 1.5, color: C.blue, marginTop: 4, opacity: prog(f, capEnd, 10) }}>{tags}</div>
        </Card>
        <div style={{ display: "flex", gap: 12 }}>
          <Card style={{ flex: 1.2, ...rise(f, capEnd - 10) }}>
            <Label style={{ marginBottom: 8 }}>30-second video script</Label>
            {script.map(([t, line], i) => (
              <div key={t} style={{ ...rise(f, capEnd + i * 8, 10), display: "flex", gap: 10, fontSize: 13.5, lineHeight: 1.4, marginBottom: 7 }}>
                <span style={{ flexShrink: 0, width: 52, fontWeight: 700, color: C.violet, fontVariantNumeric: "tabular-nums" }}>{t}</span>
                <span>{line}</span>
              </div>
            ))}
          </Card>
          <Card style={{ flex: 1, ...rise(f, capEnd + 10) }}>
            <Label style={{ marginBottom: 8 }}>Ad headlines</Label>
            {headlines.map((h, i) => (
              <div key={h} style={{ ...rise(f, capEnd + 26 + i * 8, 10), fontSize: 14, fontWeight: 600, lineHeight: 1.35, padding: "9px 11px", borderRadius: 12, background: "rgba(123,92,255,0.07)", marginBottom: 8 }}>{h}</div>
            ))}
          </Card>
        </div>
      </div>
    </div>
  );
};

const INZU_SCRIPT: [string, string][] = [
  ["0–3s", "Close-up: the kitenge print moving in the breeze."],
  ["3–10s", "Aline holds the dress up in the shop: “New this week!”"],
  ["10–20s", "Quick cuts: three colours, a twirl, the price on screen."],
  ["20–30s", "End card: Inzu Fashion, Kimironko · DM to reserve."],
];
const INZU_HEADLINES = ["Kigali's brightest summer dress is here", "Kitenge style for 25,000 RWF", "New arrivals at Inzu Fashion, Kimironko"];

const InzuContent: React.FC = () => {
  const f = useCurrentFrame();
  const s = useScene();
  const voice = isScene(s, "02-starter", "voice");
  const rwAt = at(s, 0.6);
  const rw = voice && f >= rwAt;
  return (
    <SceneLayout eyebrow={voice ? "Your brand voice" : "One click"} title={voice ? <>Sounds like <Grad>you.</Grad></> : <>Captions, scripts, <Grad>headlines.</Grad></>} text={voice ? "In English or Kinyarwanda." : "Written in your brand voice."}>
      <Shell biz={INZU} active="Content" url="bupulse.com/dashboard/content" title="Kitenge summer dress" sub="Generated just now · Friendly voice" action={<Small>↻ Regenerate</Small>}>
        <ContentPanels key={rw ? "rw" : "en"} biz={INZU} caption={rw ? CAPTION_RW : CAPTION_EN} tags={TAGS} script={INZU_SCRIPT} headlines={INZU_HEADLINES} start={voice ? (rw ? rwAt + 4 : 0) : 10} photo="inzu-dress-1.jpg" product="Kitenge summer dress" price="25,000 RWF" lang={rw ? "RW" : "EN"} />
      </Shell>
      {voice ? <Sfx name="click" at={rwAt} volume={0.35} /> : <Sfx name="whoosh" at={10} volume={0.3} />}
      {voice && <Cursor path={[[0, 900, 600], [rwAt - 14, 1050, 205], [rwAt, 1050, 205, true], [s.durationInFrames, 1040, 230]]} />}
      {voice && <Callout at={at(s, 0.15)} until={rwAt - 4} x={250} y={660}>Written like Aline, not a robot</Callout>}
      {rw && <Callout at={rwAt + 10} x={250} y={660}>Now in Kinyarwanda</Callout>}
    </SceneLayout>
  );
};

const DesignPoster: React.FC<{ biz: Biz; photo: string; label: string; title: string; price: string; w: number; h: number; f: number; start: number }> = ({ biz, photo, label, title, price, w, h, f, start }) => {
  const a = prog(f, start, 14), b = prog(f, start + 10, 16), c = prog(f, start + 22, 14);
  return (
    <div style={{ position: "relative", width: w, height: h, borderRadius: 18, overflow: "hidden", boxShadow: "0 24px 60px rgba(29,29,31,0.20)" }}>
      <Photo name={photo} w={w} h={h} r={0} style={{ opacity: a, transform: `scale(${1.08 - 0.08 * a})` }} />
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: h * 0.5, background: `linear-gradient(180deg, transparent, ${biz.colors[0]}EE 60%)`, opacity: b }} />
      <div style={{ position: "absolute", top: 16, left: 16, background: biz.colors[1], color: biz.key === "urugo" ? "#1F3B2F" : "white", fontWeight: 800, fontSize: w * 0.045, letterSpacing: 2, padding: "7px 12px", borderRadius: 8, opacity: c, transform: `translateX(${(1 - c) * -30}px)` }}>{label}</div>
      <Img src={mock(`${biz.key}.png`)} style={{ position: "absolute", top: 14, right: 14, width: w * 0.14, height: w * 0.14, borderRadius: "50%", background: "white", opacity: c }} />
      <div style={{ position: "absolute", left: 18, right: 18, bottom: 18, color: "white", opacity: c, transform: `translateY(${(1 - c) * 20}px)` }}>
        <div style={{ fontSize: w * 0.07, fontWeight: 800, lineHeight: 1.1 }}>{title}</div>
        <div style={{ marginTop: 10, display: "inline-block", background: "white", color: biz.colors[0], fontWeight: 800, fontSize: w * 0.05, padding: "6px 14px", borderRadius: 999 }}>{price}</div>
      </div>
    </div>
  );
};

const InzuDesign: React.FC = () => {
  const f = useCurrentFrame();
  const s = useScene();
  const pick = at(s, 0.15);
  const temps = ["New arrival", "Offer", "Event", "Quote", "Announcement"];
  return (
    <SceneLayout eyebrow="Branded design" title={<>Her logo, <Grad>her colours.</Grad></>} text="Ready to post in seconds.">
      <Shell biz={INZU} active="Designs" url="bupulse.com/dashboard/designs/new" title="New design" sub="Kitenge summer dress" action={<Small>Add to calendar</Small>}>
        <div style={{ display: "flex", gap: 16, height: "100%" }}>
          <Card style={{ width: 230, display: "flex", flexDirection: "column", gap: 8, alignSelf: "flex-start" }}>
            <Label style={{ marginBottom: 4 }}>Template</Label>
            {temps.map((t, i) => {
              const on = i === 0 && f >= pick;
              return <div key={t} style={{ ...rise(f, 4 + i * 4, 10), fontSize: 15, fontWeight: 600, padding: "10px 12px", borderRadius: 12, border: `1.5px solid ${on ? C.blue : C.line}`, background: on ? "rgba(47,107,255,0.08)" : "white", color: on ? C.blue : C.text }}>{on ? "✓ " : ""}{t}</div>;
            })}
            <Label style={{ marginTop: 10 }}>Size</Label>
            <div style={{ display: "flex", gap: 6 }}>{["1:1", "4:5", "9:16"].map((r, i) => <Badge key={r} tone={i === 1 ? "blue" : "neutral"}>{r}</Badge>)}</div>
          </Card>
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 20 }}>
            <DesignPoster biz={INZU} photo="inzu-dress-1.jpg" label="NEW ARRIVAL" title="Kitenge summer dress" price="25,000 RWF" w={330} h={412} f={f} start={pick + 6} />
            <div style={{ display: "flex", flexDirection: "column", gap: 12, opacity: prog(f, pick + 40, 14) }}>
              <Photo name="inzu-dress-2.jpg" w={150} h={150} r={14} />
              <Photo name="inzu-dress-3.jpg" w={150} h={150} r={14} />
              <div style={{ fontSize: 13, color: C.muted, textAlign: "center" }}>More versions</div>
            </div>
          </div>
        </div>
      </Shell>
      <Sfx name="click" at={pick} volume={0.35} />
      <Sfx name="chime" at={pick + 30} volume={0.2} />
      <Cursor path={[[0, 600, 650], [pick - 12, 345, 203], [pick, 345, 203, true], [s.durationInFrames, 360, 230]]} />
      <Callout at={pick + 34} x={430} y={660}>Logo + colours added automatically</Callout>
    </SceneLayout>
  );
};

const InzuContentEdit: React.FC = () => {
  const f = useCurrentFrame();
  const s = useScene();
  const t1 = at(s, 0.08), t2 = at(s, 0.45), t3 = at(s, 0.75);
  const editing = f >= t1;
  const before = "New in at Inzu Fashion ✨ Our Kitenge summer dress is here: light, ";
  const after = " and made for Kigali sunshine 🌞 Sizes S–XL, 25,000 RWF.";
  const del = "bright".slice(0, Math.max(0, 6 - Math.floor(Math.max(0, f - t1) / 3)));
  const word = f < t1 + 20 ? del : typeIn("colourful", f, t1 + 20, t1 + 40);
  const spin = f >= t2 && f < t2 + 24;
  const selected = f >= t3 ? 1 : 0;
  const versions = [["v3", "Just now", "Light, colourful and made for Kigali…"], ["v2", "2 min ago", "Light, bright and made for Kigali…"], ["v1", "5 min ago", "Fresh kitenge just landed…"]];
  return (
    <SceneLayout eyebrow="Edit anything" title={<>Change it, <Grad>your way.</Grad></>} text="Edit, regenerate, or go back.">
      <Shell biz={INZU} active="Content" url="bupulse.com/dashboard/content" title="Kitenge summer dress" sub="Instagram caption" action={<Small style={{ transform: spin ? "scale(0.95)" : undefined }}><span style={{ display: "inline-block", transform: `rotate(${spin ? (f - t2) * 15 : 0}deg)`, marginRight: 6 }}>↻</span>Regenerate</Small>}>
        <div style={{ display: "flex", gap: 14 }}>
          <Card style={{ flex: 1 }}>
            <Label style={{ marginBottom: 10 }}>Caption · editing</Label>
            <div style={{ fontSize: 17, lineHeight: 1.6, border: `1.5px solid ${editing ? C.blue : C.line}`, borderRadius: 14, padding: 14, boxShadow: editing ? "0 0 0 3px rgba(47,107,255,0.15)" : undefined, opacity: spin ? 0.4 : 1 }}>
              {before}
              <span style={{ background: f >= t1 && f < t1 + 20 ? "rgba(47,107,255,0.2)" : f >= t1 + 20 ? "rgba(15,122,74,0.12)" : undefined, borderRadius: 4, padding: "0 2px" }}>{word}</span>
              {editing && f < t2 && <span style={{ display: "inline-block", width: 2, height: 18, background: C.blue, verticalAlign: "middle" }} />}
              {after}
              <div style={{ color: C.blue, marginTop: 6, fontSize: 15 }}>{TAGS}</div>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <Badge tone="success">Saved</Badge>
              <Badge tone="neutral">214 / 2,200 characters</Badge>
            </div>
          </Card>
          <Card style={{ width: 280 }}>
            <Label style={{ marginBottom: 10 }}>Versions</Label>
            {versions.map(([v, when, text], i) => {
              const on = i === selected;
              return (
                <div key={v} style={{ ...rise(f, 6 + i * 5, 10), padding: 11, borderRadius: 12, marginBottom: 8, border: `1.5px solid ${on ? C.blue : C.line}`, background: on ? "rgba(47,107,255,0.06)" : "white" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, fontWeight: 700 }}><span>{v}</span><span style={{ color: C.muted, fontWeight: 500 }}>{when}</span></div>
                  <div style={{ fontSize: 13, color: C.muted, marginTop: 4 }}>{text}</div>
                </div>
              );
            })}
          </Card>
        </div>
      </Shell>
      <Sfx name="typing" at={t1 + 20} volume={0.25} />
      <Sfx name="click" at={t2} volume={0.35} />
      <Sfx name="click" at={t3} volume={0.35} />
      <Cursor path={[[0, 700, 650], [t1 - 10, 640, 270, true], [t2 - 14, 990, 120], [t2, 990, 120, true], [t3 - 14, 960, 300], [t3, 960, 300, true]]} />
    </SceneLayout>
  );
};

const InzuGallery: React.FC = () => {
  const f = useCurrentFrame();
  const s = useScene();
  const folders = [["New arrivals", 12], ["Shop", 8], ["Customers", 5], ["Events", 3]] as const;
  const photos = ["inzu-dress-1.jpg", "inzu-dress-2.jpg", "inzu-shirt.jpg", "inzu-dress-3.jpg", "inzu-accessories.jpg", "inzu-dress-2.jpg", "inzu-shirt.jpg", "inzu-dress-1.jpg"];
  const open = at(s, 0.3);
  return (
    <SceneLayout eyebrow="Gallery" title={<>Every photo, <Grad>organised.</Grad></>} text="Folders for each collection or event.">
      <Shell biz={INZU} active="Gallery" url="bupulse.com/dashboard/gallery" title="Gallery" sub="28 photos · 4 folders" action={<Small>⤒ Upload</Small>}>
        <div style={{ display: "flex", gap: 12, marginBottom: 14 }}>
          {folders.map(([n, c], i) => (
            <Card key={n} pad={12} style={{ ...rise(f, 4 + i * 4, 12), flex: 1, display: "flex", alignItems: "center", gap: 10, border: `1.5px solid ${i === 0 && f >= open ? C.blue : C.line}` }}>
              <div style={{ width: 36, height: 30, borderRadius: 8, background: i === 0 ? INZU.colors[0] : "rgba(47,107,255,0.15)" }} />
              <div><div style={{ fontSize: 14.5, fontWeight: 700 }}>{n}</div><div style={{ fontSize: 12.5, color: C.muted }}>{c} photos</div></div>
            </Card>
          ))}
        </div>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 10, opacity: prog(f, open, 10) }}>New arrivals</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
          {photos.map((p, i) => {
            const q = prog(f, open + 4 + i * 4, 12);
            return <div key={i} style={{ opacity: q, transform: `scale(${0.85 + 0.15 * q})` }}><Photo name={p} w="100%" h={190} r={14} /></div>;
          })}
        </div>
      </Shell>
      <Sfx name="click" at={open} volume={0.35} />
      <Cursor path={[[0, 700, 650], [open - 12, 330, 135], [open, 330, 135, true], [s.durationInFrames, 380, 300]]} />
    </SceneLayout>
  );
};

const DAYS = ["Mon 13", "Tue 14", "Wed 15", "Thu 16", "Fri 17", "Sat 18", "Sun 19"];
type CalPost = { day: number; row: number; title: string; photo: string; time: string; status: "Draft" | "Scheduled" | "Published"; metrics?: string };

const CalendarGrid: React.FC<{ posts: CalPost[]; f: number; showMetrics?: number; colW: number }> = ({ posts, f, showMetrics, colW }) => (
  <div style={{ display: "grid", gridTemplateColumns: `repeat(7, ${colW}px)`, gap: 8 }}>
    {DAYS.map((d) => (
      <div key={d} style={{ fontSize: 13, fontWeight: 700, color: C.muted, padding: "0 4px" }}>{d}</div>
    ))}
    {DAYS.map((d, di) => (
      <div key={d} style={{ height: 470, borderRadius: 14, background: "rgba(255,255,255,0.7)", border: `1px solid ${C.line}`, padding: 6, display: "flex", flexDirection: "column", gap: 6 }}>
        {posts.filter((p) => p.day === di).map((p, i) => (
          <PostChip key={i} p={p} f={f} metrics={showMetrics !== undefined && f >= showMetrics + i * 6 && p.status === "Published" ? p.metrics : undefined} />
        ))}
      </div>
    ))}
  </div>
);

const STATUS_TONE = { Draft: "neutral", Scheduled: "blue", Published: "success" } as const;
const PostChip: React.FC<{ p: CalPost; f: number; metrics?: string; style?: React.CSSProperties }> = ({ p, metrics, style }) => (
  <div style={{ background: "white", borderRadius: 11, border: `1px solid ${C.line}`, padding: 6, boxShadow: "0 4px 12px rgba(0,0,0,0.05)", ...style }}>
    <Photo name={p.photo} w="100%" h={62} r={8} />
    <div style={{ fontSize: 11.5, fontWeight: 700, marginTop: 5, lineHeight: 1.25 }}>{p.title}</div>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
      <span style={{ fontSize: 11, color: C.muted }}>{p.time}</span>
      <Badge tone={STATUS_TONE[p.status]} style={{ fontSize: 10, padding: "2px 7px" }}>{p.status}</Badge>
    </div>
    {metrics && <div style={{ fontSize: 10.5, marginTop: 4, color: C.text, fontWeight: 600 }}>{metrics}</div>}
  </div>
);

const InzuCalendar: React.FC = () => {
  const f = useCurrentFrame();
  const s = useScene();
  const publish = isScene(s, "02-starter", "publish");
  const colW = 108;
  const gridX = MAIN_X; // canvas x of first column
  const gridY = TOP + 18 + 50 + 14 + 26; // header + day labels
  const fri = 4;
  const target = { x: gridX + fri * (colW + 8) + 6, y: gridY + 6 + 150 };
  const startPos = { x: gridX + 6, y: gridY + 300 };
  const grab = at(s, 0.12), drop = at(s, 0.6);
  const t = publish ? 1 : prog(f, grab, Math.max(10, drop - grab));
  const x = startPos.x + (target.x - startPos.x) * t, y = startPos.y + (target.y - startPos.y) * t;
  const flip = at(s, 0.35);
  const status: CalPost["status"] = publish ? (f >= flip ? "Published" : "Scheduled") : f >= drop ? "Scheduled" : "Draft";
  const base: CalPost[] = [
    { day: 0, row: 0, title: "Weekend offer: shirts −15%", photo: "inzu-shirt.jpg", time: "09:00", status: "Published" },
    { day: 2, row: 0, title: "Beaded earrings are back", photo: "inzu-accessories.jpg", time: "12:30", status: "Scheduled" },
    { day: 5, row: 0, title: "Styling tip: kitenge + denim", photo: "inzu-dress-2.jpg", time: "10:00", status: "Draft" },
  ];
  const dragging: CalPost = { day: -1, row: 0, title: "Kitenge summer dress", photo: "inzu-dress-1.jpg", time: f >= drop || publish ? "18:00" : "—", status };
  const local = { x: x - MAIN_X, y: y - TOP - 18 - 64 };
  return (
    <SceneLayout eyebrow="Calendar" title={publish ? <>It posts <Grad>on time.</Grad></> : <>Friday, <Grad>6 pm.</Grad></>} text={publish ? "Or a reminder with everything ready." : "Drag a post to any day and time."}>
      <Shell biz={INZU} active="Calendar" url="bupulse.com/dashboard/calendar" title="Calendar" sub="13 – 19 October · Africa/Kigali">
        <CalendarGrid posts={base} f={f} colW={colW} />
        <div style={{ position: "absolute", left: local.x, top: local.y, width: colW - 12, transform: !publish && f >= grab && f < drop ? "rotate(-3deg) scale(1.05)" : undefined, zIndex: 5 }}>
          <PostChip p={dragging} f={f} style={{ border: `1.5px solid ${status === "Published" ? C.success : C.blue}`, boxShadow: "0 14px 30px rgba(47,107,255,0.25)" }} />
        </div>
        {publish && f >= at(s, 0.55) && (
          <Card style={{ ...rise(f, at(s, 0.55)), position: "absolute", right: 0, bottom: 0, width: 330, display: "flex", gap: 12, alignItems: "center" }}>
            <div style={{ fontSize: 26 }}>🔔</div>
            <div><div style={{ fontSize: 14, fontWeight: 700 }}>Prefer to post yourself?</div><div style={{ fontSize: 13, color: C.muted }}>Get a reminder with the caption and photo ready to share.</div></div>
          </Card>
        )}
      </Shell>
      {!publish && <Sfx name="click" at={grab} volume={0.3} />}
      {!publish && <Sfx name="whoosh" at={drop - 6} volume={0.25} />}
      {publish && <Sfx name="chime" at={flip} volume={0.25} />}
      {!publish && <Cursor path={[[0, startPos.x + 60, startPos.y + 120], [grab - 8, startPos.x + 50, startPos.y + 30], [grab, startPos.x + 50, startPos.y + 30, true], [drop, target.x + 50, target.y + 30], [drop + 2, target.x + 50, target.y + 30, true], [s.durationInFrames, target.x + 70, target.y + 80]]} />}
      {!publish && <Callout at={drop + 6} x={gridX + 4 * (colW + 8) - 120} y={gridY + 360}>Scheduled · Fri 18:00</Callout>}
      {publish && <Callout at={flip + 4} x={gridX + 4 * (colW + 8) - 40} y={gridY + 360}>Published ✓</Callout>}
    </SceneLayout>
  );
};

const InzuUsage: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <SceneLayout eyebrow="Usage" title={<>Always know <Grad>what's left.</Grad></>} text="60 AI texts and 30 designs a month.">
      <Shell biz={INZU} active="Usage" url="bupulse.com/dashboard/usage" title="Usage" sub="This month · 9 Oct – 8 Nov">
        <div style={{ display: "flex", gap: 14 }}>
          <Card pad={22} style={{ flex: 1.4, display: "flex", flexDirection: "column", gap: 22 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontSize: 18, fontWeight: 700 }}>Starter plan</div>
              <Badge tone="violet">15,000 RWF / month</Badge>
            </div>
            <Meter label="AI texts" value={12} max={60} f={f} start={10} />
            <Meter label="Brand designs" value={5} max={30} f={f} start={20} />
            <Meter label="Social channels" value={2} max={3} f={f} start={30} />
            <div style={{ fontSize: 14, color: C.muted }}>Renews on 9 November. Unused texts don't carry over.</div>
          </Card>
          <Card pad={22} style={{ flex: 1, display: "flex", flexDirection: "column", gap: 12, ...rise(f, 30) }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>Need more?</div>
            <div style={{ fontSize: 14, color: C.muted, lineHeight: 1.5 }}>Business gives you 200 AI texts, 100 designs and 3 team members.</div>
            <Button style={{ height: 44, fontSize: 15, alignSelf: "flex-start" }}>See plans</Button>
          </Card>
        </div>
      </Shell>
    </SceneLayout>
  );
};

// ======================= Urugo Homes (Business) =======================
const URUGO = BIZ.urugo;

const UrugoTeam: React.FC = () => {
  const f = useCurrentFrame();
  const s = useScene();
  const roles = isScene(s, "03-business", "roles");
  const i1 = roles ? -999 : at(s, 0.15), i2 = roles ? -999 : at(s, 0.55);
  const members = [
    { name: "Eric Mugisha", email: "eric@urugohomes.rw", role: "Owner", at: -999 },
    { name: "Grace Uwimana", email: "grace@urugohomes.rw", role: "Admin", at: i1 },
    { name: "Jean Bosco Niyonzima", email: "jeanbosco@urugohomes.rw", role: "Member", at: i2 },
  ];
  const email = f < i2 ? typeIn("grace@urugohomes.rw", f, i1 - 30, i1 - 6) : typeIn("jeanbosco@urugohomes.rw", f, i2 - 30, i2 - 6);
  const R = [["Owner", "Billing, plan and everything else", "violet"], ["Admin", "Everything except billing", "blue"], ["Member", "Create and schedule posts, see leads", "neutral"]] as const;
  const hl = roles ? Math.min(2, Math.floor(interpolate(f, [at(s, 0.1), at(s, 0.95)], [0, 3], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }))) : -1;
  return (
    <SceneLayout eyebrow="Team" title={roles ? <>The right access <Grad>for each person.</Grad></> : <>Bring your <Grad>team.</Grad></>} text={roles ? "Owner, Admin or Member." : "Invite colleagues and give each a role."}>
      <Shell biz={URUGO} active="Settings" url="bupulse.com/dashboard/settings/team" title="Team" sub="Business plan · 3 of 3 seats">
        <div style={{ display: "flex", gap: 14 }}>
          <Card style={{ flex: 1.5 }}>
            <Label style={{ marginBottom: 10 }}>Members</Label>
            {members.filter((m) => f >= m.at).map((m) => (
              <div key={m.name} style={{ ...rise(f, m.at, 12), display: "flex", alignItems: "center", gap: 12, padding: "10px 4px", borderBottom: `1px solid ${C.line}` }}>
                <Avatar name={m.name} size={38} color={m.role === "Owner" ? URUGO.colors[0] : m.role === "Admin" ? C.blue : C.violet} />
                <div style={{ flex: 1 }}><div style={{ fontSize: 15, fontWeight: 700 }}>{m.name}</div><div style={{ fontSize: 13, color: C.muted }}>{m.email}</div></div>
                <Badge tone={m.role === "Owner" ? "violet" : m.role === "Admin" ? "blue" : "neutral"}>{m.role}</Badge>
                {m.at > 0 && f < m.at + 40 && <Badge tone="success">Invite sent</Badge>}
              </div>
            ))}
            {!roles && (
              <div style={{ display: "flex", gap: 10, marginTop: 16, alignItems: "flex-end" }}>
                <div style={{ flex: 1 }}><Field label="Invite by email" value={email} caret focus /></div>
                <div style={{ width: 120 }}><Field label="Role" value={f < i2 ? "Admin ▾" : "Member ▾"} /></div>
                <Button style={{ height: 42, fontSize: 15 }}>Invite</Button>
              </div>
            )}
          </Card>
          <Card style={{ flex: 1 }}>
            <Label style={{ marginBottom: 10 }}>Roles</Label>
            {R.map(([r, d, tone], i) => (
              <div key={r} style={{ padding: 12, borderRadius: 12, marginBottom: 8, border: `1.5px solid ${hl === i ? C.blue : C.line}`, background: hl === i ? "rgba(47,107,255,0.06)" : "white", transform: hl === i ? "scale(1.02)" : undefined }}>
                <Badge tone={tone}>{r}</Badge>
                <div style={{ fontSize: 14, marginTop: 6 }}>{d}</div>
              </div>
            ))}
          </Card>
        </div>
      </Shell>
      {!roles && <><Sfx name="typing" at={i1 - 30} volume={0.25} /><Sfx name="click" at={i1} volume={0.35} /><Sfx name="typing" at={i2 - 30} volume={0.25} /><Sfx name="click" at={i2} volume={0.35} /></>}
      {!roles && <Cursor path={[[0, 600, 650], [i1 - 12, 658, 414], [i1, 658, 414, true], [i2 - 40, 640, 470], [i2 - 12, 658, 414], [i2, 658, 414, true]]} />}
    </SceneLayout>
  );
};

const LISTINGS = [
  { name: "3-bedroom house, Kibagabaga", price: "120,000,000 RWF", photo: "urugo-house.jpg", tag: "For sale", status: "Content ready" },
  { name: "2-bedroom apartment, Kimihurura", price: "600,000 RWF / month", photo: "urugo-apartment.jpg", tag: "For rent", status: "Scheduled" },
  { name: "5-bedroom villa, Nyarutarama", price: "450,000,000 RWF", photo: "urugo-villa.jpg", tag: "For sale", status: "Published" },
  { name: "Furnished studio, Kacyiru", price: "350,000 RWF / month", photo: "urugo-living.jpg", tag: "For rent", status: "Draft" },
  { name: "Plot, Rebero (600 m²)", price: "35,000,000 RWF", photo: "urugo-house.jpg", tag: "Land", status: "Draft" },
];

const UrugoProjects: React.FC = () => {
  const f = useCurrentFrame();
  const s = useScene();
  const open = at(s, 0.35);
  const panel = prog(f, open, 16);
  return (
    <SceneLayout eyebrow="Projects" title={<>Every property, <Grad>one project.</Grad></>} text="Photos, price and key features.">
      <Shell biz={URUGO} active="Projects" url="bupulse.com/dashboard/projects" title="Projects" sub="15 listings" action={<Small>+ New project</Small>}>
        <Card pad={8}>
          {LISTINGS.map((l, i) => (
            <div key={l.name} style={{ ...rise(f, 4 + i * 4, 12), display: "flex", alignItems: "center", gap: 14, padding: 9, borderRadius: 12, background: i === 0 && f >= open ? "rgba(47,107,255,0.06)" : undefined }}>
              <Photo name={l.photo} w={84} h={60} r={10} />
              <div style={{ flex: 1 }}><div style={{ fontSize: 15, fontWeight: 700 }}>{l.name}</div><div style={{ fontSize: 13, color: C.muted }}>{l.tag} · {l.price}</div></div>
              <Badge tone={l.status === "Published" ? "success" : l.status === "Scheduled" ? "blue" : l.status === "Draft" ? "neutral" : "violet"}>{l.status}</Badge>
            </div>
          ))}
        </Card>
        {f >= open && (
          <Card style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 360, transform: `translateX(${(1 - panel) * 380}px)`, boxShadow: "-20px 0 50px rgba(0,0,0,0.12)", display: "flex", flexDirection: "column", gap: 10 }}>
            <Photo name="urugo-house.jpg" w="100%" h={170} />
            <div style={{ display: "flex", gap: 8 }}><Photo name="urugo-living.jpg" w="50%" h={80} /><Photo name="urugo-villa.jpg" w="50%" h={80} /></div>
            <div style={{ fontSize: 17, fontWeight: 700 }}>3-bedroom house, Kibagabaga</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: URUGO.colors[0] }}>120,000,000 RWF</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{["3 bedrooms", "2 bathrooms", "Garden", "Parking for 2", "Near schools"].map((t) => <Badge key={t} tone="neutral">{t}</Badge>)}</div>
            <Button style={{ height: 42, fontSize: 15, marginTop: "auto" }}>✨ Generate content</Button>
          </Card>
        )}
      </Shell>
      <Sfx name="click" at={open} volume={0.35} />
      <Cursor path={[[0, 700, 650], [open - 12, 461, 182], [open, 461, 182, true], [s.durationInFrames, 480, 240]]} />
    </SceneLayout>
  );
};

const URUGO_CAPTION = "Just listed in Kibagabaga 🏡 A bright 3-bedroom family home with a garden, parking for two cars and a quiet street close to schools. 120,000,000 RWF. Call or WhatsApp Eric to book a viewing this week.";
const URUGO_TAGS = "#KigaliRealEstate #Kibagabaga #HouseForSale #UrugoHomes";

const UrugoContent: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <SceneLayout eyebrow="Content + design" title={<>Ready to <Grad>post.</Grad></>} text="Caption, script, headlines and a Just listed design.">
      <Shell biz={URUGO} active="Content" url="bupulse.com/dashboard/content" title="3-bedroom house, Kibagabaga" sub="Generated just now · Professional voice" action={<Small>Schedule</Small>}>
        <div style={{ display: "flex", gap: 14, height: "100%" }}>
          <DesignPoster biz={URUGO} photo="urugo-house.jpg" label="JUST LISTED" title="3-bedroom house · Kibagabaga" price="120,000,000 RWF" w={300} h={375} f={f} start={40} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <ContentPanels compact biz={URUGO} caption={URUGO_CAPTION} tags={URUGO_TAGS} start={8} photo="urugo-house.jpg" product="" price=""
              script={[["0–5s", "Drone shot down the street to the gate."], ["5–15s", "Walk-through: living room, kitchen, garden."], ["15–25s", "Eric on the terrace: key features, price."], ["25–30s", "Call or WhatsApp to book a viewing."]]}
              headlines={["Your family home in Kibagabaga", "3 bedrooms, garden, 120M RWF", "Book a viewing this week"]} />
          </div>
        </div>
      </Shell>
      <Sfx name="whoosh" at={8} volume={0.3} />
    </SceneLayout>
  );
};

const UrugoDesign: React.FC = () => {
  const f = useCurrentFrame();
  const tiles = [["urugo-house.jpg", "JUST LISTED"], ["urugo-apartment.jpg", "FOR RENT"], ["urugo-villa.jpg", "OPEN HOUSE"], ["urugo-living.jpg", "NEW PRICE"], ["urugo-villa.jpg", "SOLD"], ["urugo-apartment.jpg", "JUST LISTED"]];
  return (
    <SceneLayout eyebrow="More every month" title={<>200 texts. <Grad>100 designs.</Grad></>} text="Plenty for a busy agency.">
      <Shell biz={URUGO} active="Designs" url="bupulse.com/dashboard/designs" title="Designs" sub="14 made this month" action={<Small>+ New design</Small>}>
        <div style={{ display: "flex", gap: 14 }}>
          <div style={{ flex: 1, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
            {tiles.map(([p, l], i) => (
              <div key={i} style={{ ...rise(f, 4 + i * 5, 14), position: "relative", borderRadius: 14, overflow: "hidden" }}>
                <Photo name={p} w="100%" h={180} r={14} />
                <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 80, background: `linear-gradient(transparent, ${URUGO.colors[0]}EE)` }} />
                <div style={{ position: "absolute", left: 10, bottom: 10, background: URUGO.colors[1], color: "#1F3B2F", fontSize: 11, fontWeight: 800, letterSpacing: 1.5, padding: "4px 8px", borderRadius: 6 }}>{l}</div>
              </div>
            ))}
          </div>
          <Card pad={20} style={{ width: 260, display: "flex", flexDirection: "column", gap: 20, alignSelf: "flex-start" }}>
            <Badge tone="violet">Business plan</Badge>
            <Meter label="AI texts" value={38} max={200} f={f} start={14} />
            <Meter label="Designs" value={14} max={100} f={f} start={24} />
            <Meter label="Team" value={3} max={3} f={f} start={34} />
          </Card>
        </div>
      </Shell>
    </SceneLayout>
  );
};

const NetGlyph: React.FC<{ net: string; size?: number }> = ({ net, size = 40 }) => {
  const st: Record<string, React.CSSProperties> = {
    Facebook: { background: "#1877F2" },
    Instagram: { background: "linear-gradient(135deg,#F58529,#DD2A7B,#8134AF)" },
    LinkedIn: { background: "#0A66C2" },
    TikTok: { background: "#111" },
    YouTube: { background: "#FF0000" },
  };
  const letter: Record<string, string> = { Facebook: "f", Instagram: "◎", LinkedIn: "in", TikTok: "♪", YouTube: "▶" };
  return <div style={{ width: size, height: size, borderRadius: size * 0.28, color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: size * 0.45, flexShrink: 0, ...st[net] }}>{letter[net]}</div>;
};

const UrugoChannels: React.FC = () => {
  const f = useCurrentFrame();
  const s = useScene();
  const c1 = at(s, 0.3), c2 = at(s, 0.65);
  const nets = [
    { n: "Facebook", acct: "Urugo Homes · Page", at: c1 },
    { n: "Instagram", acct: "@urugohomes", at: c2 },
    { n: "LinkedIn", acct: "", at: 1e9 },
    { n: "TikTok", acct: "", at: 1e9 },
    { n: "YouTube", acct: "", at: 1e9 },
  ];
  return (
    <SceneLayout eyebrow="Channels" title={<>One click <Grad>per network.</Grad></>} text="Connect Facebook and Instagram.">
      <Shell biz={URUGO} active="Channels" url="bupulse.com/dashboard/channels" title="Channels" sub="Connect the pages BuPulse posts to">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          {nets.map((x, i) => {
            const on = f >= x.at + 12;
            return (
              <Card key={x.n} style={{ ...rise(f, 4 + i * 4, 12), display: "flex", alignItems: "center", gap: 14, border: `1.5px solid ${on ? "rgba(15,122,74,0.4)" : C.line}` }}>
                <NetGlyph net={x.n} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 16, fontWeight: 700 }}>{x.n}</div>
                  <div style={{ fontSize: 13, color: on ? C.success : C.muted }}>{on ? `Connected · ${x.acct}` : "Not connected"}</div>
                </div>
                {on ? <Badge tone="success">✓ Connected</Badge> : <span style={{ fontSize: 14, fontWeight: 600, padding: "9px 16px", borderRadius: 999, border: `1.5px solid ${C.line}`, transform: f >= x.at && f < x.at + 8 ? "scale(0.94)" : undefined }}>Connect</span>}
              </Card>
            );
          })}
        </div>
      </Shell>
      <Sfx name="click" at={c1} volume={0.35} /><Sfx name="chime" at={c1 + 12} volume={0.2} />
      <Sfx name="click" at={c2} volume={0.35} /><Sfx name="chime" at={c2 + 12} volume={0.2} />
      <Cursor path={[[0, 700, 650], [c1 - 12, 568, 180], [c1, 568, 180, true], [c2 - 12, 997, 180], [c2, 997, 180, true], [s.durationInFrames, 980, 260]]} />
    </SceneLayout>
  );
};

const UrugoComposer: React.FC = () => {
  const f = useCurrentFrame();
  const s = useScene();
  const variants = isScene(s, "03-business", "variants");
  const tabs = ["Instagram", "Facebook", "LinkedIn"];
  const tab = Math.min(2, Math.floor(interpolate(f, [at(s, 0.15), at(s, 0.95)], [0, 3], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })));
  const text = tab === 2
    ? "We're proud to list a 3-bedroom family home in Kibagabaga, one of Kigali's fastest-growing neighbourhoods. The property offers a private garden, secure parking for two cars and quick access to international schools. For investors and families alike, it's a rare chance to own in a quiet, established street. Viewings are open this week: message Eric Mugisha at Urugo Homes."
    : URUGO_CAPTION;
  const checks = ["Photo attached", tab === 2 ? "Long post fits LinkedIn" : "Under 2,200 characters", "4 hashtags", "Posting Fri 18:00"];
  return (
    <SceneLayout eyebrow="Composer" title={variants ? <>A version <Grad>for each network.</Grad></> : <>See it <Grad>before it posts.</Grad></>} text={variants ? "Short for Instagram, longer for LinkedIn." : "Previews and checks for every network."}>
      <Shell biz={URUGO} active="Calendar" url="bupulse.com/dashboard/compose" title="New post" sub="3-bedroom house, Kibagabaga" action={<Small>Schedule</Small>}>
        <div style={{ display: "flex", gap: 14, height: "100%" }}>
          <Card style={{ flex: 1, display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", gap: 8 }}>{tabs.map((t) => <div key={t} style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 10px 5px 5px", borderRadius: 999, background: "rgba(47,107,255,0.08)", fontSize: 13, fontWeight: 600 }}><NetGlyph net={t} size={22} />{t}</div>)}</div>
            <div style={{ fontSize: 14.5, lineHeight: 1.5, border: `1px solid ${C.line}`, borderRadius: 12, padding: 12, flex: 1 }}>{text}<div style={{ color: C.blue, marginTop: 6 }}>{URUGO_TAGS}</div></div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <Photo name="urugo-house.jpg" w={90} h={64} r={10} />
              <Badge tone="neutral">{text.length + URUGO_TAGS.length + 1} / {tab === 2 ? "3,000" : "2,200"}</Badge>
            </div>
            {checks.map((c, i) => <div key={c} style={{ ...rise(f, 20 + i * 6, 8), fontSize: 14, color: C.success, fontWeight: 600 }}>✓ {c}</div>)}
          </Card>
          <Card style={{ width: 340, display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", gap: 4, background: "#F2F2F5", borderRadius: 999, padding: 3 }}>
              {tabs.map((t, i) => <span key={t} style={{ flex: 1, textAlign: "center", fontSize: 13, fontWeight: 600, padding: "6px 0", borderRadius: 999, background: tab === i ? "white" : undefined, boxShadow: tab === i ? "0 1px 4px rgba(0,0,0,0.1)" : undefined, color: tab === i ? C.text : C.muted }}>{t}</span>)}
            </div>
            <div key={tab} style={{ ...rise(f, tab === 0 ? 0 : interpolate(tab, [1, 2], [at(s, 0.15) + (at(s, 0.95) - at(s, 0.15)) / 3, at(s, 0.15) + (2 * (at(s, 0.95) - at(s, 0.15))) / 3]), 14, 12), border: `1px solid ${C.line}`, borderRadius: 14, overflow: "hidden" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: 10 }}>
                <Img src={mock("urugo.png")} style={{ width: 28, height: 28, borderRadius: 14 }} />
                <div style={{ fontSize: 13, fontWeight: 700 }}>{tab === 0 ? "urugohomes" : "Urugo Homes"}</div>
              </div>
              {tab === 2 && <div style={{ fontSize: 12, lineHeight: 1.45, padding: "0 10px 8px" }}>{text.slice(0, 210)}… <span style={{ color: C.muted }}>see more</span></div>}
              {tab === 1 && <div style={{ fontSize: 12, lineHeight: 1.45, padding: "0 10px 8px" }}>{text.slice(0, 120)}…</div>}
              <Photo name="urugo-house.jpg" w="100%" h={tab === 0 ? 300 : tab === 1 ? 230 : 170} r={0} />
              {tab === 0 && <div style={{ fontSize: 12, lineHeight: 1.45, padding: 10 }}><b>urugohomes</b> {text.slice(0, 90)}…</div>}
              <div style={{ fontSize: 12, color: C.muted, padding: "6px 10px 10px" }}>{tab === 0 ? "♡  💬  ↗" : "👍 Like · 💬 Comment · ↗ Share"}</div>
            </div>
          </Card>
        </div>
      </Shell>
    </SceneLayout>
  );
};

const URUGO_WEEK: CalPost[] = [
  { day: 0, row: 0, title: "Just listed: Kibagabaga house", photo: "urugo-house.jpg", time: "09:00", status: "Published", metrics: "👁 1,240 · ♥ 86 · 💬 14" },
  { day: 1, row: 0, title: "For rent: Kimihurura flat", photo: "urugo-apartment.jpg", time: "12:00", status: "Published", metrics: "👁 980 · ♥ 51 · 💬 9" },
  { day: 2, row: 0, title: "Open house Saturday", photo: "urugo-villa.jpg", time: "18:00", status: "Published", metrics: "👁 2,105 · ♥ 132 · 💬 27" },
  { day: 3, row: 0, title: "Tip: what to ask at a viewing", photo: "urugo-living.jpg", time: "10:00", status: "Scheduled" },
  { day: 4, row: 0, title: "New price: Kacyiru studio", photo: "urugo-living.jpg", time: "18:00", status: "Scheduled" },
  { day: 5, row: 0, title: "Villa tour, Nyarutarama", photo: "urugo-villa.jpg", time: "11:00", status: "Scheduled" },
  { day: 6, row: 0, title: "Plot in Rebero", photo: "urugo-house.jpg", time: "16:00", status: "Draft" },
  { day: 2, row: 1, title: "Sold! Thank you, Kagarama", photo: "urugo-apartment.jpg", time: "20:00", status: "Scheduled" },
];

const UrugoCalendar: React.FC = () => {
  const f = useCurrentFrame();
  const s = useScene();
  const results = isScene(s, "03-business", "results");
  const live = at(s, 0.55);
  const posts = URUGO_WEEK.map((p) => (!results && p.day === 3 && f >= live ? { ...p, status: "Published" as const } : p));
  return (
    <SceneLayout eyebrow="Calendar" title={results ? <>See what <Grad>works.</Grad></> : <>Plan the <Grad>whole week.</Grad></>} text={results ? "Views, likes and comments for each post." : "Each post goes live on its own."}>
      <Shell biz={URUGO} active="Calendar" url="bupulse.com/dashboard/calendar" title="Calendar" sub="13 – 19 October · Facebook + Instagram">
        <div style={{ display: "flex", gap: 12, marginBottom: 10 }}>
          {[["Draft", "neutral"], ["Scheduled", "blue"], ["Published", "success"]].map(([l, t]) => <Badge key={l} tone={t as "neutral"}>{l}</Badge>)}
        </div>
        <CalendarGrid posts={posts} f={f} colW={108} showMetrics={results ? at(s, 0.2) : undefined} />
      </Shell>
      {!results && <Sfx name="chime" at={live} volume={0.2} />}
      {!results && <Callout at={live + 4} x={MAIN_X + 3 * 116 - 60} y={480}>Published on time ✓</Callout>}
    </SceneLayout>
  );
};

// ======================= Nova Phones (Custom) =======================
const NOVA = BIZ.nova;

const NovaAnalytics: React.FC = () => {
  const f = useCurrentFrame();
  const s = useScene();
  const kpis = [["Reach", "18,420", "+32%"], ["Engagement", "1,036", "+18%"], ["Website-chat leads", "27", "+9"], ["Best day", "Saturday", "18:00"]];
  const pts = [22, 30, 26, 38, 35, 48, 44, 58, 55, 70, 66, 82];
  const w = 470, h = 170;
  const lp = prog(f, 20, Math.max(20, at(s, 0.5) - 20));
  const path = pts.map((v, i) => `${i ? "L" : "M"}${(i / (pts.length - 1)) * w},${h - (v / 90) * h}`).join(" ");
  const nets = [["Instagram", 11200], ["Facebook", 5900], ["TikTok", 1320]] as const;
  return (
    <SceneLayout eyebrow="Analytics" title={<>Know what's <Grad>working.</Grad></>} text="Reach, best posts and new leads, every week.">
      <Shell biz={NOVA} active="Analytics" url="bupulse.com/dashboard/analytics" title="Analytics" sub="Last 30 days">
        <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
          {kpis.map(([k, v, d], i) => (
            <Card key={k} pad={12} style={{ ...rise(f, 4 + i * 4, 12), flex: 1 }}>
              <div style={{ fontSize: 12.5, color: C.muted }}>{k}</div>
              <div style={{ fontSize: 22, fontWeight: 700, marginTop: 2 }}>{v}</div>
              <div style={{ fontSize: 12.5, color: C.success, fontWeight: 600 }}>{d}</div>
            </Card>
          ))}
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          <Card style={{ flex: 1.3 }}>
            <Label style={{ marginBottom: 10 }}>Reach per week</Label>
            <svg width={w} height={h + 10} style={{ overflow: "visible" }}>
              <defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stopColor="#2F6BFF" /><stop offset="1" stopColor="#7B5CFF" /></linearGradient></defs>
              {[0.25, 0.5, 0.75, 1].map((g) => <line key={g} x1={0} x2={w} y1={h * g} y2={h * g} stroke="#EEE" />)}
              <path d={path} fill="none" stroke="url(#g)" strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={1400} strokeDashoffset={1400 * (1 - lp)} />
            </svg>
            <Label style={{ margin: "14px 0 8px" }}>By network</Label>
            {nets.map(([n, v], i) => (
              <div key={n} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                <NetGlyph net={n} size={22} />
                <div style={{ width: 80, fontSize: 13, fontWeight: 600 }}>{n}</div>
                <div style={{ flex: 1, height: 9, borderRadius: 5, background: "rgba(47,107,255,0.1)" }}><div style={{ width: `${(v / 11200) * 100 * prog(f, 30 + i * 6, 24)}%`, height: "100%", borderRadius: 5, background: C.gradient }} /></div>
                <div style={{ width: 54, textAlign: "right", fontSize: 13, fontVariantNumeric: "tabular-nums" }}>{v.toLocaleString("en-US")}</div>
              </div>
            ))}
          </Card>
          <Card style={{ flex: 1 }}>
            <Label style={{ marginBottom: 10 }}>Best posts</Label>
            {[["nova-a56.jpg", "New arrival: Galaxy A56", "4,820 reach · 312 likes"], ["nova-iphone.jpg", "iPhone 16 in stock", "3,940 reach · 268 likes"], ["nova-accessories.jpg", "Weekend deal: chargers −20%", "2,610 reach · 154 likes"], ["nova-shop.jpg", "Visit our city-centre shop", "1,980 reach · 97 likes"]].map(([p, t, m], i) => (
              <div key={t} style={{ ...rise(f, at(s, 0.4) + i * 6, 12), display: "flex", gap: 10, alignItems: "center", marginBottom: 10 }}>
                <Photo name={p} w={60} h={60} r={10} />
                <div><div style={{ fontSize: 14, fontWeight: 700 }}>{t}</div><div style={{ fontSize: 12.5, color: C.muted }}>{m}</div></div>
              </div>
            ))}
          </Card>
        </div>
      </Shell>
    </SceneLayout>
  );
};

const LEADS = [
  { name: "Claudine Mukamana", interest: "Samsung Galaxy A56", when: "2 min ago", status: "New", tone: "violet" },
  { name: "Eric Nshimiyimana", interest: "iPhone 16 trade-in", when: "1 h ago", status: "Contacted", tone: "blue" },
  { name: "Aisha Kamikazi", interest: "Screen repair", when: "Yesterday", status: "Won", tone: "success" },
  { name: "Moses Twagirayezu", interest: "Chargers, bulk order", when: "2 days ago", status: "Lost", tone: "neutral" },
  { name: "Diane Ingabire", interest: "Phone case + protector", when: "3 days ago", status: "Won", tone: "success" },
] as const;

const NovaLeads: React.FC = () => {
  const f = useCurrentFrame();
  const s = useScene();
  const change = at(s, 0.45), exp = at(s, 0.85);
  const status = f >= change ? "Contacted" : "New";
  return (
    <SceneLayout eyebrow="Leads" title={<>Every lead, <Grad>in one inbox.</Grad></>} text="New, contacted, won or lost.">
      <Shell biz={NOVA} active="Leads" url="bupulse.com/dashboard/leads" title="Leads" sub="27 this month · from website chat" action={<span style={{ fontSize: 13, fontWeight: 600, padding: "9px 14px", borderRadius: 999, border: `1.5px solid ${C.line}`, background: "white", transform: f >= exp && f < exp + 8 ? "scale(0.94)" : undefined }}>⤓ Export CSV</span>}>
        <div style={{ display: "flex", gap: 12, height: "100%" }}>
          <Card pad={8} style={{ flex: 1 }}>
            {LEADS.map((l, i) => (
              <div key={l.name} style={{ ...rise(f, 4 + i * 4, 12), display: "flex", alignItems: "center", gap: 10, padding: 10, borderRadius: 12, background: i === 0 ? "rgba(47,107,255,0.06)" : undefined }}>
                <Avatar name={l.name} size={34} color={i === 0 ? NOVA.colors[0] : "#8E8E93"} />
                <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 14, fontWeight: 700 }}>{l.name}</div><div style={{ fontSize: 12.5, color: C.muted }}>{l.interest} · {l.when}</div></div>
                <Badge tone={i === 0 ? (status === "New" ? "violet" : "blue") : l.tone}>{i === 0 ? status : l.status}</Badge>
              </div>
            ))}
          </Card>
          <Card style={{ width: 360, display: "flex", flexDirection: "column", gap: 10, ...rise(f, 10, 14) }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Avatar name="Claudine Mukamana" size={42} color={NOVA.colors[0]} />
              <div style={{ flex: 1 }}><div style={{ fontSize: 16, fontWeight: 700 }}>Claudine Mukamana</div><div style={{ fontSize: 13, color: C.muted }}>078 334 9021 · Website chat</div></div>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ fontSize: 13, color: C.muted }}>Status</span>
              <span style={{ whiteSpace: "nowrap", fontSize: 13, fontWeight: 600, padding: "6px 12px", borderRadius: 10, border: `1.5px solid ${f >= change - 10 && f < change + 20 ? C.blue : C.line}` }}>{status} ▾</span>
              <Badge tone="neutral">Interest: Samsung Galaxy A56</Badge>
            </div>
            <Label>Conversation</Label>
            {[["v", "Do you have the Samsung A56? What's the price?"], ["b", "Yes! The Galaxy A56 is in stock at 420,000 RWF, with a free case this week. Can I take your name and number so Patrick can reserve one?"], ["v", "Claudine, 078 334 9021"], ["b", "Thank you, Claudine! Patrick will call you shortly."]].map(([who, t], i) => (
              <div key={i} style={{ alignSelf: who === "v" ? "flex-end" : "flex-start", maxWidth: "85%", fontSize: 13, lineHeight: 1.4, padding: "8px 11px", borderRadius: 14, background: who === "v" ? NOVA.colors[0] : "#F2F2F5", color: who === "v" ? "white" : C.text }}>{t}</div>
            ))}
          </Card>
        </div>
      </Shell>
      <Sfx name="click" at={change} volume={0.35} />
      <Sfx name="click" at={exp} volume={0.35} />
      <Cursor path={[[0, 600, 650], [change - 12, 824, 232], [change, 824, 232, true], [exp - 14, 976, 96], [exp, 976, 96, true]]} />
      <Callout at={exp + 6} x={600} y={640}>leads.csv downloaded</Callout>
    </SceneLayout>
  );
};

/** Drawn app screens by Screen key. */
export const APP_MOCKS: Record<string, React.FC> = {
  "inzu/project": InzuProject,
  "inzu/content": InzuContent,
  "inzu/design": InzuDesign,
  "inzu/content-edit": InzuContentEdit,
  "inzu/gallery": InzuGallery,
  "inzu/calendar": InzuCalendar,
  "inzu/usage": InzuUsage,
  "urugo/team": UrugoTeam,
  "urugo/projects": UrugoProjects,
  "urugo/content": UrugoContent,
  "urugo/design": UrugoDesign,
  "urugo/channels": UrugoChannels,
  "urugo/composer": UrugoComposer,
  "urugo/calendar": UrugoCalendar,
  "nova/analytics": NovaAnalytics,
  "nova/leads": NovaLeads,
};

// Silence unused-import warnings for helpers kept for consistency with the other visual files.
void lineStart;

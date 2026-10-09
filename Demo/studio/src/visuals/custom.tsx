// Video 4 (Custom plan, Nova Phones Kigali): the designed screens.
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import manifest from "../audio-manifest.json";
import { rwf } from "../config";
import { ADDONS, BIZ } from "../data";
import { at, useScene, type SceneInfo } from "../scene-context";
import { prog, pop, rise, typed } from "../ui/motion";
import { Avatar, Badge, BrowserFrame, Button, Callout, Cursor, Glass, Mark, PhoneFrame } from "../ui/primitives";
import { Grad, SceneLayout } from "../ui/SceneLayout";
import { Sfx } from "../ui/Sfx";
import { C } from "../theme";

const NOVA = BIZ.nova;
const BLUE = NOVA.colors[0];
const W = 1100;
const H = 760;
const CONTENT_H = H - 52; // inside a BrowserFrame

const fmt = (n: number) => n.toLocaleString("en-US");

/** Text typed between frames a and b. */
const typeIn = (text: string, f: number, a: number, b: number) => text.slice(0, Math.round(text.length * prog(f, a, Math.max(1, b - a))));

/** True when the current scene is `sceneId` of 04-custom (two scenes share the Offer visual). */
function isScene(s: SceneInfo, sceneId: string) {
  const a = (manifest as Record<string, Record<string, { duration: number }>>)["04-custom"]?.[sceneId];
  if (!a) return false;
  return Math.abs(Math.round(0.35 * 30) + Math.round(a.duration * 30) - s.voiceEnd) <= 1;
}

/** Animated value that moves to each new target from frame t over 15 frames. */
function stepValue(f: number, steps: [number, number][], start: number) {
  let v = start;
  for (const [t, target] of steps) {
    if (f < t) break;
    v = v + (target - v) * prog(f, t, 15);
  }
  return v;
}

const Check: React.FC<{ on: number; size?: number; color?: string }> = ({ on, size = 30, color }) => (
  <div style={{ width: size, height: size, borderRadius: 9, flexShrink: 0, border: on > 0.5 ? "none" : `2px solid ${C.line}`, background: on > 0.01 ? (color ?? C.gradient) : "white", display: "flex", alignItems: "center", justifyContent: "center", transform: `scale(${0.85 + 0.15 * on})` }}>
    {on > 0.01 && (
      <svg width={size * 0.6} height={size * 0.6} viewBox="0 0 24 24" style={{ opacity: on }}>
        <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="white" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="30" strokeDashoffset={30 - 30 * on} />
      </svg>
    )}
  </div>
);

const Field: React.FC<{ label: string; value: string; caret?: boolean; height?: number; active?: boolean }> = ({ label, value, caret, height = 58, active }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
    <div style={{ fontSize: 18, fontWeight: 600, color: C.muted }}>{label}</div>
    <div style={{ minHeight: height, borderRadius: 14, border: `1.5px solid ${active ? C.blue : C.line}`, boxShadow: active ? "0 0 0 4px rgba(47,107,255,0.14)" : undefined, background: "white", padding: "14px 18px", fontSize: 21, lineHeight: 1.35, color: C.text }}>
      {value}
      {caret && <span style={{ display: "inline-block", width: 2, height: 24, background: C.blue, marginLeft: 2, verticalAlign: "middle" }} />}
    </div>
  </div>
);

const NovaLogo: React.FC<{ size?: number; dark?: boolean }> = ({ size = 22, dark }) => (
  <div style={{ display: "flex", alignItems: "center", gap: size * 0.4 }}>
    <div style={{ width: size * 1.5, height: size * 1.5, borderRadius: size * 0.4, background: `linear-gradient(135deg, ${BLUE}, #5AC8FA)`, color: "white", fontWeight: 800, fontSize: size * 0.75, display: "flex", alignItems: "center", justifyContent: "center" }}>N</div>
    <div style={{ fontWeight: 700, fontSize: size, color: dark ? "white" : C.text, letterSpacing: -0.3 }}>Nova Phones <span style={{ color: dark ? "#5AC8FA" : BLUE }}>Kigali</span></div>
  </div>
);

/** A simple drawn smartphone (product graphic). */
const PhoneGlyph: React.FC<{ w: number; color?: string; tilt?: number }> = ({ w, color = "#1C1C22", tilt = 0 }) => (
  <div style={{ width: w, height: w * 2, borderRadius: w * 0.16, background: color, padding: w * 0.05, transform: `rotate(${tilt}deg)`, boxShadow: "0 18px 40px rgba(0,0,0,0.35)", position: "relative" }}>
    <div style={{ width: "100%", height: "100%", borderRadius: w * 0.12, background: "linear-gradient(160deg, #6FA8FF 0%, #2F4BFF 45%, #7B5CFF 100%)" }} />
    <div style={{ position: "absolute", top: w * 0.09, left: "50%", width: w * 0.12, height: w * 0.12, marginLeft: -w * 0.06, borderRadius: "50%", background: "#000" }} />
  </div>
);

/* ---------------------------------------------------------------- CustomRequest */

export const CustomRequest: React.FC = () => {
  const f = useCurrentFrame();
  const s = useScene();
  const A = (p: number) => at(s, p);
  const desc = "Smartphones, accessories and repairs in Kigali city centre.";
  const goals = "More customers from Instagram, answer questions faster.";
  const chips = ["Autopilot", "Website chat", "AI photos", "Managed by BuPulse", "Analytics", "Online store"];
  const picked = [0, 1, 2, 3];
  const chipAt = (i: number) => A(0.58 + i * 0.08);
  const chipPos = (i: number): [number, number] => [70 + (i % 3) * 320 + 120, 520 + Math.floor(i / 3) * 70 + 28];
  const sendAt = A(0.95);
  return (
    <SceneLayout eyebrow="Custom plan · Step 1" title={<>Tell us what you <Grad>need</Grad></>}>
      <BrowserFrame url="bupulse.com/custom-plan" width={W} height={H}>
        <div style={{ padding: "30px 60px", display: "flex", flexDirection: "column", gap: 22 }}>
          <div style={{ ...rise(f, 0), display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: -0.8 }}>Ask for a custom plan</div>
            <Badge tone="violet">Free meeting</Badge>
          </div>
          <div style={{ ...rise(f, 4), display: "grid", gridTemplateColumns: "1fr 1fr", gap: 22 }}>
            <Field label="Business" value={NOVA.name} />
            <Field label="Owner" value={NOVA.owner} />
          </div>
          <div style={rise(f, 8)}>
            <Field label="What do you sell?" value={typeIn(desc, f, A(0.06), A(0.3))} caret={f >= A(0.04) && f < A(0.33)} active={f >= A(0.04) && f < A(0.33)} />
          </div>
          <div style={rise(f, 12)}>
            <Field label="Your goals" value={typeIn(goals, f, A(0.34), A(0.55))} caret={f >= A(0.33) && f < A(0.57)} active={f >= A(0.33) && f < A(0.57)} />
          </div>
          <div style={{ ...rise(f, 16) }}>
            <div style={{ fontSize: 18, fontWeight: 600, color: C.muted, marginBottom: 10 }}>Features you're interested in</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 300px)", gap: 14, columnGap: 20 }}>
              {chips.map((c, i) => {
                const on = picked.includes(i) ? prog(f, chipAt(picked.indexOf(i)), 8) : 0;
                return (
                  <div key={c} style={{ height: 56, borderRadius: 999, display: "flex", alignItems: "center", gap: 10, padding: "0 20px", fontSize: 20, fontWeight: 600, border: `1.5px solid ${on > 0.5 ? "transparent" : C.line}`, background: on > 0.5 ? C.gradient : "white", color: on > 0.5 ? "white" : C.text, transform: `scale(${1 + 0.05 * Math.sin(on * Math.PI)})` }}>
                    {on > 0.5 ? "✓" : "+"} {c}
                  </div>
                );
              })}
            </div>
          </div>
          <div style={{ ...rise(f, 20), display: "flex", justifyContent: "flex-end" }}>
            <Button pressed={f >= sendAt && f < sendAt + 6}>Continue to booking →</Button>
          </div>
        </div>
        <Cursor
          path={[
            [0, 900, 640],
            [A(0.03), 500, 300, true],
            [A(0.31), 520, 300],
            [A(0.33), 500, 400, true],
            [A(0.55), 560, 400],
            ...picked.map((p, i): [number, number, number, boolean] => [chipAt(i), ...chipPos(p), true]),
            [sendAt, 940, 670, true],
          ]}
        />
      </BrowserFrame>
      <Sfx name="click" at={A(0.03)} />
      <Sfx name="typing" at={A(0.07)} volume={0.3} />
      <Sfx name="typing" at={A(0.36)} volume={0.3} />
      {picked.map((_, i) => <Sfx key={i} name="click" at={chipAt(i)} volume={0.35} />)}
      <Sfx name="click" at={sendAt} />
    </SceneLayout>
  );
};

/* ---------------------------------------------------------------- Booking */

export const Booking: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = useScene();
  const A = (p: number) => at(s, p);
  const days = ["Mon 13", "Tue 14", "Wed 15", "Thu 16", "Fri 17"];
  const times = ["09:00", "10:00", "11:00", "14:00", "15:00"];
  const busy = new Set(["0-1", "2-0", "2-3", "3-2", "4-4", "1-3"]);
  const pickAt = A(0.28);
  const confirmAt = A(0.45);
  const inviteAt = A(0.55);
  const colX = (d: number) => 60 + d * 196;
  const rowY = (t: number) => 210 + t * 78;
  const picked = f >= pickAt;
  const invite = pop(f, fps, inviteAt, 16);
  return (
    <SceneLayout eyebrow="Custom plan · Step 2" title={<>Book a short <Grad>online meeting</Grad></>}>
      <BrowserFrame url="bupulse.com/custom-plan/book" width={W} height={H}>
        <div style={{ padding: "30px 60px" }}>
          <div style={{ ...rise(f, 0), display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <div style={{ fontSize: 32, fontWeight: 700 }}>Pick a time · 30 minutes</div>
            <div style={{ fontSize: 20, color: C.muted }}>🌍 Africa/Kigali</div>
          </div>
          <div style={{ ...rise(f, 4), fontSize: 20, color: C.muted, marginTop: 6 }}>October 2026 · Google Meet video call</div>
        </div>
        {days.map((d, di) => (
          <div key={d} style={{ position: "absolute", left: colX(di), top: 150, width: 180, textAlign: "center", fontSize: 21, fontWeight: 700, ...rise(f, 6 + di * 2) }}>{d}</div>
        ))}
        {days.map((_, di) =>
          times.map((t, ti) => {
            const key = `${di}-${ti}`;
            const isPick = di === 1 && ti === 1;
            const on = isPick ? prog(f, pickAt, 8) : 0;
            const b = busy.has(key);
            return (
              <div key={key} style={{ position: "absolute", left: colX(di), top: rowY(ti), width: 180, height: 62, borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 21, fontWeight: 600, background: on > 0.5 ? C.gradient : b ? "rgba(0,0,0,0.03)" : "white", color: on > 0.5 ? "white" : b ? "#B5B5BA" : C.text, border: `1.5px solid ${on > 0.5 ? "transparent" : C.line}`, textDecoration: b ? "line-through" : undefined, ...rise(f, 8 + di * 2 + ti), ...(on > 0.5 ? { transform: `scale(${1 + 0.06 * Math.sin(on * Math.PI)})` } : {}) }}>
                {t}
              </div>
            );
          }),
        )}
        <div style={{ position: "absolute", left: 60, right: 60, bottom: 30, display: "flex", justifyContent: "space-between", alignItems: "center", opacity: picked ? 1 : 0.4 }}>
          <div style={{ fontSize: 22, fontWeight: 600 }}>{picked ? "Tue 14 Oct · 10:00–10:30" : "Choose a time"}</div>
          <Button pressed={f >= confirmAt && f < confirmAt + 6}>Confirm booking</Button>
        </div>
        {f >= inviteAt && (
          <div style={{ position: "absolute", inset: 0, background: `rgba(11,11,15,${0.35 * invite})`, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Glass style={{ width: 720, transform: `translateY(${(1 - invite) * 80}px) scale(${0.92 + 0.08 * invite})`, opacity: invite, background: "white" }} pad={34}>
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <div style={{ width: 54, height: 54, borderRadius: 14, background: C.gradient, color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28 }}>📅</div>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 600, color: C.muted, textTransform: "uppercase", letterSpacing: 1.5 }}>Invitation · from hello@bupulse.com</div>
                  <div style={{ fontSize: 28, fontWeight: 700 }}>BuPulse custom plan call</div>
                </div>
              </div>
              <div style={{ marginTop: 22, display: "flex", flexDirection: "column", gap: 12, fontSize: 21 }}>
                <div>🕙 Tuesday 14 October 2026 · 10:00–10:30 (Kigali)</div>
                <div>🎥 Google Meet · <span style={{ color: C.blue, fontWeight: 600 }}>meet.google.com/xxx-xxxx-xxx</span></div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  👥 <Avatar name={NOVA.owner} size={34} color={BLUE} /> Patrick Habimana · <Mark size={30} /> BuPulse team
                </div>
              </div>
              <div style={{ display: "flex", gap: 12, marginTop: 24 }}>
                <Button style={{ height: 46, fontSize: 18 }}>Yes, I'll join</Button>
                <Button variant="outline" style={{ height: 46, fontSize: 18 }}>Add to calendar</Button>
              </div>
            </Glass>
          </div>
        )}
        <Cursor path={[[0, 900, 600], [pickAt, colX(1) + 110, rowY(1) + 38, true], [confirmAt, 930, CONTENT_H - 56, true], [inviteAt + 20, 700, 640]]} />
      </BrowserFrame>
      <Sfx name="click" at={pickAt} />
      <Sfx name="click" at={confirmAt} />
      <Sfx name="ping" at={inviteAt} />
    </SceneLayout>
  );
};

/* ---------------------------------------------------------------- Meeting */

export const Meeting: React.FC = () => {
  const f = useCurrentFrame();
  const s = useScene();
  const A = (p: number) => at(s, p);
  const needs = ["Post every day without losing hours", "Answer stock and price questions online", "Catch leads and get them on WhatsApp", "Branded photos of new phones", "Someone to run the pages"];
  const speaking = Math.floor(f / 40) % 2; // alternate who is talking
  const Tile: React.FC<{ who: "patrick" | "bupulse"; talk: boolean }> = ({ who, talk }) => (
    <div style={{ position: "relative", flex: 1, borderRadius: 22, background: who === "patrick" ? "linear-gradient(160deg, #23324F, #121826)" : "linear-gradient(160deg, #2A2350, #141226)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: talk ? "0 0 0 4px #4ADE80" : undefined }}>
      <div style={{ position: "relative" }}>
        {talk && <div style={{ position: "absolute", inset: -14, borderRadius: "50%", border: "3px solid rgba(74,222,128,0.6)", transform: `scale(${1 + 0.08 * Math.sin(f / 4)})` }} />}
        {who === "patrick" ? <Avatar name={NOVA.owner} size={130} color={BLUE} /> : <div style={{ width: 130, height: 130, borderRadius: 65, background: "white", display: "flex", alignItems: "center", justifyContent: "center" }}><Mark size={84} /></div>}
      </div>
      <div style={{ position: "absolute", left: 18, bottom: 16, background: "rgba(0,0,0,0.5)", color: "white", fontSize: 18, fontWeight: 600, padding: "6px 12px", borderRadius: 10 }}>{who === "patrick" ? "Patrick · Nova Phones" : "BuPulse team"}</div>
    </div>
  );
  return (
    <SceneLayout eyebrow="Custom plan · Step 3" title={<>We listen <Grad>first</Grad></>} text="Then we build the plan around your business.">
      <div style={{ ...rise(f, 0, 40), width: W, height: H, borderRadius: 26, background: "#0E0F14", boxShadow: "0 40px 120px rgba(0,0,0,0.35)", padding: 22, display: "flex", gap: 20 }}>
        <div style={{ flex: 1.35, display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ color: "white", fontSize: 20, fontWeight: 600, display: "flex", justifyContent: "space-between" }}>
            <span>BuPulse custom plan call</span>
            <span style={{ color: "#F87171" }}>● {`10:0${Math.min(9, Math.floor(f / 30) % 10)}`}</span>
          </div>
          <Tile who="patrick" talk={speaking === 0} />
          <Tile who="bupulse" talk={speaking === 1} />
          <div style={{ display: "flex", justifyContent: "center", gap: 18 }}>
            {["🎙️", "🎥", "💬", "📞"].map((e, i) => (
              <div key={e} style={{ width: 58, height: 58, borderRadius: 29, background: i === 3 ? "#E5484D" : "rgba(255,255,255,0.12)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26 }}>{e}</div>
            ))}
          </div>
        </div>
        <div style={{ flex: 1, background: "white", borderRadius: 22, padding: 26 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.blue, letterSpacing: 1.5, textTransform: "uppercase" }}>Shared notes</div>
          <div style={{ fontSize: 26, fontWeight: 700, margin: "6px 0 18px" }}>What Nova Phones needs</div>
          {needs.map((n, i) => {
            const t = A(0.08 + i * 0.16);
            const on = prog(f, t, 10);
            return (
              <div key={n} style={{ display: "flex", gap: 12, alignItems: "flex-start", marginBottom: 16, ...rise(f, t, 16, 12) }}>
                <Check on={on} size={28} />
                <div style={{ fontSize: 21, lineHeight: 1.3 }}>{n}</div>
              </div>
            );
          })}
        </div>
      </div>
    </SceneLayout>
  );
};

/* ---------------------------------------------------------------- CustomBuilder */

type Row = { key: string; name: string; price: number; included?: boolean; prereq?: boolean; stepper?: boolean };

export const CustomBuilder: React.FC = () => {
  const f = useCurrentFrame();
  const s = useScene();
  const l1 = s.lines[0]?.start ?? 10;
  const l2 = s.lines[1]?.start ?? at(s, 0.45);
  const end = s.voiceEnd;
  const B = (p: number) => Math.round(l2 + (end - l2) * p); // beats inside line 2
  const price = (k: string) => ADDONS.find((a) => a.key === k)?.price ?? 0;
  const rows: Row[] = [
    { key: "calendar", name: "Calendar & scheduling", price: 0, included: true, prereq: true },
    { key: "designs", name: "Branded designs", price: 0, included: true, prereq: true },
    { key: "autopilot", name: "Autopilot", price: price("autopilot") },
    { key: "chat", name: "Website chat + WhatsApp leads", price: price("chat") },
    { key: "aiphoto", name: "AI photo designs", price: price("aiphoto"), stepper: true },
    { key: "analytics", name: "Analytics", price: price("analytics") },
    { key: "managed", name: "Managed by BuPulse", price: price("managed") },
  ];
  const clickAt: Record<string, number> = {
    autopilot: l1 + Math.round((l2 - l1) * 0.3),
    chat: B(0.08),
    aiphoto: B(0.2),
    analytics: B(0.52),
    managed: B(0.64),
  };
  const step1 = B(0.32), step2 = B(0.42);
  const aiAmount = f < step1 ? 100 : f < step2 ? 200 : 300;
  const aiPrice = aiAmount === 100 ? 8000 : aiAmount === 200 ? 14000 : price("aiphoto");
  const roundAt = B(0.78);
  const sendAt = B(0.94);
  const BASE = 35000;
  const steps: [number, number][] = [];
  let tot = BASE;
  for (const k of ["autopilot", "chat", "aiphoto"]) {
    tot += k === "aiphoto" ? 8000 : price(k);
    steps.push([clickAt[k], tot]);
  }
  tot += 14000 - 8000; steps.push([step1, tot]);
  tot += price("aiphoto") - 14000; steps.push([step2, tot]);
  tot += price("analytics"); steps.push([clickAt.analytics, tot]);
  tot += price("managed"); steps.push([clickAt.managed, tot]);
  const total = Math.round(stepValue(f, steps, BASE) / 100) * 100;
  const finalTotal = tot; // 190,000
  const rounded = 185000;
  const rowY = (i: number) => 150 + i * 72;
  const prereqFlash = prog(f, clickAt.autopilot + 6, 12) * (1 - prog(f, clickAt.autopilot + 60, 30));
  const added = rows.filter((r) => !r.included && f >= clickAt[r.key]);
  return (
    <SceneLayout eyebrow="Step 4 · BuPulse admin" title={<>Build the plan, <Grad>feature by feature</Grad></>}>
      <BrowserFrame url="bupulse.com/admin/companies/nova-phones" width={W} height={H}>
        <div style={{ display: "flex", height: "100%" }}>
          {/* Left: features */}
          <div style={{ width: 660, padding: "24px 28px", borderRight: `1px solid ${C.line}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14, ...rise(f, 0) }}>
              <Avatar name="Nova Phones" size={50} color={BLUE} />
              <div>
                <div style={{ fontSize: 26, fontWeight: 700 }}>{NOVA.name}</div>
                <div style={{ fontSize: 17, color: C.muted }}>Customise plan · base: Business</div>
              </div>
              <Badge tone="violet" style={{ marginLeft: "auto" }}>Custom (draft)</Badge>
            </div>
            <div style={{ position: "absolute", top: 108, left: 28, fontSize: 15, fontWeight: 700, color: C.muted, letterSpacing: 1.5, textTransform: "uppercase" }}>Features</div>
            {rows.map((r, i) => {
              const on = r.included ? 1 : prog(f, clickAt[r.key], 8);
              const flash = r.prereq ? prereqFlash : 0;
              const showNeeded = r.prereq && f >= clickAt.autopilot + 6;
              return (
                <div key={r.key} style={{ position: "absolute", left: 20, width: 620, top: rowY(i), height: 62, borderRadius: 16, display: "flex", alignItems: "center", gap: 14, padding: "0 14px", background: flash > 0 ? `rgba(123,92,255,${0.14 * flash})` : on > 0.5 && !r.included ? "rgba(47,107,255,0.06)" : "transparent", boxShadow: flash > 0 ? `0 0 0 ${2 * flash}px rgba(123,92,255,0.5)` : undefined, ...rise(f, 4 + i * 2) }}>
                  <Check on={on} color={r.included ? "#8E8E93" : undefined} />
                  <div style={{ fontSize: 21, fontWeight: 600, flex: 1 }}>
                    {r.name}
                    {r.stepper && <span style={{ color: C.muted, fontWeight: 500 }}> · {aiAmount} / month</span>}
                  </div>
                  {r.stepper && on > 0.5 && (
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      {["−", "+"].map((b, bi) => (
                        <div key={b} style={{ width: 34, height: 34, borderRadius: 10, border: `1.5px solid ${C.line}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, fontWeight: 700, background: bi === 1 && ((f >= step1 && f < step1 + 6) || (f >= step2 && f < step2 + 6)) ? "rgba(47,107,255,0.15)" : "white" }}>{b}</div>
                      ))}
                    </div>
                  )}
                  {showNeeded ? (
                    <Badge tone="violet" style={{ fontSize: 15 }}>🔒 needed by Autopilot</Badge>
                  ) : r.included ? (
                    <Badge tone="neutral" style={{ fontSize: 15 }}>Included</Badge>
                  ) : (
                    <div style={{ fontSize: 19, fontWeight: 600, color: on > 0.5 ? C.text : C.muted, width: 110, textAlign: "right" }}>+{fmt(r.stepper ? aiPrice : r.price)}</div>
                  )}
                </div>
              );
            })}
          </div>
          {/* Right: summary */}
          <div style={{ flex: 1, padding: "24px 26px", display: "flex", flexDirection: "column", background: "#FAFAFC" }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.muted, letterSpacing: 1.5, textTransform: "uppercase" }}>Monthly price</div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 19, marginTop: 16 }}>
              <span>Business plan</span><span style={{ fontWeight: 600 }}>{fmt(BASE)}</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10, minHeight: 210 }}>
              {added.map((r) => (
                <div key={r.key} style={{ display: "flex", justifyContent: "space-between", fontSize: 18, ...rise(f, clickAt[r.key], 12, 10) }}>
                  <span style={{ color: C.muted, maxWidth: 270 }}>{r.name.replace(" + WhatsApp leads", "")}</span>
                  <span style={{ fontWeight: 600 }}>+{fmt(r.stepper ? aiPrice : r.price)}</span>
                </div>
              ))}
            </div>
            <div style={{ height: 1, background: C.line, margin: "14px 0" }} />
            <div style={{ fontSize: 17, color: C.muted }}>Total</div>
            <div style={{ fontSize: 42, fontWeight: 800, letterSpacing: -1, color: f >= roundAt + 10 ? C.muted : C.text }}>
              <span style={{ textDecoration: f >= roundAt + 10 ? "line-through" : undefined }}>{fmt(f >= roundAt ? finalTotal : total)}</span> <span style={{ fontSize: 20, fontWeight: 600 }}>RWF</span>
            </div>
            <div style={{ marginTop: 12, opacity: prog(f, roundAt - 10, 10) }}>
              <div style={{ fontSize: 16, color: C.muted, marginBottom: 6 }}>Round to</div>
              <div style={{ height: 52, borderRadius: 14, border: `1.5px solid ${f >= roundAt && f < sendAt ? C.blue : C.line}`, background: "white", display: "flex", alignItems: "center", padding: "0 16px", fontSize: 24, fontWeight: 700, color: C.blue }}>
                {typeIn(fmt(rounded), f, roundAt, roundAt + 18)} RWF / month
              </div>
            </div>
            <div style={{ marginTop: "auto" }}>
              {f >= sendAt + 8 ? (
                <div style={{ ...rise(f, sendAt + 8, 10, 10), height: 56, borderRadius: 999, background: C.successBg, color: C.success, fontWeight: 700, fontSize: 20, display: "flex", alignItems: "center", justifyContent: "center" }}>✓ Offer sent to Patrick</div>
              ) : (
                <Button style={{ width: "100%" }} pressed={f >= sendAt && f < sendAt + 6}>Send offer</Button>
              )}
            </div>
          </div>
        </div>
        <Cursor
          path={[
            [0, 400, 650],
            [clickAt.autopilot, 52, rowY(2) + 31, true],
            [clickAt.chat, 52, rowY(3) + 31, true],
            [clickAt.aiphoto, 52, rowY(4) + 31, true],
            [step1, 551, rowY(4) + 31, true],
            [step2, 551, rowY(4) + 31, true],
            [clickAt.analytics, 52, rowY(5) + 31, true],
            [clickAt.managed, 52, rowY(6) + 31, true],
            [roundAt, 900, 525, true],
            [sendAt, 880, 662, true],
          ]}
        />
        {f < clickAt.autopilot + 110 && <Callout at={clickAt.autopilot + 14} x={225} y={92}>Everything it needs comes with it</Callout>}
      </BrowserFrame>
      {Object.values(clickAt).map((t, i) => <Sfx key={i} name="click" at={t} volume={0.35} />)}
      <Sfx name="click" at={step1} volume={0.3} />
      <Sfx name="click" at={step2} volume={0.3} />
      <Sfx name="click" at={roundAt} volume={0.3} />
      <Sfx name="click" at={sendAt} />
      <Sfx name="whoosh" at={sendAt + 8} volume={0.3} />
    </SceneLayout>
  );
};

/* ---------------------------------------------------------------- Offer (+ payforneed) */

const OFFER_ITEMS: [string, number][] = [
  ["Business plan", 35000],
  ["Autopilot", 20000],
  ["Website chat + WhatsApp leads", 10000],
  ["AI photo designs · 300 / month", 20000],
  ["Analytics", 5000],
  ["Managed by BuPulse", 100000],
  ["Rounding", -5000],
];
const OFFER_TOTAL = OFFER_ITEMS.reduce((n, [, p]) => n + p, 0);

const NAV: { label: string; icon: string; locked?: boolean }[] = [
  { label: "Home", icon: "🏠" },
  { label: "Content", icon: "✍️" },
  { label: "Designs", icon: "🎨" },
  { label: "Calendar", icon: "🗓️" },
  { label: "Gallery", icon: "🖼️" },
  { label: "Autopilot", icon: "✨", locked: true },
  { label: "Website chat", icon: "💬", locked: true },
  { label: "Leads", icon: "📥", locked: true },
  { label: "Analytics", icon: "📈", locked: true },
  { label: "Billing", icon: "💳" },
];

export const Offer: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = useScene();
  const A = (p: number) => at(s, p);
  const summary = isScene(s, "payforneed");
  const acceptAt = summary ? -999 : A(0.18);
  const paidAt = summary ? -999 : A(0.42);
  const approvedAt = summary ? -999 : A(0.62);
  const unlockAt = summary ? 0 : A(0.74);
  const payOpen = !summary && f >= acceptAt + 4 && f < approvedAt + 24;
  const payIn = pop(f, fps, acceptAt + 4, 16) * (1 - prog(f, approvedAt + 14, 10));
  const active = summary || f >= approvedAt + 20;
  const billingIdx = NAV.findIndex((n) => n.label === "Billing");
  return (
    <SceneLayout
      eyebrow={summary ? "Custom plan" : "Step 5"}
      title={summary ? <>Pay only for <Grad>what you need</Grad></> : <>Accept, pay, <Grad>switch on</Grad></>}
    >
      <BrowserFrame url="bupulse.com/dashboard/billing" width={W} height={H}>
        <div style={{ display: "flex", height: "100%" }}>
          <div style={{ width: 230, padding: "22px 14px", borderRight: `1px solid ${C.line}`, background: "#FAFAFC" }}>
            <div style={{ padding: "0 8px 16px" }}><NovaLogo size={17} /></div>
            {NAV.map((n, i) => {
              const lit = n.locked ? (summary ? 1 : prog(f, unlockAt + (i - 5) * 5, 10)) : 1;
              const current = i === billingIdx;
              return (
                <div key={n.label} style={{ position: "relative", height: 50, borderRadius: 12, display: "flex", alignItems: "center", gap: 10, padding: "0 12px", fontSize: 19, fontWeight: 600, whiteSpace: "nowrap", color: current ? C.blue : C.text, background: current ? "rgba(47,107,255,0.10)" : n.locked && lit > 0.05 && lit < 0.99 ? `rgba(123,92,255,${0.25 * (1 - lit)})` : "transparent", opacity: n.locked ? 0.35 + 0.65 * lit : 1 }}>
                  <span>{n.icon}</span>
                  <span>{n.label}</span>
                  {n.locked && lit < 0.5 && <span style={{ marginLeft: "auto", fontSize: 15 }}>🔒</span>}
                  {n.locked && lit >= 0.5 && !summary && f < unlockAt + 80 && <span style={{ marginLeft: "auto", fontSize: 13, fontWeight: 700, color: "white", background: C.gradient, borderRadius: 8, padding: "2px 7px" }}>NEW</span>}
                </div>
              );
            })}
          </div>
          <div style={{ flex: 1, padding: "26px 34px", position: "relative" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14, ...rise(f, 0) }}>
              <div style={{ fontSize: 30, fontWeight: 700 }}>Billing</div>
              {active ? (
                <Badge tone="violet" style={{ fontSize: 18, transform: `scale(${summary ? 1 : 0.7 + 0.3 * pop(f, fps, approvedAt + 20)})` }}>✦ Custom plan · active</Badge>
              ) : (
                <Badge tone="neutral" style={{ fontSize: 18 }}>Business plan</Badge>
              )}
            </div>
            <Glass style={{ marginTop: 20, ...rise(f, 4) }} pad={26}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: C.blue, letterSpacing: 1.5, textTransform: "uppercase" }}>{active ? "Your plan" : "New offer from BuPulse"}</div>
                  <div style={{ fontSize: 26, fontWeight: 700, marginTop: 4 }}>Custom plan for Nova Phones</div>
                </div>
                {!active && <Badge tone="warn">Valid 14 days</Badge>}
              </div>
              <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 9 }}>
                {OFFER_ITEMS.map(([name, p], i) => {
                  const hl = summary ? prog(f, A(0.08 + i * 0.1), 6) * (1 - prog(f, A(0.08 + i * 0.1) + 14, 8)) : 0;
                  return (
                    <div key={name} style={{ display: "flex", justifyContent: "space-between", fontSize: 20, padding: "3px 10px", margin: "0 -10px", borderRadius: 10, background: hl > 0 ? `rgba(47,107,255,${0.12 * hl})` : undefined, color: p < 0 ? C.muted : C.text, ...rise(f, 6 + i * 3, 12, 12) }}>
                      <span>{p > 0 && i > 0 ? "✓ " : ""}{name}</span>
                      <span style={{ fontWeight: 600 }}>{p < 0 ? "−" : ""}{fmt(Math.abs(p))}</span>
                    </div>
                  );
                })}
              </div>
              <div style={{ height: 1, background: C.line, margin: "14px 0" }} />
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontSize: 32, fontWeight: 800, letterSpacing: -0.8 }}>{rwf(OFFER_TOTAL)} <span style={{ fontSize: 18, color: C.muted, fontWeight: 500 }}>/ month</span></div>
                {active ? (
                  <Button variant="outline" style={{ fontSize: 18 }}>+ Add more features</Button>
                ) : (
                  <Button pressed={f >= acceptAt && f < acceptAt + 6}>Accept & pay</Button>
                )}
              </div>
            </Glass>
            {payOpen && (
              <div style={{ position: "absolute", inset: 0, background: `rgba(11,11,15,${0.3 * payIn})`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Glass style={{ width: 560, background: "white", opacity: payIn, transform: `translateY(${(1 - payIn) * 60}px)` }} pad={30}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: C.blue, letterSpacing: 1.5, textTransform: "uppercase" }}>Pay with Mobile Money</div>
                  <div style={{ fontSize: 34, fontWeight: 800, marginTop: 6 }}>{rwf(OFFER_TOTAL)}</div>
                  <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "10px 18px", marginTop: 16, fontSize: 20 }}>
                    <span style={{ color: C.muted }}>MoMo Pay code</span><span style={{ fontWeight: 700 }}>184 772</span>
                    <span style={{ color: C.muted }}>Reference</span><span style={{ fontWeight: 700 }}>BP-N0V4</span>
                    <span style={{ color: C.muted }}>Transaction ID</span><span style={{ fontWeight: 600 }}>{typeIn("MP261014.1022.K48913", f, acceptAt + 16, paidAt - 4)}</span>
                  </div>
                  <div style={{ marginTop: 22 }}>
                    {f < paidAt + 4 ? (
                      <Button style={{ width: "100%" }} pressed={f >= paidAt && f < paidAt + 6}>I've paid</Button>
                    ) : f < approvedAt ? (
                      <div style={{ height: 52, borderRadius: 999, background: "rgba(255,170,0,0.14)", color: "#9A5B00", fontWeight: 700, fontSize: 19, display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
                        <span style={{ display: "inline-block", width: 20, height: 20, borderRadius: 10, border: "3px solid #E0A526", borderTopColor: "transparent", transform: `rotate(${f * 12}deg)` }} />
                        Waiting for approval · usually a few minutes
                      </div>
                    ) : (
                      <div style={{ height: 52, borderRadius: 999, background: C.successBg, color: C.success, fontWeight: 700, fontSize: 20, display: "flex", alignItems: "center", justifyContent: "center" }}>✓ Payment approved</div>
                    )}
                  </div>
                </Glass>
              </div>
            )}
          </div>
        </div>
        {!summary && (
          <Cursor path={[[0, 700, 650], [acceptAt, 935, 595, true], [acceptAt + 30, 640, 560], [paidAt, 560, 545, true], [approvedAt + 30, 140, 330]]} />
        )}
        {summary && <Callout at={A(0.62)} x={600} y={630}>Add more as the shop grows</Callout>}
      </BrowserFrame>
      {!summary && (
        <>
          <Sfx name="click" at={acceptAt} />
          <Sfx name="typing" at={acceptAt + 16} volume={0.25} />
          <Sfx name="click" at={paidAt} />
          <Sfx name="chime" at={approvedAt} />
          <Sfx name="whoosh" at={unlockAt} volume={0.3} />
        </>
      )}
    </SceneLayout>
  );
};

/* ---------------------------------------------------------------- InstagramConnect */

const IgGlyph: React.FC<{ size: number }> = ({ size }) => (
  <div style={{ width: size, height: size, borderRadius: size * 0.28, background: "linear-gradient(45deg, #FEDA75 0%, #FA7E1E 25%, #D62976 55%, #962FBF 80%, #4F5BD5 100%)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
    <div style={{ width: size * 0.56, height: size * 0.56, borderRadius: size * 0.17, border: `${size * 0.07}px solid white`, display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
      <div style={{ width: size * 0.22, height: size * 0.22, borderRadius: "50%", border: `${size * 0.07}px solid white` }} />
    </div>
  </div>
);

export const InstagramConnect: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = useScene();
  const A = (p: number) => at(s, p);
  const connectAt = A(0.1);
  const sheetAt = connectAt + 6;
  const allowAt = A(0.62);
  const doneAt = allowAt + 10;
  const sheet = pop(f, fps, sheetAt, 16) * (1 - prog(f, doneAt, 8));
  const connected = f >= doneAt + 4;
  const channels: { name: string; glyph: React.ReactNode; status: "connected" | "connect" | "ig" }[] = [
    { name: "Facebook Page", glyph: <div style={{ width: 52, height: 52, borderRadius: 14, background: "#1877F2", color: "white", fontWeight: 800, fontSize: 30, display: "flex", alignItems: "center", justifyContent: "center" }}>f</div>, status: "connected" },
    { name: "Instagram", glyph: <IgGlyph size={52} />, status: "ig" },
    { name: "TikTok", glyph: <div style={{ width: 52, height: 52, borderRadius: 14, background: "#111", color: "white", fontSize: 28, display: "flex", alignItems: "center", justifyContent: "center" }}>♪</div>, status: "connect" },
    { name: "LinkedIn", glyph: <div style={{ width: 52, height: 52, borderRadius: 14, background: "#0A66C2", color: "white", fontWeight: 800, fontSize: 24, display: "flex", alignItems: "center", justifyContent: "center" }}>in</div>, status: "connect" },
  ];
  const cardY = (i: number) => 130 + i * 128;
  return (
    <SceneLayout eyebrow="Channels" title={<>Instagram, <Grad>connected</Grad></>} text="One button. No passwords shared with us.">
      <BrowserFrame url="bupulse.com/dashboard/connections" width={W} height={H}>
        <div style={{ padding: "28px 50px" }}>
          <div style={{ fontSize: 32, fontWeight: 700, ...rise(f, 0) }}>Channels</div>
          <div style={{ fontSize: 20, color: C.muted, ...rise(f, 2) }}>Connect the pages BuPulse posts to.</div>
        </div>
        {channels.map((c, i) => {
          const ig = c.status === "ig";
          return (
            <div key={c.name} style={{ position: "absolute", left: 50, right: 50, top: cardY(i), height: 108, ...rise(f, 3 + i * 2) }}>
              <Glass pad={0} radius={22} style={{ height: "100%", display: "flex", alignItems: "center", gap: 20, padding: "0 26px", boxShadow: ig && connected ? "0 0 0 3px rgba(15,122,74,0.35), 0 20px 50px rgba(0,0,0,0.08)" : undefined }}>
                {c.glyph}
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 23, fontWeight: 700 }}>{c.name}</div>
                  <div style={{ fontSize: 18, color: C.muted }}>{ig ? (connected ? "@novaphoneskigali · posting automatically" : "Business or creator account") : c.status === "connected" ? "Nova Phones Kigali" : "Not connected"}</div>
                </div>
                {(c.status === "connected" || (ig && connected)) ? (
                  <Badge tone="success" style={{ fontSize: 18, transform: ig ? `scale(${0.7 + 0.3 * pop(f, fps, doneAt + 4)})` : undefined }}>✓ Connected</Badge>
                ) : (
                  <Button variant={ig ? "primary" : "outline"} style={{ height: 48, fontSize: 18 }} pressed={ig && f >= connectAt && f < connectAt + 6}>Connect</Button>
                )}
              </Glass>
            </div>
          );
        })}
        {f >= sheetAt && f < doneAt + 10 && (
          <div style={{ position: "absolute", inset: 0, background: `rgba(11,11,15,${0.35 * sheet})`, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ width: 520, background: "white", borderRadius: 26, padding: 32, boxShadow: "0 40px 100px rgba(0,0,0,0.3)", opacity: sheet, transform: `translateY(${(1 - sheet) * 70}px)`, display: "flex", flexDirection: "column", alignItems: "center", gap: 14, textAlign: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <IgGlyph size={64} />
                <div style={{ fontSize: 30, color: C.muted }}>⇄</div>
                <div style={{ width: 64, height: 64, borderRadius: 18, background: "white", border: `1px solid ${C.line}`, display: "flex", alignItems: "center", justifyContent: "center" }}><Mark size={44} /></div>
              </div>
              <div style={{ fontSize: 25, fontWeight: 700, marginTop: 6 }}>Allow BuPulse to publish posts for @novaphoneskigali?</div>
              <div style={{ alignSelf: "stretch", textAlign: "left", display: "flex", flexDirection: "column", gap: 8, fontSize: 19, color: C.text, background: "#F7F7F9", borderRadius: 16, padding: "14px 18px" }}>
                <div>✓ Publish photos, carousels and captions</div>
                <div>✓ Read likes, comments and reach</div>
              </div>
              <div style={{ alignSelf: "stretch", height: 54, borderRadius: 14, background: "#0095F6", color: "white", fontWeight: 700, fontSize: 21, display: "flex", alignItems: "center", justifyContent: "center", transform: f >= allowAt && f < allowAt + 6 ? "scale(0.97)" : undefined }}>Allow</div>
              <div style={{ fontSize: 18, color: C.muted }}>Cancel</div>
            </div>
          </div>
        )}
        <Cursor path={[[0, 700, 640], [connectAt, 975, cardY(1) + 54, true], [sheetAt + 20, 700, 600], [allowAt, 550, 560, true], [doneAt + 20, 820, cardY(1) + 80]]} />
      </BrowserFrame>
      <Sfx name="click" at={connectAt} />
      <Sfx name="whoosh" at={sheetAt} volume={0.25} />
      <Sfx name="click" at={allowAt} />
      <Sfx name="chime" at={doneAt + 4} />
    </SceneLayout>
  );
};

/* ---------------------------------------------------------------- Autopilot */

const AUTOPILOT_POSTS: { day: string; title: string; emoji: string; bg: string; tag: string }[] = [
  { day: "Mon 13", title: "New arrival: Galaxy A56", emoji: "📱", bg: `linear-gradient(140deg, ${BLUE}, #0B2E66)`, tag: "NEW" },
  { day: "Tue 14", title: "Weekend deal: chargers −20%", emoji: "🔌", bg: "linear-gradient(140deg, #FF9F0A, #C2410C)", tag: "−20%" },
  { day: "Wed 15", title: "Tip: protect your screen", emoji: "🛡️", bg: "linear-gradient(140deg, #30D158, #0F7A4A)", tag: "TIP" },
  { day: "Thu 16", title: "iPhone 16 in stock", emoji: "📱", bg: "linear-gradient(140deg, #1C1C22, #3A3A44)", tag: "IN STOCK" },
  { day: "Fri 17", title: "Customer of the week", emoji: "🤝", bg: "linear-gradient(140deg, #7B5CFF, #2F6BFF)", tag: "THANK YOU" },
  { day: "Sat 18", title: "Trade in your old phone", emoji: "♻️", bg: "linear-gradient(140deg, #0A84FF, #5AC8FA)", tag: "TRADE-IN" },
  { day: "Sun 19", title: "Sunday offer", emoji: "🎁", bg: "linear-gradient(140deg, #E5484D, #8B1E2D)", tag: "SUNDAY" },
];

export const Autopilot: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = useScene();
  const A = (p: number) => at(s, p);
  const planAt = A(0.06);
  const cardAt = (i: number) => A(0.12) + i * Math.round((A(0.45) - A(0.12)) / 7);
  const approveAt = A(0.56);
  const schedAt = (i: number) => approveAt + 6 + i * 4;
  const publishAt = A(0.86);
  const cw = 238, chh = 268, gx = 16;
  const pos = (i: number) => ({ left: 30 + (i % 4) * (cw + gx), top: 112 + Math.floor(i / 4) * (chh + 16) });
  return (
    <SceneLayout eyebrow="Autopilot" title={<>Next week, <Grad>planned for you</Grad></>}>
      <BrowserFrame url="bupulse.com/dashboard/autopilot" width={W} height={H}>
        <div style={{ position: "absolute", left: 30, right: 30, top: 22, display: "flex", alignItems: "center", gap: 14, ...rise(f, 0) }}>
          <div>
            <div style={{ fontSize: 30, fontWeight: 700 }}>✨ Autopilot</div>
            <div style={{ fontSize: 18, color: C.muted }}>Next week · 13–19 October</div>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 12 }}>
            <Button variant="outline" style={{ height: 50, fontSize: 18 }} pressed={f >= planAt && f < planAt + 6}>Plan next week</Button>
            <Button style={{ height: 50, fontSize: 18, opacity: f >= cardAt(6) ? 1 : 0.4 }} pressed={f >= approveAt && f < approveAt + 6}>Approve all</Button>
          </div>
        </div>
        {AUTOPILOT_POSTS.map((p, i) => {
          const a = pop(f, fps, cardAt(i), 15);
          if (f < cardAt(i)) return null;
          const sch = f >= schedAt(i);
          const pub = i === 0 && f >= publishAt;
          return (
            <div key={p.day} style={{ position: "absolute", ...pos(i), width: cw, height: chh, opacity: a, transform: `translateY(${(1 - a) * 30}px) scale(${0.9 + 0.1 * a})` }}>
              <Glass pad={10} radius={18} style={{ height: "100%", display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 17, fontWeight: 700 }}>
                  <span>{p.day}</span>
                  {pub ? <Badge tone="success" style={{ fontSize: 13, padding: "4px 8px", transform: `scale(${0.7 + 0.3 * pop(f, fps, publishAt)})` }}>✓ Published</Badge> : sch ? <Badge tone="blue" style={{ fontSize: 13, padding: "4px 8px" }}>Scheduled</Badge> : <Badge tone="neutral" style={{ fontSize: 13, padding: "4px 8px" }}>Draft</Badge>}
                </div>
                <div style={{ position: "relative", flex: 1, borderRadius: 12, background: p.bg, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <div style={{ fontSize: 64 }}>{p.emoji}</div>
                  <div style={{ position: "absolute", left: 8, top: 8, fontSize: 12, fontWeight: 800, color: "white", background: "rgba(0,0,0,0.3)", padding: "3px 8px", borderRadius: 6, letterSpacing: 1 }}>{p.tag}</div>
                  <div style={{ position: "absolute", right: 8, bottom: 6, fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.9)" }}>NOVA PHONES</div>
                </div>
                <div style={{ fontSize: 18, fontWeight: 600, lineHeight: 1.2, height: 44 }}>{p.title}</div>
              </Glass>
            </div>
          );
        })}
        <div style={{ position: "absolute", ...pos(7), width: cw, height: chh, opacity: prog(f, cardAt(6) + 6, 12) }}>
          <div style={{ height: "100%", borderRadius: 18, border: `2px dashed ${C.line}`, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, textAlign: "center", padding: 16 }}>
            <div style={{ fontSize: 44, fontWeight: 800, background: C.gradient, WebkitBackgroundClip: "text", color: "transparent" }}>7 posts</div>
            <div style={{ fontSize: 18, color: C.muted }}>with captions and designs, written in Nova's voice</div>
          </div>
        </div>
        <Cursor path={[[0, 700, 640], [planAt, 812, 47, true], [approveAt - 20, 980, 140], [approveAt, 990, 47, true], [approveAt + 30, 700, 420]]} />
      </BrowserFrame>
      <Sfx name="click" at={planAt} />
      <Sfx name="whoosh" at={cardAt(0)} volume={0.25} />
      <Sfx name="click" at={approveAt} />
      <Sfx name="chime" at={publishAt} volume={0.4} />
    </SceneLayout>
  );
};

/* ---------------------------------------------------------------- AiPhoto */

const PlainPhoto: React.FC<{ w: number; h: number }> = ({ w, h }) => (
  <div style={{ width: w, height: h, position: "relative", overflow: "hidden", background: "linear-gradient(180deg, #E9E4DC 0%, #D8D0C4 62%, #B9A994 62%, #A8977F 100%)" }}>
    <div style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -55%)" }}>
      <PhoneGlyph w={w * 0.3} tilt={-8} />
    </div>
    <div style={{ position: "absolute", left: w * 0.14, bottom: h * 0.14, width: w * 0.72, height: 14, borderRadius: "50%", background: "rgba(0,0,0,0.18)", filter: "blur(6px)" }} />
  </div>
);

const Poster: React.FC<{ w: number; h: number }> = ({ w, h }) => (
  <div style={{ width: w, height: h, position: "relative", overflow: "hidden", background: `radial-gradient(circle at 70% 30%, #2B7BFF 0%, ${BLUE} 25%, #06204A 70%, #000 100%)`, color: "white", padding: 26, display: "flex", flexDirection: "column" }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <NovaLogo size={18} dark />
      <div style={{ fontSize: 15, fontWeight: 800, background: "#FFD60A", color: "#111", padding: "6px 12px", borderRadius: 999, letterSpacing: 1 }}>NEW ARRIVAL</div>
    </div>
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ position: "absolute", width: w * 0.62, height: w * 0.62, borderRadius: "50%", background: "radial-gradient(circle, rgba(90,200,250,0.45), transparent 70%)" }} />
      <PhoneGlyph w={w * 0.28} tilt={-8} />
    </div>
    <div style={{ fontSize: 32, fontWeight: 800, letterSpacing: -0.6 }}>Samsung Galaxy A56</div>
    <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 4 }}>
      <div style={{ fontSize: 40, fontWeight: 800, color: "#FFD60A" }}>420,000 RWF</div>
    </div>
    <div style={{ fontSize: 17, opacity: 0.85, marginTop: 6 }}>City centre, Kigali · {NOVA.phone}</div>
  </div>
);

export const AiPhoto: React.FC = () => {
  const f = useCurrentFrame();
  const s = useScene();
  const A = (p: number) => at(s, p);
  const scanA = A(0.22), scanB = A(0.62);
  const scan = prog(f, scanA, scanB - scanA);
  const done = f >= scanB;
  const pw = 440, ph = 600;
  const sparkles = Array.from({ length: 14 }, (_, i) => ({ x: (i * 97) % pw, y: (i * 173) % ph, d: (i * 7) % 20 }));
  return (
    <SceneLayout eyebrow="AI photo designs" title={<>From a phone photo to a <Grad>poster</Grad></>}>
      <div style={{ width: W, height: H, display: "flex", alignItems: "center", justifyContent: "center", gap: 46 }}>
        <div style={{ ...rise(f, 0, 30), display: "flex", flexDirection: "column", gap: 12, alignItems: "center" }}>
          <div style={{ borderRadius: 22, overflow: "hidden", boxShadow: "0 30px 70px rgba(0,0,0,0.18)" }}><PlainPhoto w={320} h={430} /></div>
          <Badge tone="neutral" style={{ fontSize: 18 }}>📷 Patrick's photo</Badge>
        </div>
        <div style={{ ...rise(f, 6), display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
          <div style={{ width: 70, height: 70, borderRadius: 35, background: C.gradient, color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 32, boxShadow: "0 16px 40px rgba(47,107,255,0.4)", transform: `rotate(${f * (done ? 0 : 3)}deg)` }}>✦</div>
          <div style={{ fontSize: 18, fontWeight: 600, color: C.muted }}>{done ? "Done" : f >= scanA ? "Designing…" : "AI design"}</div>
        </div>
        <div style={{ ...rise(f, 10, 30), display: "flex", flexDirection: "column", gap: 12, alignItems: "center" }}>
          <div style={{ position: "relative", width: pw, height: ph, borderRadius: 24, overflow: "hidden", boxShadow: done ? "0 40px 90px rgba(10,132,255,0.35)" : "0 30px 70px rgba(0,0,0,0.18)" }}>
            <div style={{ position: "absolute", inset: 0 }}><PlainPhoto w={pw} h={ph} /></div>
            <div style={{ position: "absolute", inset: 0, clipPath: `inset(0 0 ${(1 - scan) * 100}% 0)` }}><Poster w={pw} h={ph} /></div>
            {f >= scanA && !done && (
              <>
                <div style={{ position: "absolute", left: 0, right: 0, top: scan * ph - 3, height: 6, background: "linear-gradient(90deg, transparent, #7B5CFF, #2F6BFF, transparent)", boxShadow: "0 0 30px 8px rgba(123,92,255,0.6)" }} />
                {sparkles.map((sp, i) => {
                  const near = Math.abs(sp.y - scan * ph) < 70;
                  return near ? <div key={i} style={{ position: "absolute", left: sp.x, top: sp.y, fontSize: 18 + (sp.d % 10), color: "white", opacity: 0.9, textShadow: "0 0 10px #7B5CFF" }}>✦</div> : null;
                })}
              </>
            )}
          </div>
          <Badge tone="violet" style={{ fontSize: 18, opacity: done ? 1 : 0.4 }}>✨ Ready to post · in Nova's colours</Badge>
        </div>
      </div>
      <Sfx name="whoosh" at={scanA} volume={0.3} />
      <Sfx name="chime" at={scanB} volume={0.4} />
    </SceneLayout>
  );
};

/* ---------------------------------------------------------------- WebsiteChat */

export const WebsiteChat: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = useScene();
  const l2 = s.lines[1]?.start ?? at(s, 0.72);
  const P = (p: number) => Math.round(l2 * p); // beats inside line 1
  const openAt = P(0.05);
  const q = "Do you have the Samsung A56? What's the price?";
  const qTypeA = P(0.1), qTypeB = P(0.28), qSent = P(0.3);
  const dotsA = P(0.32), botA = P(0.42), botB = P(0.68);
  const bot = "Yes! The Galaxy A56 is in stock at 420,000 RWF, with a free case this week. Can I take your name and number so Patrick can reserve one for you?";
  const r = "Claudine, 078 334 9021";
  const rTypeA = P(0.72), rTypeB = P(0.86), rSent = P(0.88);
  const thanksAt = P(0.95);
  const phoneAt = l2 + 6;
  const leadAt = l2 + Math.round((s.voiceEnd - l2) * 0.5);
  const widget = pop(f, fps, openAt, 16);
  const phone = pop(f, fps, phoneAt, 14) * (1 - prog(f, leadAt - 8, 12));
  const lead = pop(f, fps, leadAt, 16);
  const input = f < qSent ? typeIn(q, f, qTypeA, qTypeB) : f >= rTypeA && f < rSent ? typeIn(r, f, rTypeA, rTypeB) : "";
  const Bubble: React.FC<{ me?: boolean; children: React.ReactNode; t: number }> = ({ me, children, t }) => (
    <div style={{ alignSelf: me ? "flex-end" : "flex-start", maxWidth: 300, padding: "10px 14px", borderRadius: 16, fontSize: 17, lineHeight: 1.35, background: me ? BLUE : "#F0F1F5", color: me ? "white" : C.text, borderBottomRightRadius: me ? 4 : 16, borderBottomLeftRadius: me ? 16 : 4, ...rise(f, t, 12, 10) }}>{children}</div>
  );
  return (
    <SceneLayout eyebrow="Website chat" title={<>Questions answered. <Grad>Leads caught.</Grad></>}>
      <BrowserFrame url="novaphones.rw" width={W} height={H}>
        {/* Nova's own website */}
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, #F4F8FF, #FFFFFF)" }}>
          <div style={{ display: "flex", alignItems: "center", padding: "20px 36px", borderBottom: `1px solid ${C.line}` }}>
            <NovaLogo size={22} />
            <div style={{ marginLeft: "auto", display: "flex", gap: 28, fontSize: 18, color: C.muted, fontWeight: 600 }}><span>Phones</span><span>Accessories</span><span>Repairs</span><span>Contact</span></div>
          </div>
          <div style={{ padding: "34px 36px 0" }}>
            <div style={{ fontSize: 44, fontWeight: 800, letterSpacing: -1, maxWidth: 560, lineHeight: 1.08 }}>The latest phones, <span style={{ color: BLUE }}>best prices</span> in Kigali.</div>
            <div style={{ fontSize: 19, color: C.muted, marginTop: 10 }}>Genuine phones · 12-month warranty · same-day repairs</div>
          </div>
          <div style={{ display: "flex", gap: 18, padding: "28px 36px" }}>
            {NOVA.products.map((p, i) => (
              <div key={p.name} style={{ width: 196, borderRadius: 18, background: "white", border: `1px solid ${C.line}`, padding: 14, boxShadow: "0 10px 30px rgba(0,0,0,0.05)" }}>
                <div style={{ height: 130, borderRadius: 12, background: i === 2 ? "#F1F3F7" : "linear-gradient(160deg,#EAF2FF,#DCE6FF)", display: "flex", alignItems: "center", justifyContent: "center" }}>{i === 2 ? <span style={{ fontSize: 50 }}>🔌</span> : <PhoneGlyph w={48} />}</div>
                <div style={{ fontSize: 17, fontWeight: 700, marginTop: 10 }}>{p.name}</div>
                <div style={{ fontSize: 16, color: BLUE, fontWeight: 700 }}>{p.price}</div>
              </div>
            ))}
          </div>
        </div>
        {/* Launcher */}
        {f < openAt + 4 && <div style={{ position: "absolute", right: 30, bottom: 26, width: 70, height: 70, borderRadius: 35, background: BLUE, color: "white", fontSize: 32, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 14px 34px rgba(10,132,255,0.45)" }}>💬</div>}
        {/* Widget */}
        {f >= openAt && (
          <div style={{ position: "absolute", right: 26, bottom: 22, width: 390, height: 560, borderRadius: 22, background: "white", boxShadow: "0 30px 80px rgba(0,0,0,0.25)", overflow: "hidden", display: "flex", flexDirection: "column", opacity: widget, transform: `translateY(${(1 - widget) * 40}px) scale(${0.94 + 0.06 * widget})`, transformOrigin: "bottom right" }}>
            <div style={{ background: `linear-gradient(135deg, ${BLUE}, #0B4FB3)`, color: "white", padding: "16px 18px", display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 42, height: 42, borderRadius: 21, background: "white", color: BLUE, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center" }}>N</div>
              <div>
                <div style={{ fontSize: 19, fontWeight: 700 }}>Nova Phones</div>
                <div style={{ fontSize: 14, opacity: 0.85 }}>● Online · replies instantly</div>
              </div>
            </div>
            <div style={{ flex: 1, padding: 14, display: "flex", flexDirection: "column", gap: 10, justifyContent: "flex-end", overflow: "hidden" }}>
              <Bubble t={openAt + 6}>Hi! 👋 How can we help you today?</Bubble>
              {f >= qSent && <Bubble me t={qSent}>{q}</Bubble>}
              {f >= dotsA && f < botA && (
                <div style={{ alignSelf: "flex-start", background: "#F0F1F5", borderRadius: 16, padding: "12px 16px", display: "flex", gap: 6 }}>
                  {[0, 1, 2].map((d) => <div key={d} style={{ width: 9, height: 9, borderRadius: 5, background: "#9A9AA0", transform: `translateY(${Math.sin((f + d * 5) / 3) * 3}px)` }} />)}
                </div>
              )}
              {f >= botA && <Bubble t={botA}>{typeIn(bot, f, botA, botB)}</Bubble>}
              {f >= rSent && <Bubble me t={rSent}>{r}</Bubble>}
              {f >= thanksAt && <Bubble t={thanksAt}>Thanks Claudine! Patrick will call you shortly. 📞</Bubble>}
            </div>
            <div style={{ borderTop: `1px solid ${C.line}`, padding: 12, display: "flex", gap: 10, alignItems: "center" }}>
              <div style={{ flex: 1, height: 44, borderRadius: 22, background: "#F5F5F7", display: "flex", alignItems: "center", padding: "0 14px", fontSize: 16, color: input ? C.text : "#9A9AA0", overflow: "hidden", whiteSpace: "nowrap" }}>{input || "Type a message…"}</div>
              <div style={{ width: 44, height: 44, borderRadius: 22, background: BLUE, color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>➤</div>
            </div>
            <div style={{ textAlign: "center", fontSize: 12, color: C.muted, paddingBottom: 8 }}>Powered by BuPulse</div>
          </div>
        )}
        {/* Leads row */}
        {f >= leadAt && (
          <div style={{ position: "absolute", left: 26, bottom: 24, width: 640, opacity: lead, transform: `translateY(${(1 - lead) * 40}px)` }}>
            <Glass pad={18} radius={20} style={{ background: "white" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <Mark size={26} />
                <div style={{ fontSize: 19, fontWeight: 700 }}>BuPulse · Leads</div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1.1fr 1.3fr 1.1fr auto", alignItems: "center", gap: 10, fontSize: 18, padding: "12px 12px", borderRadius: 12, background: "rgba(47,107,255,0.07)" }}>
                <span style={{ fontWeight: 700 }}>Claudine</span>
                <span>078 334 9021</span>
                <span style={{ color: C.muted }}>Samsung A56</span>
                <Badge tone="blue" style={{ fontSize: 15 }}>New</Badge>
              </div>
            </Glass>
          </div>
        )}
      </BrowserFrame>
      {/* Patrick's phone */}
      {f >= phoneAt && phone > 0.01 && (
        <div style={{ position: "absolute", left: 360, top: 70, opacity: phone, transform: `translateY(${(1 - phone) * 120}px) rotate(${-4 * phone}deg)`, zIndex: 20 }}>
          <PhoneFrame width={300}>
            <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, #1B2B44, #0E1626)", padding: "64px 14px 0" }}>
              <div style={{ textAlign: "center", color: "white", fontSize: 54, fontWeight: 300 }}>10:24</div>
              <div style={{ textAlign: "center", color: "rgba(255,255,255,0.7)", fontSize: 15, marginBottom: 18 }}>Tuesday 14 October</div>
              <div style={{ background: "rgba(255,255,255,0.92)", borderRadius: 18, padding: 12, display: "flex", gap: 10, transform: `scale(${0.9 + 0.1 * phone})` }}>
                <div style={{ width: 38, height: 38, borderRadius: 10, background: "#25D366", color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>💬</div>
                <div style={{ fontSize: 14, lineHeight: 1.3 }}>
                  <div style={{ fontWeight: 700 }}>BuPulse · New lead</div>
                  <div>Claudine · 078 334 9021</div>
                  <div style={{ color: C.muted }}>Interested in: Samsung A56</div>
                </div>
              </div>
            </div>
          </PhoneFrame>
        </div>
      )}
      <Cursor path={[[0, 900, 740], [openAt, 1035, 700, true], [qSent - 4, 1040, 682, true], [rTypeA, 1000, 700], [rSent - 2, 1040, 682, true], [rSent + 30, 1060, 740]]} />
      <Sfx name="click" at={openAt} />
      <Sfx name="typing" at={qTypeA} volume={0.3} />
      <Sfx name="ping" at={botA} volume={0.3} />
      <Sfx name="typing" at={rTypeA} volume={0.3} />
      <Sfx name="buzz" at={phoneAt} />
      <Sfx name="ping" at={phoneAt + 6} />
      <Sfx name="chime" at={leadAt} volume={0.35} />
    </SceneLayout>
  );
};

/* ---------------------------------------------------------------- Managed */

export const Managed: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = useScene();
  const A = (p: number) => at(s, p);
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const posts: { d: number; title: string; time: string; who: string }[] = [
    { d: 0, title: "Galaxy A56 arrival", time: "09:00", who: "Diane" },
    { d: 1, title: "Charger deal", time: "18:00", who: "Diane" },
    { d: 3, title: "iPhone 16 reel script", time: "12:30", who: "Jean" },
    { d: 4, title: "Customer of the week", time: "17:00", who: "Diane" },
    { d: 6, title: "Sunday offer", time: "10:00", who: "Grace" },
  ];
  const colW = 142;
  const ready = Math.min(5, Math.floor(prog(f, A(0.15), A(0.6) - A(0.15)) * 5 + (f >= A(0.15) ? 1 : 0)));
  return (
    <SceneLayout eyebrow="Managed by BuPulse" title={<>Our team runs <Grad>your pages</Grad></>}>
      <BrowserFrame url="bupulse.com/dashboard/calendar" width={W} height={H}>
        <div style={{ padding: "24px 30px", display: "flex", alignItems: "center", gap: 14, ...rise(f, 0) }}>
          <div>
            <div style={{ fontSize: 30, fontWeight: 700 }}>Calendar</div>
            <div style={{ fontSize: 18, color: C.muted }}>13–19 October</div>
          </div>
          <Badge tone="violet" style={{ marginLeft: 20, fontSize: 17 }}>✦ Managed by BuPulse</Badge>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center" }}>
            {[["Diane U", "#7B5CFF"], ["Jean K", "#2F6BFF"], ["Grace M", "#0F7A4A"]].map(([n, c], i) => (
              <div key={n} style={{ marginLeft: i ? -12 : 0, border: "3px solid white", borderRadius: "50%", transform: `scale(${pop(f, fps, 6 + i * 4)})` }}><Avatar name={n} size={46} color={c} /></div>
            ))}
            <div style={{ marginLeft: 12, fontSize: 18, color: C.muted }}>Your BuPulse team</div>
          </div>
        </div>
        <div style={{ position: "absolute", left: 30, right: 30, top: 118, height: 60, borderRadius: 16, background: C.gradient, color: "white", display: "flex", alignItems: "center", padding: "0 22px", fontSize: 22, fontWeight: 700, ...rise(f, A(0.1)) }}>
          This week: {ready} post{ready === 1 ? "" : "s"} ready · nothing for you to do
        </div>
        {days.map((d, i) => (
          <div key={d} style={{ position: "absolute", left: 30 + i * (colW + 6), top: 196, width: colW, height: 490, borderRadius: 14, background: i === 1 ? "rgba(47,107,255,0.05)" : "#FAFAFC", border: `1px solid ${C.line}` }}>
            <div style={{ textAlign: "center", fontSize: 18, fontWeight: 700, padding: "10px 0", color: C.muted }}>{d} {13 + i}</div>
          </div>
        ))}
        {posts.map((p, i) => {
          const t = A(0.15) + i * Math.round((A(0.6) - A(0.15)) / 5);
          const a = pop(f, fps, t, 14);
          if (f < t) return null;
          return (
            <div key={p.title} style={{ position: "absolute", left: 34 + p.d * (colW + 6), top: 250 + (i % 2) * 150, width: colW - 8, opacity: a, transform: `translateY(${(1 - a) * 20}px)` }}>
              <div style={{ borderRadius: 12, background: "white", boxShadow: "0 8px 22px rgba(0,0,0,0.08)", padding: 10, borderLeft: `4px solid ${BLUE}` }}>
                <div style={{ fontSize: 15, color: C.muted, fontWeight: 600 }}>{p.time}</div>
                <div style={{ fontSize: 16, fontWeight: 700, lineHeight: 1.2, margin: "2px 0 6px" }}>{p.title}</div>
                <div style={{ fontSize: 14, color: "#5B3FD9", fontWeight: 700, lineHeight: 1.25 }}>✦ BuPulse team · {p.who}</div>
              </div>
            </div>
          );
        })}
        <Callout at={A(0.7)} x={300} y={600} tone="dark">💬 Diane: "New charger photos added to your gallery."</Callout>
      </BrowserFrame>
      <Sfx name="ping" at={A(0.7)} volume={0.3} />
    </SceneLayout>
  );
};

/* ---------------------------------------------------------------- ComingSoon */

export const ComingSoon: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = useScene();
  const A = (p: number) => at(s, p);
  const storeA = A(0.0), adsA = A(0.48);
  const reach = prog(f, adsA + 30, 40);
  const Soon: React.FC = () => <Badge tone="warn" style={{ fontSize: 16 }}>⏳ Coming soon</Badge>;
  const panel = (start: number): React.CSSProperties => {
    const a = pop(f, fps, start, 16);
    return { width: 530, height: H, opacity: a, transform: `translateY(${(1 - a) * 40}px)` };
  };
  return (
    <SceneLayout eyebrow="Coming soon" title={<>Your store and <Grad>your ads</Grad></>} text="We're building these next.">
      <div style={{ width: W, height: H, display: "flex", gap: 40 }}>
        <div style={panel(storeA)}>
          <Glass pad={24} style={{ height: "100%", display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontSize: 26, fontWeight: 700 }}>🛍️ Online store</div>
              <Soon />
            </div>
            <div style={{ fontSize: 18, color: C.muted }}>Built from your products in one click.</div>
            <div style={{ flex: 1, borderRadius: 18, border: `1px solid ${C.line}`, background: "white", overflow: "hidden" }}>
              <div style={{ padding: "12px 16px", borderBottom: `1px solid ${C.line}`, display: "flex", alignItems: "center" }}>
                <NovaLogo size={16} />
                <div style={{ marginLeft: "auto", fontSize: 16 }}>🛒 2</div>
              </div>
              <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
                {NOVA.products.map((p, i) => (
                  <div key={p.name} style={{ display: "flex", alignItems: "center", gap: 12, padding: 10, borderRadius: 14, background: "#F7F8FB", ...rise(f, storeA + 12 + i * 8, 16, 12) }}>
                    <div style={{ width: 84, height: 84, borderRadius: 14, background: "linear-gradient(160deg,#EAF2FF,#DCE6FF)", display: "flex", alignItems: "center", justifyContent: "center" }}>{i === 2 ? <span style={{ fontSize: 38 }}>🔌</span> : <PhoneGlyph w={32} />}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 18, fontWeight: 700 }}>{p.name}</div>
                      <div style={{ fontSize: 17, color: BLUE, fontWeight: 700 }}>{p.price}</div>
                    </div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: "white", background: BLUE, borderRadius: 999, padding: "8px 12px" }}>Add</div>
                  </div>
                ))}
                <div style={{ display: "flex", justifyContent: "center", gap: 10, marginTop: 6, flexWrap: "wrap" }}>
                  <Badge tone="neutral" style={{ fontSize: 16 }}>🌐 novaphones.rw</Badge>
                  <Badge tone="success" style={{ fontSize: 16 }}>✓ Mobile Money</Badge>
                  <Badge tone="blue" style={{ fontSize: 16 }}>✓ Card</Badge>
                </div>
              </div>
            </div>
            <Button style={{ width: "100%" }}>Publish store</Button>
          </Glass>
        </div>
        <div style={panel(adsA)}>
          <Glass pad={24} style={{ height: "100%", display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontSize: 26, fontWeight: 700 }}>📣 Ads manager</div>
              <Soon />
            </div>
            <div style={{ fontSize: 18, color: C.muted }}>Promote a product in a few clicks.</div>
            <div style={{ borderRadius: 18, background: `linear-gradient(140deg, ${BLUE}, #06204A)`, color: "white", padding: 18, display: "flex", alignItems: "center", gap: 16 }}>
              <PhoneGlyph w={44} tilt={-6} />
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, opacity: 0.8, letterSpacing: 1 }}>CAMPAIGN</div>
                <div style={{ fontSize: 24, fontWeight: 800 }}>Galaxy A56 launch</div>
                <div style={{ fontSize: 16, opacity: 0.85 }}>Instagram + Facebook</div>
              </div>
            </div>
            {[["Budget", "20,000 RWF"], ["Audience", "Kigali · 18–45"], ["Duration", "7 days"]].map(([k, v], i) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 20, padding: "12px 14px", borderRadius: 14, background: "#F7F8FB", ...rise(f, adsA + 10 + i * 6, 14, 12) }}>
                <span style={{ color: C.muted }}>{k}</span><span style={{ fontWeight: 700 }}>{v}</span>
              </div>
            ))}
            <div style={{ ...rise(f, adsA + 30, 14, 12) }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 18 }}>
                <span style={{ color: C.muted }}>Estimated reach</span>
                <span style={{ fontWeight: 800 }}>{fmt(Math.round((12000 * reach) / 100) * 100)}–{fmt(Math.round((18000 * reach) / 100) * 100)} people</span>
              </div>
              <div style={{ height: 12, borderRadius: 6, background: "rgba(47,107,255,0.12)", marginTop: 10, overflow: "hidden" }}>
                <div style={{ width: `${70 * reach}%`, height: "100%", background: C.gradient, borderRadius: 6 }} />
              </div>
            </div>
            <Button style={{ width: "100%", marginTop: "auto" }}>Launch campaign</Button>
          </Glass>
        </div>
      </div>
      <Sfx name="whoosh" at={storeA + 2} volume={0.25} />
      <Sfx name="whoosh" at={adsA} volume={0.25} />
    </SceneLayout>
  );
};

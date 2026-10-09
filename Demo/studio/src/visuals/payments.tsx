// Payment scenes: choosing a method, Mobile Money (manual approval), card (Paddle), renewals and reminders.
// Everything draws on the 1100x760 canvas inside SceneLayout. The Mobile Money look is generic on purpose (no operator brands).
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { rwf } from "../config";
import { BIZ, OWNER, PLAN_PRICE } from "../data";
import { at, lineStart, useScene } from "../scene-context";
import { C, fontFamily } from "../theme";
import { prog, pop, rise, typed } from "../ui/motion";
import { Avatar, Badge, BrowserFrame, Button, Callout, Cursor, Glass, PhoneFrame } from "../ui/primitives";
import { Grad, SceneLayout } from "../ui/SceneLayout";
import { Sfx } from "../ui/Sfx";

const MOMO = { header: "#2B2F3A", accent: "#3A7D6B", ref: "BP-7K3Q", txn: "MP251009.1432.C81274" };

// ---------- small shared pieces ----------

/** A check mark that draws itself inside a circle. */
const Check: React.FC<{ start: number; size?: number; color?: string }> = ({ start, size = 96, color = C.success }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = pop(f, fps, start, 12);
  const draw = prog(f, start + 6, 16);
  return (
    <div style={{ width: size, height: size, borderRadius: size / 2, background: color, transform: `scale(${s})`, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: `0 0 ${40 * s}px ${color}55` }}>
      <svg width={size * 0.55} height={size * 0.55} viewBox="0 0 24 24">
        <path d="M4 12.5l5 5L20 6.5" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="30" strokeDashoffset={30 * (1 - draw)} />
      </svg>
    </div>
  );
};

/** Read-only form field. */
const Field: React.FC<{ label: string; value: string; focus?: boolean; mono?: boolean; caret?: boolean; style?: React.CSSProperties }> = ({ label, value, focus, mono, caret, style }) => {
  const f = useCurrentFrame();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, ...style }}>
      <div style={{ fontSize: 17, fontWeight: 600, color: C.muted }}>{label}</div>
      <div style={{ height: 56, borderRadius: 14, border: `1.5px solid ${focus ? C.blue : C.line}`, boxShadow: focus ? "0 0 0 4px rgba(47,107,255,0.15)" : undefined, background: "white", display: "flex", alignItems: "center", padding: "0 18px", fontSize: 22, fontFamily: mono ? "ui-monospace, Menlo, monospace" : fontFamily, letterSpacing: mono ? 0.5 : 0 }}>
        {value}
        {caret && focus && Math.floor(f / 15) % 2 === 0 && <span style={{ width: 2, height: 26, background: C.blue, marginLeft: 2 }} />}
      </div>
    </div>
  );
};

const Row: React.FC<{ k: string; v: React.ReactNode; big?: boolean }> = ({ k, v, big }) => (
  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 0", borderBottom: `1px solid ${C.line}` }}>
    <span style={{ fontSize: 19, color: C.muted }}>{k}</span>
    <span style={{ fontSize: big ? 30 : 21, fontWeight: 700 }}>{v}</span>
  </div>
);

const planFor = (arg: string) => (arg === "card" || arg === "business" ? PLAN_PRICE.business : PLAN_PRICE.starter);
const bizFor = (arg: string) => (arg === "card" || arg === "business" ? BIZ.urugo : BIZ.inzu);
const usd = (n: number) => `$${n}`;
const approxRwf = (usd: number) => `≈ ${Math.round((usd * 1450) / 100) * 100 > 0 ? (Math.round((usd * 1450) / 100) * 100).toLocaleString("en-US") : 0} RWF`;

/** A wallet-app screen inside a phone: header plus content. Neutral colours, no operator brand. */
const Wallet: React.FC<{ title: string; children: React.ReactNode; dark?: boolean }> = ({ title, children }) => (
  <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", fontFamily, background: "#F4F5F7" }}>
    <div style={{ background: MOMO.header, color: "white", padding: "58px 22px 18px", display: "flex", alignItems: "center", gap: 12 }}>
      <div style={{ width: 34, height: 34, borderRadius: 10, background: MOMO.accent, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 800 }}>₣</div>
      <div>
        <div style={{ fontSize: 13, opacity: 0.7 }}>Mobile Money</div>
        <div style={{ fontSize: 19, fontWeight: 700 }}>{title}</div>
      </div>
    </div>
    <div style={{ flex: 1, padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>{children}</div>
  </div>
);

const WRow: React.FC<{ k: string; v: string; hi?: boolean }> = ({ k, v, hi }) => (
  <div style={{ background: "white", borderRadius: 14, padding: "12px 14px", border: `1.5px solid ${hi ? MOMO.accent : "#E3E5EA"}` }}>
    <div style={{ fontSize: 13, color: C.muted }}>{k}</div>
    <div style={{ fontSize: 20, fontWeight: 700, marginTop: 2 }}>{v}</div>
  </div>
);

// ---------- PayMethod ----------

export const PayMethod: React.FC = () => {
  const s = useScene();
  const f = useCurrentFrame();
  const card = s.arg === "card";
  const plan = planFor(s.arg);
  const biz = bizFor(s.arg);
  const pick = at(s, 0.5);
  const picked = f >= pick;
  const cont = at(s, 0.85);
  const opt = (kind: "momo" | "card", y: number) => {
    const chosen = picked && (kind === "card") === card;
    return (
      <div style={{ position: "absolute", left: 560, top: y, width: 500, height: 170, borderRadius: 22, background: "white", border: `2px solid ${chosen ? C.blue : C.line}`, boxShadow: chosen ? "0 0 0 6px rgba(47,107,255,0.14), 0 20px 50px rgba(47,107,255,0.18)" : "0 8px 24px rgba(0,0,0,0.04)", padding: 24, display: "flex", gap: 20, alignItems: "center", ...rise(f, kind === "momo" ? 14 : 20) }}>
        <div style={{ width: 64, height: 64, borderRadius: 18, background: kind === "momo" ? MOMO.header : C.gradient, color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 30 }}>{kind === "momo" ? "📲" : "💳"}</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{kind === "momo" ? "Mobile Money" : "Card"}</div>
          <div style={{ fontSize: 17, color: C.muted, marginTop: 4 }}>{kind === "momo" ? "MoMo or Airtel Money · we confirm in minutes" : "Visa or Mastercard · renews automatically"}</div>
          <div style={{ fontSize: 26, fontWeight: 700, marginTop: 8 }}>
            {kind === "momo" ? rwf(plan.rwf) : `${usd(plan.usd)} / month`}
            {kind === "card" && <span style={{ fontSize: 17, color: C.muted, fontWeight: 500 }}> {approxRwf(plan.usd)}</span>}
          </div>
        </div>
        <div style={{ width: 30, height: 30, borderRadius: 15, border: `2px solid ${chosen ? C.blue : C.line}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
          {chosen && <div style={{ width: 16, height: 16, borderRadius: 8, background: C.blue }} />}
        </div>
      </div>
    );
  };
  const target = card ? 400 : 200;
  return (
    <SceneLayout eyebrow={`${biz.name} · ${plan.name}`} title={card ? <>Pay by <Grad>card</Grad></> : <>Pay with <Grad>Mobile Money</Grad></>} text={card ? "Charged in dollars, renews every month by itself." : "No card needed. Pay from your phone."}>
      <BrowserFrame url="bupulse.com/dashboard/billing" width={1100} height={760}>
        <div style={{ position: "absolute", inset: 0, background: "#FAFAFC", fontFamily }} />
        <div style={{ position: "absolute", left: 36, top: 36, fontSize: 30, fontWeight: 700, ...rise(f, 2) }}>Choose how to pay</div>
        <Glass style={{ position: "absolute", left: 36, top: 100, width: 470, ...rise(f, 6) }} pad={28}>
          <Badge tone="violet">{plan.name} plan</Badge>
          <div style={{ fontSize: 44, fontWeight: 800, marginTop: 14, letterSpacing: -1 }}>{rwf(plan.rwf)}</div>
          <div style={{ fontSize: 18, color: C.muted }}>per month · Rwanda price</div>
          <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 10, fontSize: 19 }}>
            {[`${plan.texts} AI texts a month`, `${plan.designs} branded designs`, "Calendar, scheduling, gallery", `${plan.users} ${plan.users > 1 ? "users" : "user"}`].map((t) => (
              <div key={t} style={{ display: "flex", gap: 10 }}><span style={{ color: C.success }}>✓</span>{t}</div>
            ))}
          </div>
        </Glass>
        {opt("momo", 100)}
        {opt("card", 300)}
        <div style={{ position: "absolute", left: 560, top: 500, width: 500, ...rise(f, 26) }}>
          <Button pressed={f >= cont && f < cont + 6} style={{ width: "100%", height: 62, fontSize: 22 }}>Continue →</Button>
        </div>
      </BrowserFrame>
      <Cursor path={[[0, 900, 720], [pick - 14, 900, target + 52 + 60], [pick, 900, target + 52 + 60, true], [cont - 12, 820, 552 + 52 + 30], [cont, 820, 552 + 52 + 30, true]]} />
      <Sfx name="click" at={pick} />
      <Sfx name="click" at={cont} />
      <Callout at={pick + 8} x={60} y={640}>{card ? "Includes card costs · Mobile Money is cheaper" : "No card needed"}</Callout>
    </SceneLayout>
  );
};

// ---------- MomoPay ----------

export const MomoPay: React.FC = () => {
  const s = useScene();
  const f = useCurrentFrame();
  const plan = planFor(s.arg);
  const l1 = lineStart(s, 1) || at(s, 0.55);
  const end = Math.max(l1 + 60, s.voiceEnd);
  // Phone steps across the second line.
  const span = end - l1;
  const step = f < l1 ? -1 : Math.min(5, Math.floor(((f - l1) / span) * 6));
  const stepStart = (i: number) => l1 + (span * i) / 6;
  const highlight = (i: number) => f >= 10 + i * 14;
  const steps = ["Open Mobile Money on your phone", `Choose Pay merchant · code ${OWNER.momoPayCode}`, `Pay ${rwf(plan.rwf)} · reference ${MOMO.ref}`];
  return (
    <SceneLayout eyebrow="Step 2 · Pay" title={<>Pay from <Grad>your phone</Grad></>} text="Code, amount and reference are on the screen.">
      <BrowserFrame url="bupulse.com/dashboard/billing/pay" width={680} height={760}>
        <div style={{ position: "absolute", inset: 0, background: "#FAFAFC", padding: 30, fontFamily, display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ fontSize: 28, fontWeight: 700, ...rise(f, 2) }}>Pay with Mobile Money</div>
          <Glass pad={22} style={rise(f, 6)}>
            <Row k="Amount" v={rwf(plan.rwf)} big />
            <Row k="MoMo Pay code" v={<span style={{ color: highlight(1) ? C.blue : C.text }}>{OWNER.momoPayCode}</span>} />
            <Row k="Name" v={OWNER.momoName} />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 12 }}>
              <span style={{ fontSize: 19, color: C.muted }}>Reference</span>
              <span style={{ fontSize: 24, fontWeight: 800, color: C.blue, background: "rgba(47,107,255,0.1)", padding: "4px 12px", borderRadius: 10, letterSpacing: 1 }}>{MOMO.ref}</span>
            </div>
          </Glass>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {steps.map((t, i) => (
              <div key={t} style={{ display: "flex", gap: 14, alignItems: "center", fontSize: 20, ...rise(f, 10 + i * 14), padding: "10px 14px", borderRadius: 14, background: highlight(i) && f < 10 + (i + 1) * 14 + 10 ? "rgba(47,107,255,0.08)" : "transparent" }}>
                <div style={{ width: 34, height: 34, borderRadius: 17, background: C.gradient, color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 17, flexShrink: 0 }}>{i + 1}</div>
                {t}
              </div>
            ))}
          </div>
        </div>
      </BrowserFrame>
      <div style={{ position: "absolute", left: 730, top: 10, ...rise(f, l1 - 12, 60, 20) }}>
        <PhoneFrame width={360}>
          {step <= 0 && (
            <Wallet title="Pay">
              {["Send money", "Pay merchant", "Buy airtime", "My account"].map((t) => (
                <div key={t} style={{ background: t === "Pay merchant" ? MOMO.accent : "white", color: t === "Pay merchant" ? "white" : C.text, borderRadius: 14, padding: "16px 16px", fontSize: 19, fontWeight: 600, border: "1px solid #E3E5EA" }}>{t}</div>
              ))}
            </Wallet>
          )}
          {step >= 1 && step <= 3 && (
            <Wallet title="Pay merchant">
              <WRow k="Merchant code" v={typed(OWNER.momoPayCode, f, stepStart(1), 18)} hi={step === 1} />
              {step >= 2 && <WRow k="Amount (RWF)" v={typed(plan.rwf.toLocaleString("en-US"), f, stepStart(2), 18)} hi={step === 2} />}
              {step >= 3 && <WRow k="Reference" v={typed(MOMO.ref, f, stepStart(3), 18)} hi={step === 3} />}
              {step >= 2 && <div style={{ fontSize: 15, color: C.muted, padding: "0 4px" }}>To: {OWNER.momoName}</div>}
            </Wallet>
          )}
          {step === 4 && (
            <Wallet title="Confirm">
              <div style={{ fontSize: 17, color: C.muted, textAlign: "center", marginTop: 16 }}>Pay {rwf(plan.rwf)} to {OWNER.momoName}</div>
              <div style={{ fontSize: 18, fontWeight: 600, textAlign: "center", marginTop: 10 }}>Enter your PIN</div>
              <div style={{ display: "flex", justifyContent: "center", gap: 16, marginTop: 8 }}>
                {[0, 1, 2, 3, 4].map((i) => (
                  <div key={i} style={{ width: 18, height: 18, borderRadius: 9, background: f > stepStart(4) + i * 4 ? MOMO.header : "#D6D9DF" }} />
                ))}
              </div>
            </Wallet>
          )}
          {step === 5 && (
            <Wallet title="Done">
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, marginTop: 40 }}>
                <Check start={stepStart(5)} size={90} color={MOMO.accent} />
                <div style={{ fontSize: 23, fontWeight: 700 }}>Payment successful</div>
                <div style={{ fontSize: 17, color: C.muted, textAlign: "center" }}>{rwf(plan.rwf)} paid to {OWNER.momoName}<br />Ref {MOMO.ref}</div>
                <div style={{ fontSize: 14, color: C.muted, fontFamily: "ui-monospace, Menlo, monospace" }}>{MOMO.txn}</div>
              </div>
            </Wallet>
          )}
        </PhoneFrame>
      </div>
      <Sfx name="typing" at={stepStart(1)} volume={0.3} />
      <Sfx name="typing" at={stepStart(4)} volume={0.3} />
      <Sfx name="chime" at={stepStart(5)} volume={0.4} />
    </SceneLayout>
  );
};

// ---------- Waiting ----------

export const Waiting: React.FC = () => {
  const s = useScene();
  const f = useCurrentFrame();
  const plan = planFor(s.arg);
  const typeAt = at(s, 0.12);
  const click = at(s, 0.55);
  const waiting = f >= click + 6;
  const w = prog(f, click + 6, 18);
  return (
    <SceneLayout eyebrow="Step 3 · Confirm" title={<>Tap <Grad>“I've paid”</Grad></>} text="We check the payment and switch your plan on.">
      <BrowserFrame url="bupulse.com/dashboard/billing/pay" width={1100} height={760}>
        <div style={{ position: "absolute", inset: 0, background: "#FAFAFC", fontFamily }} />
        <div style={{ position: "absolute", left: 40, top: 36, fontSize: 30, fontWeight: 700 }}>Confirm your payment</div>
        <div style={{ position: "absolute", left: 40, top: 84, fontSize: 19, color: C.muted }}>{rwf(plan.rwf)} · reference {MOMO.ref}</div>
        <Glass style={{ position: "absolute", left: 40, top: 140, width: 560, opacity: 1 - w * 0.25 }} pad={30}>
          <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
            <Field label="Transaction ID (from the payment SMS)" value={typed(MOMO.txn, f, typeAt, 24)} focus={f >= typeAt && f < click} mono caret />
            <Field label="Phone number you paid from" value={BIZ.inzu.phone} />
            <Button pressed={f >= click && f < click + 6} style={{ height: 62, fontSize: 22 }}>I've paid</Button>
          </div>
        </Glass>
        {waiting && (
          <Glass style={{ position: "absolute", left: 640, top: 140, width: 420, transform: `scale(${0.9 + 0.1 * w})`, opacity: w, textAlign: "center" }} pad={34}>
            <div style={{ display: "flex", justifyContent: "center", marginBottom: 18 }}>
              <svg width="96" height="96" viewBox="0 0 50 50" style={{ transform: `rotate(${f * 6}deg)` }}>
                <circle cx="25" cy="25" r="20" fill="none" stroke="rgba(47,107,255,0.15)" strokeWidth="5" />
                <circle cx="25" cy="25" r="20" fill="none" stroke="url(#g)" strokeWidth="5" strokeLinecap="round" strokeDasharray="40 100" />
                <defs><linearGradient id="g"><stop offset="0" stopColor="#2F6BFF" /><stop offset="1" stopColor="#7B5CFF" /></linearGradient></defs>
              </svg>
            </div>
            <div style={{ fontSize: 28, fontWeight: 700 }}>Waiting for approval</div>
            <div style={{ fontSize: 20, color: C.muted, marginTop: 8 }}>Usually a few minutes</div>
            <div style={{ height: 8, borderRadius: 4, background: "rgba(47,107,255,0.12)", marginTop: 24, overflow: "hidden" }}>
              <div style={{ width: `${30 + 40 * prog(f, click + 10, 120)}%`, height: "100%", background: C.gradient }} />
            </div>
            <div style={{ fontSize: 17, color: C.muted, marginTop: 18 }}>We'll email you as soon as it's approved.</div>
          </Glass>
        )}
      </BrowserFrame>
      <Cursor path={[[0, 700, 700], [typeAt - 6, 320, 270], [typeAt, 320, 270, true], [click - 12, 320, 52 + 140 + 30 + 78 + 22 + 78 + 22 + 31], [click, 320, 52 + 140 + 30 + 78 + 22 + 78 + 22 + 31, true]]} />
      <Sfx name="click" at={typeAt} />
      <Sfx name="typing" at={typeAt + 2} volume={0.3} />
      <Sfx name="click" at={click} />
    </SceneLayout>
  );
};

// ---------- OwnerApprove ----------

export const OwnerApprove: React.FC = () => {
  const s = useScene();
  const f = useCurrentFrame();
  const plan = planFor(s.arg);
  const biz = bizFor(s.arg);
  const sms = 8;
  const mail = at(s, 0.22);
  const admin = at(s, 0.38);
  const approve = at(s, 0.78);
  const approved = f >= approve + 4;
  const shake = f >= sms - 4 && f < sms + 14 ? Math.sin(f * 2.4) * 6 : 0;
  return (
    <SceneLayout eyebrow="Our side" title={<>We check and <Grad>approve</Grad></>} text="Usually within minutes, every day.">
      <div style={{ position: "absolute", left: 0, top: 20, transform: `translateX(${shake}px) rotate(${shake * 0.2}deg)` }}>
        <PhoneFrame width={340} dark>
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(160deg,#1b1e2b,#2c2346)", fontFamily, color: "white" }}>
            <div style={{ textAlign: "center", marginTop: 70, fontSize: 64, fontWeight: 300 }}>14:32</div>
            <div style={{ textAlign: "center", fontSize: 16, opacity: 0.7 }}>Thursday 9 October</div>
            {f >= sms && (
              <div style={{ margin: "28px 14px 0", background: "rgba(255,255,255,0.92)", color: C.text, borderRadius: 20, padding: 14, ...rise(f, sms, -30, 14) }}>
                <div style={{ fontSize: 13, color: C.muted, display: "flex", justifyContent: "space-between" }}><span>💬 Messages · M-Money</span><span>now</span></div>
                <div style={{ fontSize: 15, marginTop: 6, lineHeight: 1.35 }}>You have received <b>{rwf(plan.rwf)}</b> from {biz.owner.toUpperCase()} ({biz.phone}). Ref: <b>{MOMO.ref}</b>. Balance: 1,284,500 RWF.</div>
              </div>
            )}
            {f >= mail && (
              <div style={{ margin: "12px 14px 0", background: "rgba(255,255,255,0.92)", color: C.text, borderRadius: 20, padding: 14, ...rise(f, mail, -30, 14) }}>
                <div style={{ fontSize: 13, color: C.muted, display: "flex", justifyContent: "space-between" }}><span>✉️ Mail · BuPulse</span><span>now</span></div>
                <div style={{ fontSize: 15, marginTop: 6, fontWeight: 700 }}>New MoMo payment to check</div>
                <div style={{ fontSize: 14, marginTop: 2 }}>{biz.name} · {rwf(plan.rwf)} · {MOMO.ref}</div>
              </div>
            )}
          </div>
        </PhoneFrame>
      </div>
      {f >= admin && (
        <div style={{ position: "absolute", left: 380, top: 110, ...rise(f, admin, 40, 18) }}>
          <BrowserFrame url="bupulse.com/admin/payments" width={720} height={540}>
            <div style={{ position: "absolute", inset: 0, background: "#FAFAFC", padding: 26, fontFamily }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ fontSize: 26, fontWeight: 700 }}>Payments</div>
                <Badge tone={approved ? "neutral" : "warn"}>{approved ? "0 waiting" : "1 waiting"}</Badge>
              </div>
              <div style={{ marginTop: 20, borderRadius: 18, border: `1.5px solid ${approved ? "rgba(15,122,74,0.4)" : C.line}`, background: approved ? "rgba(15,122,74,0.06)" : "white", padding: 20 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                  <Avatar name={biz.name} size={48} color={biz.colors[0]} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 21, fontWeight: 700 }}>{biz.name}</div>
                    <div style={{ fontSize: 16, color: C.muted }}>{plan.name} · 1 month · paid from {biz.phone}</div>
                  </div>
                  <div style={{ fontSize: 24, fontWeight: 800 }}>{rwf(plan.rwf)}</div>
                </div>
                <div style={{ display: "flex", gap: 24, marginTop: 16, fontSize: 16, color: C.muted }}>
                  <span>Ref <b style={{ color: C.text }}>{MOMO.ref}</b></span>
                  <span>Txn <b style={{ color: C.text, fontFamily: "ui-monospace, Menlo, monospace" }}>{MOMO.txn}</b></span>
                </div>
                <div style={{ display: "flex", gap: 12, marginTop: 18 }}>
                  {approved ? (
                    <Badge tone="success" style={{ fontSize: 19, padding: "10px 18px" }}>✓ Confirmed · plan switched on</Badge>
                  ) : (
                    <>
                      <Button pressed={f >= approve && f < approve + 6} style={{ height: 48, fontSize: 19, background: `linear-gradient(135deg, ${C.success}, #19a06a)`, boxShadow: "0 10px 26px rgba(15,122,74,0.3)" }}>Approve</Button>
                      <Button variant="outline" style={{ height: 48, fontSize: 19 }}>Reject</Button>
                    </>
                  )}
                </div>
              </div>
              <div style={{ marginTop: 16, fontSize: 15, color: C.muted }}>Check your Mobile Money SMS before you approve.</div>
            </div>
          </BrowserFrame>
        </div>
      )}
      {f >= admin && <Cursor path={[[admin, 1000, 700], [approve - 12, 380 + 26 + 20 + 70, 110 + 52 + 26 + 46 + 20 + 160], [approve, 380 + 26 + 20 + 70, 110 + 52 + 26 + 46 + 20 + 160, true]]} />}
      <Sfx name="buzz" at={sms - 4} volume={0.5} />
      <Sfx name="ping" at={sms} />
      <Sfx name="ping" at={mail} volume={0.35} />
      <Sfx name="click" at={approve} />
      <Sfx name="chime" at={approve + 4} />
    </SceneLayout>
  );
};

// ---------- PlanActive ----------

export const PlanActive: React.FC = () => {
  const s = useScene();
  const f = useCurrentFrame();
  const card = s.arg === "card";
  const plan = planFor(s.arg);
  const biz = bizFor(s.arg);
  const glow = 0.5 + 0.5 * Math.sin(f / 10);
  return (
    <SceneLayout eyebrow={biz.name} title={<>You're <Grad>ready</Grad></>} text={card ? "No waiting: card payments switch on at once." : "Approved. Time to create."}>
      <div style={{ position: "absolute", left: 150, top: 60, width: 800, height: 640, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ position: "absolute", width: 560, height: 560, borderRadius: 280, background: "radial-gradient(circle, rgba(15,122,74,0.18), rgba(15,122,74,0) 70%)", transform: `scale(${0.9 + 0.1 * glow})` }} />
        <Glass style={{ width: 640, textAlign: "center", ...rise(f, 0, 30, 16) }} pad={44}>
          <div style={{ display: "flex", justifyContent: "center" }}><Check start={6} size={110} /></div>
          <div style={{ fontSize: 40, fontWeight: 800, marginTop: 24, letterSpacing: -1, ...rise(f, 14) }}>{card ? `${plan.name} plan active` : `Your ${plan.name} plan is active`}</div>
          <div style={{ fontSize: 21, color: C.muted, marginTop: 10, ...rise(f, 18) }}>
            {card ? `Paid by card · ${usd(plan.usd)} · renews automatically on 9 Nov` : `Paid with Mobile Money · ${rwf(plan.rwf)} · until 9 Nov`}
          </div>
          <div style={{ display: "flex", justifyContent: "center", gap: 12, marginTop: 26, flexWrap: "wrap", ...rise(f, 24) }}>
            <Badge tone="blue" style={{ fontSize: 18, padding: "8px 14px" }}>{plan.texts} AI texts</Badge>
            <Badge tone="violet" style={{ fontSize: 18, padding: "8px 14px" }}>{plan.designs} designs</Badge>
            <Badge tone="success" style={{ fontSize: 18, padding: "8px 14px" }}>{plan.users} {plan.users > 1 ? "users" : "user"}</Badge>
          </div>
          <div style={{ marginTop: 30, ...rise(f, 30) }}><Button style={{ height: 60, fontSize: 22, padding: "0 36px" }}>Start creating →</Button></div>
        </Glass>
      </div>
      <Sfx name="chime" at={6} />
    </SceneLayout>
  );
};

// ---------- QuickPay (Business montage) ----------

export const QuickPay: React.FC = () => {
  const s = useScene();
  const f = useCurrentFrame();
  const plan = planFor(s.arg || "business");
  const biz = BIZ.urugo;
  const t = [4, at(s, 0.3), at(s, 0.6), at(s, 0.82)];
  const cards: { icon: React.ReactNode; title: string; sub: string }[] = [
    { icon: "📦", title: "Business plan", sub: `${rwf(plan.rwf)} / month` },
    { icon: "📲", title: "Paid with MoMo", sub: `Ref ${MOMO.ref}` },
    { icon: "🛡️", title: "Approved", sub: "Checked by BuPulse" },
    { icon: "✅", title: "Plan active", sub: `${plan.texts} texts · ${plan.designs} designs · ${plan.users} users` },
  ];
  const line = interpolate(f, [t[0], t[3]], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <SceneLayout eyebrow={biz.name} title={<>Business plan, <Grad>paid in minutes</Grad></>} text={`${rwf(plan.rwf)} a month with Mobile Money.`}>
      <div style={{ position: "absolute", left: 70, top: 120, width: 4, height: 520, background: "rgba(47,107,255,0.12)", borderRadius: 2 }}>
        <div style={{ width: "100%", height: `${line * 100}%`, background: C.gradient, borderRadius: 2 }} />
      </div>
      {cards.map((c, i) => {
        const done = f >= t[i];
        return (
          <div key={c.title} style={{ position: "absolute", left: 40, top: 90 + i * 150, display: "flex", alignItems: "center", gap: 30, ...rise(f, t[i], 30, 16) }}>
            <div style={{ width: 64, height: 64, borderRadius: 32, background: done ? (i === 3 ? C.success : C.gradient) : "#ddd", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 30, boxShadow: "0 10px 30px rgba(47,107,255,0.25)" }}>{c.icon}</div>
            <Glass pad={22} style={{ width: 800, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontSize: 28, fontWeight: 700 }}>{c.title}</div>
                <div style={{ fontSize: 19, color: C.muted, marginTop: 4 }}>{c.sub}</div>
              </div>
              {i === 3 && <Check start={t[3] + 4} size={64} />}
            </Glass>
          </div>
        );
      })}
      <Sfx name="click" at={t[0]} />
      <Sfx name="ping" at={t[1]} />
      <Sfx name="click" at={t[2]} />
      <Sfx name="chime" at={t[3] + 4} />
    </SceneLayout>
  );
};

// ---------- CardCheckout ----------

export const CardCheckout: React.FC = () => {
  const s = useScene();
  const f = useCurrentFrame();
  const plan = PLAN_PRICE.business;
  const biz = BIZ.urugo;
  const typeAt = at(s, 0.08);
  const pay = at(s, 0.66);
  const done = f >= pay + 8;
  const d = prog(f, pay + 8, 16);
  const card = typed("4242 4242 4242 4242", f, typeAt, 34);
  const exp = typed("12 / 28", f, typeAt + 22, 20);
  const cvc = "•••".slice(0, Math.max(0, Math.floor((f - typeAt - 34) / 4)));
  return (
    <SceneLayout eyebrow={`${biz.name} · Business`} title={<>Secure <Grad>card checkout</Grad></>} text="Price in dollars, shown next to francs.">
      <BrowserFrame url="bupulse.com/dashboard/billing" width={1100} height={760}>
        <div style={{ position: "absolute", inset: 0, background: "rgba(11,11,15,0.35)", fontFamily }} />
        <div style={{ position: "absolute", left: 90, top: 40, width: 920, height: 600, borderRadius: 26, background: "white", boxShadow: "0 40px 100px rgba(0,0,0,0.25)", display: "flex", overflow: "hidden", fontFamily, ...rise(f, 0, 30, 14) }}>
          <div style={{ width: 360, background: "#F6F7FB", padding: 32, display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ fontSize: 18, color: C.muted }}>BuPulse</div>
            <div style={{ fontSize: 28, fontWeight: 800 }}>Business plan</div>
            <div style={{ fontSize: 48, fontWeight: 800, letterSpacing: -1 }}>{usd(plan.usd)}<span style={{ fontSize: 20, color: C.muted, fontWeight: 500 }}> / month</span></div>
            <div style={{ fontSize: 18, color: C.muted, lineHeight: 1.4 }}>≈ {rwf(plan.rwf)} + card costs</div>
            <div style={{ height: 1, background: C.line, margin: "8px 0" }} />
            <div style={{ fontSize: 18 }}>✓ Renews every month</div>
            <div style={{ fontSize: 18 }}>✓ Receipt by email</div>
            <div style={{ fontSize: 18 }}>✓ Cancel any time</div>
          </div>
          <div style={{ flex: 1, padding: 34, position: "relative" }}>
            <div style={{ opacity: 1 - d, display: "flex", flexDirection: "column", gap: 18 }}>
              <Field label="Email" value="eric@urugohomes.rw" />
              <Field label="Card number" value={card || " "} focus={f >= typeAt && f < typeAt + 22} mono caret />
              <div style={{ display: "flex", gap: 16 }}>
                <Field label="Expiry" value={exp || " "} focus={f >= typeAt + 22 && f < typeAt + 34} mono style={{ flex: 1 }} />
                <Field label="CVC" value={cvc || " "} focus={f >= typeAt + 34 && f < pay} mono style={{ flex: 1 }} />
              </div>
              <Button pressed={f >= pay && f < pay + 6} style={{ height: 60, fontSize: 22 }}>Pay {usd(plan.usd)}.00</Button>
              <div style={{ textAlign: "center", fontSize: 16, color: C.muted }}>🔒 Secure checkout by Paddle · BuPulse never sees your card number</div>
            </div>
            {done && (
              <div style={{ position: "absolute", inset: 0, background: "white", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 18, opacity: Math.min(1, d * 2) }}>
                <Check start={pay + 8} size={100} />
                <div style={{ fontSize: 32, fontWeight: 800 }}>Payment successful</div>
                <div style={{ fontSize: 19, color: C.muted }}>Visa •••• 4242 · {usd(plan.usd)}.00</div>
              </div>
            )}
          </div>
        </div>
      </BrowserFrame>
      <Cursor path={[[0, 900, 720], [typeAt - 4, 700, 52 + 40 + 34 + 78 + 18 + 40], [typeAt, 700, 52 + 40 + 34 + 78 + 18 + 40, true], [pay - 12, 700, 52 + 40 + 34 + 3 * 96 + 30 + 30], [pay, 700, 52 + 40 + 34 + 3 * 96 + 30 + 30, true]]} />
      <Sfx name="typing" at={typeAt} volume={0.3} />
      <Sfx name="click" at={pay} />
      <Sfx name="chime" at={pay + 8} />
    </SceneLayout>
  );
};

// ---------- Renewal ----------

export const Renewal: React.FC = () => {
  const s = useScene();
  const f = useCurrentFrame();
  const plan = PLAN_PRICE.business;
  const flip = at(s, 0.12);
  const fp = prog(f, flip, 16);
  const mail = at(s, 0.35);
  const bill = at(s, 0.55);
  const hi = at(s, 0.78);
  const month = fp < 0.5 ? "OCT" : "NOV";
  return (
    <SceneLayout eyebrow="Automatic renewal" title={<>Renews <Grad>by itself</Grad></>} text="Change your plan or cancel any time.">
      <Glass style={{ position: "absolute", left: 20, top: 40, width: 300, height: 300, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", ...rise(f, 0) }} pad={0}>
        <div style={{ width: 200, borderRadius: 24, overflow: "hidden", boxShadow: "0 20px 50px rgba(0,0,0,0.12)", transform: `perspective(600px) rotateX(${fp < 0.5 ? fp * 180 : (1 - fp) * 180}deg)` }}>
          <div style={{ background: C.gradient, color: "white", textAlign: "center", fontSize: 26, fontWeight: 700, padding: 10, letterSpacing: 3 }}>{month}</div>
          <div style={{ background: "white", textAlign: "center", fontSize: 96, fontWeight: 800, padding: "6px 0 14px" }}>9</div>
        </div>
        <Badge tone="success" style={{ marginTop: 22, fontSize: 18, opacity: fp }}>✓ Renewed automatically</Badge>
      </Glass>
      {f >= mail && (
        <Glass style={{ position: "absolute", left: 20, top: 380, width: 300, ...rise(f, mail, 30) }} pad={22}>
          <div style={{ fontSize: 15, color: C.muted }}>✉️ Email · receipts@bupulse.com</div>
          <div style={{ fontSize: 21, fontWeight: 700, marginTop: 8 }}>Your receipt</div>
          <div style={{ fontSize: 17, marginTop: 6 }}>BuPulse Business · {usd(plan.usd)}.00</div>
          <Badge tone="success" style={{ marginTop: 10 }}>Paid · 9 Nov</Badge>
        </Glass>
      )}
      {f >= bill && (
        <div style={{ position: "absolute", left: 360, top: 40, ...rise(f, bill, 40) }}>
          <BrowserFrame url="bupulse.com/dashboard/billing" width={740} height={640}>
            <div style={{ position: "absolute", inset: 0, background: "#FAFAFC", padding: 28, fontFamily, display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ fontSize: 28, fontWeight: 700 }}>Billing</div>
              <Glass pad={22}>
                <Row k="Plan" v="Business" />
                <Row k="Payment method" v="Visa •••• 4242" />
                <Row k="Next renewal" v={`9 Dec · ${usd(plan.usd)}`} />
              </Glass>
              <div style={{ fontSize: 19, fontWeight: 700, marginTop: 4 }}>Receipts</div>
              {["9 Nov 2026", "9 Oct 2026"].map((d) => (
                <div key={d} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 18, padding: "10px 16px", background: "white", borderRadius: 14, border: `1px solid ${C.line}` }}>
                  <span>{d}</span><span>{usd(plan.usd)}.00</span><Badge tone="success">Paid</Badge><span style={{ color: C.blue }}>PDF</span>
                </div>
              ))}
              <div style={{ display: "flex", gap: 14, marginTop: 6 }}>
                <Button style={{ boxShadow: f >= hi ? "0 0 0 6px rgba(47,107,255,0.2)" : undefined }}>Change plan</Button>
                <Button variant="outline" style={{ boxShadow: f >= hi + 10 ? "0 0 0 6px rgba(47,107,255,0.2)" : undefined }}>Cancel anytime</Button>
              </div>
            </div>
          </BrowserFrame>
        </div>
      )}
      <Sfx name="whoosh" at={flip} volume={0.35} />
      <Sfx name="ping" at={mail} volume={0.35} />
    </SceneLayout>
  );
};

// ---------- SwitchMethod ----------

export const SwitchMethod: React.FC = () => {
  const s = useScene();
  const f = useCurrentFrame();
  const click = at(s, 0.35);
  const on = f >= click;
  const x = prog(f, click, 12);
  return (
    <SceneLayout eyebrow="Your choice" title={<>Switch to <Grad>Mobile Money</Grad></>} text="From the next renewal.">
      <BrowserFrame url="bupulse.com/dashboard/billing" width={1100} height={760}>
        <div style={{ position: "absolute", inset: 0, background: "#FAFAFC", padding: 40, fontFamily }}>
          <div style={{ fontSize: 30, fontWeight: 700 }}>Payment method</div>
          <div style={{ marginTop: 26, width: 640, height: 76, borderRadius: 38, background: "rgba(0,0,0,0.05)", position: "relative", display: "flex" }}>
            <div style={{ position: "absolute", top: 6, left: 6 + x * 314, width: 314, height: 64, borderRadius: 32, background: "white", boxShadow: "0 6px 20px rgba(0,0,0,0.1)" }} />
            {["💳  Card", "📲  Mobile Money"].map((t, i) => (
              <div key={t} style={{ position: "relative", flex: 1, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 23, fontWeight: 600, color: (i === 1) === on ? C.text : C.muted }}>{t}</div>
            ))}
          </div>
          {on && (
            <Glass style={{ marginTop: 30, width: 640, ...rise(f, click + 4) }} pad={26}>
              <div style={{ fontSize: 22, fontWeight: 700 }}>Next renewal: pay with Mobile Money</div>
              <div style={{ fontSize: 19, color: C.muted, marginTop: 8, lineHeight: 1.45 }}>From 9 Nov you pay {rwf(PLAN_PRICE.business.rwf)} with MoMo or Airtel Money. Your card won't be charged again.</div>
              <Badge tone="success" style={{ marginTop: 14 }}>✓ Saved</Badge>
            </Glass>
          )}
          <Glass style={{ marginTop: 24, width: 640, ...rise(f, 6) }} pad={22}>
            <Row k="Plan" v="Business" />
            <Row k="This month" v={on ? "Card · paid until 9 Nov" : "Card · renews 9 Nov"} />
            <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 12 }}>
              <span style={{ fontSize: 19, color: C.muted }}>Next payment</span>
              <span style={{ fontSize: 21, fontWeight: 700 }}>{on ? `${rwf(PLAN_PRICE.business.rwf)} · Mobile Money` : `${usd(PLAN_PRICE.business.usd)} · card`}</span>
            </div>
          </Glass>
        </div>
      </BrowserFrame>
      <Cursor path={[[0, 800, 700], [click - 12, 40 + 480, 52 + 40 + 26 + 76 + 38 - 38], [click, 40 + 480, 52 + 40 + 64 + 38, true]]} />
      <Sfx name="click" at={click} />
    </SceneLayout>
  );
};

// ---------- Reminder ----------

export const Reminder: React.FC = () => {
  const s = useScene();
  const f = useCurrentFrame();
  const plan = PLAN_PRICE.business;
  const mail = 6;
  const wa = at(s, 0.35);
  return (
    <SceneLayout eyebrow="Before the month ends" title={<>A friendly <Grad>reminder</Grad></>} text="By email and on WhatsApp. No surprises.">
      <Glass style={{ position: "absolute", left: 0, top: 120, width: 560, ...rise(f, mail, 30) }} pad={30}>
        <div style={{ fontSize: 16, color: C.muted }}>✉️ hello@bupulse.com · to Eric</div>
        <div style={{ fontSize: 28, fontWeight: 800, marginTop: 12, lineHeight: 1.2 }}>Your Business plan renews in 5 days</div>
        <div style={{ fontSize: 20, color: C.muted, marginTop: 10, lineHeight: 1.4 }}>{rwf(plan.rwf)} for November. Pay with Mobile Money any time before 9 Nov.</div>
        <div style={{ display: "flex", gap: 12, marginTop: 20 }}>
          <Button>Pay now</Button>
          <Badge tone="warn" style={{ alignSelf: "center" }}>Due 9 Nov</Badge>
        </div>
      </Glass>
      <div style={{ position: "absolute", left: 640, top: 0, ...rise(f, wa - 8, 60, 18) }}>
        <PhoneFrame width={360}>
          <div style={{ position: "absolute", inset: 0, background: "#ECE5DD", fontFamily }}>
            <div style={{ background: "#1F7A5C", color: "white", padding: "56px 18px 14px", display: "flex", alignItems: "center", gap: 12 }}>
              <Avatar name="Bu Pulse" size={40} color="#2F6BFF" />
              <div><div style={{ fontSize: 19, fontWeight: 700 }}>BuPulse</div><div style={{ fontSize: 13, opacity: 0.8 }}>Business account</div></div>
            </div>
            {f >= wa && (
              <div style={{ margin: "22px 16px", background: "white", borderRadius: "4px 18px 18px 18px", padding: 16, boxShadow: "0 2px 4px rgba(0,0,0,0.08)", ...rise(f, wa, 20, 12) }}>
                <div style={{ fontSize: 17, lineHeight: 1.45 }}>Hi Eric 👋 Your BuPulse <b>Business</b> plan renews in <b>5 days</b> · {rwf(plan.rwf)}.</div>
                <div style={{ fontSize: 17, color: "#1F7A5C", fontWeight: 700, marginTop: 10 }}>Pay now → bupulse.com/pay</div>
                <div style={{ fontSize: 12, color: C.muted, textAlign: "right", marginTop: 6 }}>09:00 ✓✓</div>
              </div>
            )}
          </div>
        </PhoneFrame>
      </div>
      <Sfx name="ping" at={mail} volume={0.35} />
      <Sfx name="ping" at={wa} />
    </SceneLayout>
  );
};

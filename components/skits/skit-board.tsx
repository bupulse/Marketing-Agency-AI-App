"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Clapperboard, Mic, Square, Upload } from "lucide-react";
import { Badge, Button, GlassCard, useToast } from "@/components/ui";
import { orderExtraSkitAction } from "@/app/dashboard/skits/actions";
import { EXTRA_SKIT_PRICE_RWF, STATUS_TEXT, VOICE_ACCEPT, VOICE_MAX_SECONDS, checkVoice } from "@/lib/skits/shared";
import type { SkitCard } from "@/lib/skits/service";
import { toWav, useSkitRecorder } from "./voice-note";

export type SkitPlanInfo = { perWeek: number; daysText: string; nextDay: string | null; today: string; canRecord: boolean; /** What an extra skit costs the client, with VAT when it applies (lib/billing/vat.ts). Absent: the price before VAT. */ extraPrice?: { minor: number; vatIncluded: boolean } };

const rwf = (n: number) => `${n.toLocaleString("en-US")} RWF`;

function dayText(day: string, today: string): string {
  if (day === today) return "Today";
  const d = new Date(`${day}T12:00:00Z`);
  return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
}

/**
 * "Talking skits" on the Posts page: each open skit as a card. "Record your skit" shows the lines to read, one recorder
 * per speaker (record in the browser, or pick a WhatsApp voice note); then "Voice received — video coming soon" until
 * the video is made and becomes a post to approve. Below: the plan's skit days and "Order an extra skit".
 */
export function SkitBoard({ cards, plan }: { cards: SkitCard[]; plan: SkitPlanInfo }) {
  const router = useRouter();
  const { toast } = useToast();
  const [ordering, startOrder] = useTransition();
  const [ordered, setOrdered] = useState(false);

  const order = () =>
    startOrder(async () => {
      const res = await orderExtraSkitAction().catch(() => null);
      if (!res) return toast("We lost the connection. Check your internet and try again.", "error");
      if (!res.ok) return toast(res.error, "error");
      setOrdered(true);
      toast("Extra skit requested. BuPulse will call you to confirm it.", "success");
      router.refresh();
    });

  return (
    <section id="skits" aria-labelledby="skits-heading" className="flex scroll-mt-24 flex-col gap-4">
      <div className="flex flex-col gap-1 px-1">
        <h2 id="skits-heading" className="text-xl font-semibold tracking-[-0.02em]">
          Talking skits
        </h2>
        <p className="text-[15px] text-muted">
          {plan.perWeek > 0
            ? `${plan.perWeek} short skits a week, on ${plan.daysText}. BuPulse writes the lines; you record them with your own voice, and BuPulse makes the video.`
            : "Short videos of people talking, made from your own voice."}
        </p>
      </div>

      {cards.length > 0 ? (
        <ul className="grid gap-4 lg:grid-cols-2" aria-label="Skits">
          {cards.map((card) => (
            <li key={card.id}>
              <SkitCardView card={card} today={plan.today} canRecord={plan.canRecord} />
            </li>
          ))}
        </ul>
      ) : (
        plan.perWeek > 0 && (
          <GlassCard className="px-5 py-6 text-[15px] text-muted">
            {plan.nextDay ? `Your next skit comes ${plan.nextDay === plan.today ? "today" : `on ${dayText(plan.nextDay, plan.today)}`}. You get a message when it is ready to record.` : "No skit to record right now."}
          </GlassCard>
        )
      )}

      {plan.canRecord && (
        <div className="flex flex-wrap items-center gap-3 px-1">
          <Button size="sm" variant="outline" leading={<Clapperboard aria-hidden className="size-4" />} disabled={ordering || ordered} onClick={order}>
            {ordering ? "Sending…" : `Order an extra skit — ${rwf(plan.extraPrice?.minor ?? EXTRA_SKIT_PRICE_RWF)}${plan.extraPrice?.vatIncluded ? " (VAT included)" : ""}`}
          </Button>
          <span className="text-[13px] text-muted">BuPulse calls you to confirm and take the payment.</span>
        </div>
      )}
    </section>
  );
}

function SkitCardView({ card, today, canRecord }: { card: SkitCard; today: string; canRecord: boolean }) {
  const waiting = card.status === "WAITING_VOICE";
  const tone = card.status === "FAILED" ? "danger" : card.status === "WAITING_VOICE" ? "blue" : card.status === "ORDERED" ? "violet" : "success";
  if (card.status === "ORDERED") {
    return (
      <GlassCard className="flex flex-col gap-2 p-5">
        <Badge tone={tone}>Extra skit</Badge>
        <p className="text-[15px]">{STATUS_TEXT.ORDERED}</p>
      </GlassCard>
    );
  }
  return (
    <GlassCard className="flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={tone}>{STATUS_TEXT[card.status]}</Badge>
        <span className="text-[13px] text-muted">
          {dayText(card.plannedDay, today)} · {card.language}
          {card.extra ? " · extra" : ""}
          {card.carryCount > 0 ? ` · moved ${card.carryCount === 1 ? "once" : `${card.carryCount} times`}` : ""}
        </span>
      </div>
      {card.title && <h3 className="text-[17px] font-semibold tracking-[-0.01em]">{card.title}</h3>}

      <ol className="flex flex-col gap-2" aria-label="The lines">
        {card.lines.map((line, i) => (
          <li key={i} className="rounded-xl bg-soft px-3 py-2 text-[15px]">
            <span className="mr-2 font-semibold">{card.speakers[line.speaker - 1]?.name ?? `Person ${line.speaker}`}:</span>
            <span lang={card.language === "Kinyarwanda" ? "rw" : undefined}>{line.text}</span>
          </li>
        ))}
      </ol>

      {waiting && canRecord && (
        <div className="flex flex-col gap-3">
          <p className="text-[13px] text-muted">
            {card.speakers.length === 1
              ? `Read the lines aloud, at most ${VOICE_MAX_SECONDS} seconds. A quiet place is best.`
              : `One voice note per person: each one reads only their own lines, at most ${VOICE_MAX_SECONDS} seconds. Ask a friend or a colleague to read the other part.`}
          </p>
          {card.speakers.map((s, i) => (
            <SpeakerRecorder key={i} skitId={card.id} speaker={i + 1} name={s.name} lines={card.lines.filter((l) => l.speaker === i + 1).map((l) => l.text)} hasVoice={s.hasVoice} />
          ))}
        </div>
      )}
      {card.status === "VOICE_RECEIVED" && <p className="text-[15px] text-muted">Thank you. Your video is made from your voice and shows in Posts to approve.</p>}
      {card.status === "FAILED" && card.error && <p className="text-[13px] text-muted">{card.error}</p>}
    </GlassCard>
  );
}

function SpeakerRecorder({ skitId, speaker, name, lines, hasVoice }: { skitId: string; speaker: number; name: string; lines: string[]; hasVoice: boolean }) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(hasVoice);
  const fileInput = useRef<HTMLInputElement>(null);

  async function send(source: Blob, name: string) {
    setBusy(true);
    try {
      const file = await toWav(source, name);
      const check = checkVoice({ type: file.blob.type, size: file.blob.size, name: file.name });
      if (!check.ok) return toast(check.error, "error");
      const form = new FormData();
      form.set("skitId", skitId);
      form.set("speaker", String(speaker));
      form.set("file", file.blob, file.name);
      const res = await fetch("/api/skits/voice", { method: "POST", body: form }).catch(() => null);
      const body = (await res?.json().catch(() => null)) as { ok?: boolean; error?: string; missing?: number[] } | null;
      if (!res || !body) return toast("We lost the connection. Check your internet and try again.", "error");
      if (!res.ok || !body.ok) return toast(body.error ?? "We could not save the recording. Try again.", "error");
      setDone(true);
      toast(body.missing?.length ? "Saved. Now record the other voice." : "Voice received. BuPulse makes the video from it.", "success");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const recorder = useSkitRecorder((blob, mime) => void send(blob, `skit-${speaker}.${mime.includes("mp4") ? "m4a" : "webm"}`));
  const recording = recorder.state === "recording";

  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-line p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{name}</span>
        {done && (
          <span className="inline-flex items-center gap-1 text-[13px] text-success">
            <Check aria-hidden className="size-4" /> Recorded
          </span>
        )}
      </div>
      {lines.length > 0 && <p className="text-[13px] text-muted">Reads: {lines.map((l) => `“${l}”`).join(" ")}</p>}
      <div className="flex flex-wrap items-center gap-2">
        {recorder.supported && (
          <Button
            size="sm"
            variant={recording ? "primary" : "outline"}
            leading={recording ? <Square aria-hidden className="size-4" /> : <Mic aria-hidden className="size-4" />}
            disabled={busy}
            onClick={() => (recording ? recorder.stop() : void recorder.start())}
            aria-label={recording ? `Stop recording ${name}` : `Record ${name}`}
          >
            {recording ? `Stop (${Math.floor(recorder.elapsed)} s of ${VOICE_MAX_SECONDS})` : done ? "Record again" : "Record"}
          </Button>
        )}
        <Button size="sm" variant="ghost" leading={<Upload aria-hidden className="size-4" />} disabled={busy || recording} onClick={() => fileInput.current?.click()}>
          {busy ? "Saving…" : "Send a voice note"}
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept={VOICE_ACCEPT}
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void send(file, file.name);
          }}
        />
      </div>
      {recorder.state === "blocked" && <p className="text-[13px] text-danger">The microphone is blocked. Allow it in your browser, or send a voice note from your phone instead.</p>}
    </div>
  );
}

# The ad's sound: voice lines placed on the timeline (robot voice where asked), music with its built drop (Lyria
# ignores timing, so an intro track plays until the drop and the main track starts on its first strong beat), music
# ducked under every word (hard rule 7), and synthesised sound effects (no sound files to license). numpy + ffmpeg.
import math
import os
import subprocess
import wave

import numpy as np

from .core import ffmpeg_bin

SR = 48000


def decode(path, start=0.0, dur=None, filters=None):
    """Mono float32 samples at 48 kHz from any file ffmpeg reads (an MP4's sound, an MP3, a WAV)."""
    cmd = [ffmpeg_bin(), "-v", "error", "-ss", "%.3f" % max(0.0, start)]
    if dur is not None:
        cmd += ["-t", "%.3f" % max(0.01, dur)]
    cmd += ["-i", path, "-vn", "-ac", "1", "-ar", str(SR)]
    if filters:
        cmd += ["-af", filters]
    cmd += ["-f", "f32le", "-"]
    out = subprocess.run(cmd, check=True, capture_output=True).stdout
    return np.frombuffer(out, dtype=np.float32).copy()


def db(x):
    return 10 ** (x / 20.0)


def fade_edges(a, ms=15):
    n = min(len(a) // 2, int(SR * ms / 1000))
    if n > 0:
        ramp = np.linspace(0, 1, n, dtype=np.float32)
        a[:n] *= ramp
        a[-n:] *= ramp[::-1]
    return a


def level(a, rms_target=0.1):
    """Brings a voice line to a steady loudness (RMS of the loud parts), so no line is lost under another."""
    if len(a) == 0:
        return a
    frame = int(SR * 0.05)
    n = len(a) // frame
    if n == 0:
        return a
    rms = np.sqrt(np.mean(a[: n * frame].reshape(n, frame) ** 2, axis=1))
    loud = rms[rms > np.max(rms) * 0.3]
    cur = float(np.mean(loud)) if len(loud) else float(np.sqrt(np.mean(a ** 2)) or 1)
    return a * min(8.0, rms_target / max(1e-5, cur))


ROBOT = "asetrate=48000*0.88,aresample=48000,afftfilt=real='hypot(re,im)*sin(0)':imag='hypot(re,im)*cos(0)':win_size=512:overlap=0.75,aecho=0.8:0.6:35:0.35"


def place(track, a, at):
    i = int(round(at * SR))
    if i >= len(track) or len(a) == 0:
        return
    if i < 0:
        a = a[-i:]
        i = 0
    n = min(len(a), len(track) - i)
    track[i:i + n] += a[:n]


# ---- Sound effects (synthesised, deterministic) ----------------------------------------------------------------------
def _lowpass(x, cut):
    """One-pole low-pass with a cutoff per sample (Hz), for sweeps."""
    y = np.zeros_like(x)
    prev = 0.0
    cut = np.broadcast_to(np.asarray(cut, dtype=np.float32), x.shape)
    alpha = 1 - np.exp(-2 * np.pi * cut / SR)
    for i in range(len(x)):
        prev += alpha[i] * (x[i] - prev)
        y[i] = prev
    return y


def _env(n, attack=0.1, peak=0.5):
    t = np.linspace(0, 1, n, dtype=np.float32)
    up = np.clip(t / max(1e-3, peak), 0, 1) ** max(0.2, attack * 10)
    down = np.clip((1 - t) / max(1e-3, 1 - peak), 0, 1) ** 2
    return np.minimum(up, down)


def sfx(kind, seed=1):
    rng = np.random.default_rng(seed)
    if kind == "whoosh":
        n = int(SR * 0.38)
        t = np.linspace(0, 1, n, dtype=np.float32)
        cut = 400 + 4200 * np.sin(np.pi * t) ** 2
        return 0.9 * _lowpass(rng.normal(0, 1, n).astype(np.float32), cut) * _env(n, peak=0.6)
    if kind == "boom":
        n = int(SR * 0.9)
        t = np.arange(n, dtype=np.float32) / SR
        f = 38 + 50 * np.exp(-t * 9)
        body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 4.2)
        click = _lowpass(rng.normal(0, 1, n).astype(np.float32), 1800) * np.exp(-t * 60)
        return np.tanh(1.6 * (body + 0.8 * click)).astype(np.float32)
    if kind == "glitch":
        out = []
        for _ in range(9):
            m = int(SR * rng.uniform(0.01, 0.035))
            f = rng.uniform(180, 2400)
            sq = np.sign(np.sin(2 * np.pi * f * np.arange(m) / SR)).astype(np.float32)
            crushed = np.round(rng.normal(0, 1, m) * 3) / 3
            out.append((0.5 * sq + 0.4 * crushed).astype(np.float32) * rng.uniform(0.3, 0.9))
            out.append(np.zeros(int(SR * rng.uniform(0.0, 0.015)), dtype=np.float32))
        return np.concatenate(out) * 0.7
    if kind == "scratch":
        n = int(SR * 0.42)
        t = np.arange(n, dtype=np.float32) / SR
        f = 300 + 900 * np.abs(np.sin(2 * np.pi * 7 * t))
        saw = 2 * ((np.cumsum(f) / SR) % 1) - 1
        noise = _lowpass(rng.normal(0, 1, n).astype(np.float32), 2500 + 2000 * np.sin(2 * np.pi * 9 * t))
        return (0.5 * saw + 0.6 * noise).astype(np.float32) * _env(n, peak=0.15)
    if kind == "rewind":
        n = int(SR * 0.8)
        t = np.arange(n, dtype=np.float32) / SR
        f = 1800 * np.exp(-t * 2.2) * (1 + 0.25 * np.sin(2 * np.pi * 23 * t))
        saw = 2 * ((np.cumsum(f) / SR) % 1) - 1
        return (0.45 * saw + 0.25 * rng.normal(0, 1, n)).astype(np.float32) * _env(n, peak=0.1)
    if kind == "typewriter":
        n = int(SR * 1.2)
        out = np.zeros(n, dtype=np.float32)
        for i in range(int(1.2 * 18)):
            m = int(SR * 0.02)
            tt = np.arange(m) / SR
            click = (rng.normal(0, 1, m) * np.exp(-tt * 400) + 0.5 * np.sin(2 * np.pi * 2600 * tt) * np.exp(-tt * 300)).astype(np.float32)
            place_at = int(i / 18 * SR + rng.uniform(0, 0.012) * SR)
            out[place_at:place_at + m] += click[: max(0, min(m, n - place_at))] * rng.uniform(0.5, 1)
        return out * 0.6
    if kind == "click":
        m = int(SR * 0.06)
        tt = np.arange(m, dtype=np.float32) / SR
        return (0.7 * np.sin(2 * np.pi * 2100 * tt) * np.exp(-tt * 120) + 0.3 * rng.normal(0, 1, m) * np.exp(-tt * 500)).astype(np.float32)
    if kind == "crash":
        n = int(SR * 1.1)
        t = np.arange(n, dtype=np.float32) / SR
        burst = rng.normal(0, 1, n).astype(np.float32) * np.exp(-t * 5)
        thump = np.sin(2 * np.pi * 55 * t) * np.exp(-t * 7)
        bits = np.zeros(n, dtype=np.float32)
        for _ in range(14):
            i = int(rng.uniform(0.05, 0.9) * n)
            m = int(SR * 0.015)
            bits[i:i + m] += rng.normal(0, 1, min(m, n - i)).astype(np.float32) * np.exp(-np.arange(min(m, n - i)) / 200)
        return np.tanh(0.8 * burst + thump + 0.5 * bits).astype(np.float32)
    if kind == "riser":
        n = int(SR * 1.5)
        t = np.arange(n, dtype=np.float32) / SR
        f = 200 * np.exp(t * 1.8)
        sweep = np.sin(2 * np.pi * np.cumsum(f) / SR)
        return ((0.4 * sweep + 0.4 * rng.normal(0, 1, n)) * (t / t[-1]) ** 2).astype(np.float32)
    return np.zeros(1, dtype=np.float32)


# ---- Music --------------------------------------------------------------------------------------------------------
def energy_envelope(a, hop=0.02):
    h = int(SR * hop)
    n = len(a) // h
    if n == 0:
        return np.zeros(1, dtype=np.float32)
    return np.sqrt(np.mean(a[: n * h].reshape(n, h) ** 2, axis=1))


def first_strong_beat(a, after=0.5):
    """Where the track's energy first reaches 60 % of its loud level (its beat really starts): the drop lands there."""
    env = energy_envelope(a)
    if len(env) < 10:
        return 0.0
    loud = np.percentile(env, 90)
    start = int(after / 0.02)
    hits = np.nonzero(env[start:] >= 0.6 * loud)[0]
    return float((hits[0] + start) * 0.02) if len(hits) else 0.0


def estimate_bpm(a):
    """Tempo from the onset envelope's autocorrelation, folded into 80-160 BPM."""
    env = energy_envelope(a, 0.01)
    if len(env) < 400:
        return 0.0
    onset = np.maximum(0, np.diff(env))
    onset = onset - onset.mean()
    ac = np.correlate(onset, onset, mode="full")[len(onset) - 1:]
    lo, hi = int(60 / 200 / 0.01), int(60 / 60 / 0.01)
    lag = lo + int(np.argmax(ac[lo:hi]))
    bpm = 60 / (lag * 0.01)
    while bpm < 80:
        bpm *= 2
    while bpm > 160:
        bpm /= 2
    return round(float(bpm), 1)


def duck_envelope(voice, total, base_db, duck_db):
    """Music gain per sample: base level, dipping duck_db under speech (40 ms attack, 300 ms release)."""
    hop = int(SR * 0.01)
    n = total // hop + 1
    v = np.zeros(n * hop, dtype=np.float32)
    v[: len(voice)] = np.abs(voice[: n * hop])
    rms = np.sqrt(np.mean(v.reshape(n, hop) ** 2, axis=1))
    speaking = (rms > 0.01).astype(np.float32)
    env = np.zeros(n, dtype=np.float32)
    a_att, a_rel = 1 - math.exp(-1 / 4), 1 - math.exp(-1 / 30)
    cur = 0.0
    for i in range(n):
        target = speaking[i]
        cur += (a_att if target > cur else a_rel) * (target - cur)
        env[i] = cur
    gain_db = base_db - duck_db * env
    g = np.repeat(db(gain_db).astype(np.float32), hop)[:total]
    return g


def mix(edl, files, out_wav, work_dir):
    total_s = float(edl["canvas"]["seconds"])
    total = int(total_s * SR)
    voice = np.zeros(total, dtype=np.float32)
    for v in edl.get("voice", []):
        path = files.get(v["asset"])
        if not path:
            continue
        robot = any(e["id"] == "robot_voice" for e in v.get("effects", []))
        a = decode(path, v["from"], v["to"] - v["from"], ROBOT if robot else None)
        place(voice, fade_edges(level(a)), v["at"])

    music = np.zeros(total, dtype=np.float32)
    m = edl.get("music")
    if m and files.get(m.get("asset", "")):
        drop = float(m.get("dropAt") or 0)
        main = decode(files[m["asset"]], float(m.get("mainOffset") or 0))
        need = total - int(drop * SR)
        if len(main) and len(main) < need:
            main = np.tile(main, int(math.ceil(need / len(main))))
        # Levelled to the voices' loudness, so gainDb and duckDb are relative to them.
        main = level(main, 0.1)
        place(music, main[:need], drop)
        if m.get("intro") and files.get(m["intro"]) and drop > 0:
            intro = level(decode(files[m["intro"]], 0, drop), 0.07)
            n = min(len(intro), int(0.15 * SR))
            if n:
                intro[-n:] *= np.linspace(1, 0, n, dtype=np.float32)
            place(music, intro, 0)
        tail = int(min(1.2, total_s * 0.1) * SR)
        music[-tail:] *= np.linspace(1, 0, tail, dtype=np.float32)
        music *= duck_envelope(voice, total, float(m.get("gainDb", -5)), float(m.get("duckDb", 11)))

    effects = np.zeros(total, dtype=np.float32)
    for i, s in enumerate(edl.get("sfx", [])):
        place(effects, sfx(s["kind"], seed=i + 1) * db(float(s.get("gainDb", -8))), float(s["at"]))

    # About 5 dB of make-up gain (social apps play loud), then a soft limiter above 0.8 so nothing clips.
    master = (voice + music + effects) * db(5)
    over = np.abs(master) > 0.8
    master[over] = np.sign(master[over]) * (0.8 + 0.19 * np.tanh((np.abs(master[over]) - 0.8) / 0.19))
    pcm = (np.clip(master, -1, 1) * 32767).astype(np.int16)
    stereo = np.repeat(pcm[:, None], 2, axis=1)
    with wave.open(out_wav, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(stereo.tobytes())
    # How loud the music sat under the voice, for the judge's "music too loud?" and the logs.
    speaking = np.abs(voice) > 0.02
    return {
        "voiceRms": float(np.sqrt(np.mean(voice[speaking] ** 2))) if speaking.any() else 0.0,
        "musicUnderVoiceRms": float(np.sqrt(np.mean(music[speaking] ** 2))) if speaking.any() else 0.0,
    }


def analyze_music(path):
    a = decode(path)
    return {"seconds": round(len(a) / SR, 3), "bpm": estimate_bpm(a), "firstBeat": round(first_strong_beat(a), 3)}


def exists(path):
    return bool(path) and os.path.isfile(path)

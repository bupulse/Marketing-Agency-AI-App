#!/usr/bin/env python3
# The Ad Brain's renderer (docs/AD_BRAIN.md, "Where the renderer runs"): EDL JSON -> frames -> FFmpeg (H.264 + AAC).
#
#   python render.py render <job.json> <out.mp4>      the whole ad; writes <out.mp4> and <out.mp4>.json (result)
#   python render.py frames <job.json> <dir> 1.2 6.5  single frames as JPEGs (checks, contact sheets)
#   python render.py analyze <music file>             {"seconds", "bpm", "firstBeat"} for the planner
#   python render.py selftest                         fonts, ffmpeg and the effect registry
#
# job.json: { "edl": <EDL>, "files": { "<asset key>": "<local path>" }, "logo": path|null, "host": "bupulse.com",
#             "workDir": "<folder for frames and the mix>" }
# The Node side (lib/ad-brain/render.ts) downloads the assets, writes job.json and runs this as a separate process, so
# a render never blocks the web server. Needs Python 3.9+, Pillow, numpy and ffmpeg (AD_RENDER_FFMPEG to point at it).
import json
import os
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


from adr import audio  # noqa: E402
from adr.core import FPS, H, W, Clips, bg_tech, ease, ffmpeg_bin, font_path, hex_rgb, load_fitted, load_image, zoom  # noqa: E402
from adr.fx import SCREEN, SEGMENT, TRANSITION, punch, rgb_split  # noqa: E402
from adr.text import TITLES, caption_groups, caption_words, end_card, float_card, karaoke, one_word  # noqa: E402

PICTURE_FX_ORDER = ["slow_push", "bounce_cam", "punch_in", "camera_shake", "night_grade", "scanlines", "tape_rewind", "freeze_frame", "rgb_split", "slice_glitch", "debris"]


class Ad:
    def __init__(self, job):
        self.edl = job["edl"]
        self.files = job["files"]
        self.logo = job.get("logo")
        self.host = job.get("host") or self.edl["brand"]["url"].replace("https://", "").replace("http://", "").strip("/")
        self.work = job["workDir"]
        os.makedirs(self.work, exist_ok=True)
        self.brand = hex_rgb(self.edl["brand"].get("primary", "#2f6bff"))
        self.segments = self.edl["segments"]
        self.assets = self.edl["assets"]
        self.clips = Clips(self.work)
        for s in self.segments:
            a = self.assets.get(s.get("asset") or "")
            if a and a["kind"] == "video":
                self.clips.prepare(s["asset"], self.path(s["asset"]))
        self.words = caption_words(self.edl)
        self.groups = caption_groups(self.words)
        self.screen_index = {}
        for s in self.segments:
            if s["source"] == "real_screen":
                self.screen_index[s["id"]] = len(self.screen_index)
        face = self.edl.get("endCard", {}).get("face")
        self.face = self.path(face) if face else None
        m = self.edl.get("music") or {}
        self.bpm = float(m.get("bpm") or 0)
        self.drop = float(m.get("dropAt") or 0)
        self.pulse = bool(m.get("beatPulse"))

    def path(self, key):
        p = self.files.get(key)
        if not p or not os.path.isfile(p):
            raise RuntimeError("The file for '%s' is missing." % key)
        return p

    def screen_image(self, key):
        a = self.assets[key]
        im = load_image(self.path(key))
        crop = a.get("crop")
        if crop:
            x0, y0, x1, y1 = crop
            im = im.crop((int(x0 * im.size[0]), int(y0 * im.size[1]), int(x1 * im.size[0]), int(y1 * im.size[1])))
        return im

    def segment_at(self, t):
        for s in self.segments:
            if s["start"] <= t < s["end"]:
                return s
        return self.segments[-1]

    def effect(self, seg, name):
        for e in seg.get("effects", []):
            if e["id"] == name:
                return e
        return None

    # The segment's own picture at time t (no transition), with its picture effects.
    def picture(self, seg, t, i):
        lt = max(0.0, t - seg["start"])
        dur = max(0.05, seg["end"] - seg["start"])
        src = seg["source"]
        if src == "real_screen":
            return self.screen(seg, t, lt / dur).convert("RGB")
        if src in ("end_card", "brand_card"):
            c = bg_tech(t, self.brand).convert("RGBA")
            end_card(c, lt / dur, self.edl["endCard"], self.brand, self.logo, self.face, self.host)
            return c.convert("RGB")
        freeze = self.effect(seg, "freeze_frame")
        if freeze:
            lt_pic = min(lt, float(freeze["params"].get("at", 0.3)) * dur * 0.2)
        else:
            lt_pic = lt
        if src == "ai_clip":
            im = self.clips.frame(seg["asset"], float(seg.get("clipOffset", 0)) + lt_pic)
        else:
            im = load_fitted(self.path(seg["asset"]))
            # Stills keep moving a little unless an effect moves them.
            if not any(self.effect(seg, n) for n in ("bounce_cam", "slow_push", "tape_rewind", "night_grade")):
                im = zoom(im, 1.0 + 0.05 * (lt_pic / dur), 0.5, 0.3)
        ctx = {"t": t, "lt": lt, "dur": dur, "k": lt / dur, "i": i, "seg": seg, "params": {}}
        for name in PICTURE_FX_ORDER:
            e = self.effect(seg, name)
            if e and name in SEGMENT:
                ctx["params"] = e.get("params", {})
                im = SEGMENT[name](im, ctx)
        return im

    def screen(self, seg, t, k):
        c = bg_tech(t, self.brand).convert("RGBA")
        im = self.screen_image(seg["asset"])
        tap = self.assets[seg["asset"]].get("tap") if self.effect(seg, "tap_ripple") else None
        names = [e["id"] for e in seg.get("effects", []) if e["id"] in ("browser_window", "filmed_monitor")]
        name = names[0] if names else "browser_window"
        params = (self.effect(seg, name) or {}).get("params", {})
        SCREEN[name](c, im, k, t, params, self.screen_index.get(seg["id"], 0), tap, self.host)
        punch_fx = self.effect(seg, "punch_in")
        out = c.convert("RGB")
        if punch_fx:
            lt = t - seg["start"]
            out = punch(out, lt / max(0.05, float(punch_fx["params"].get("seconds", 0.25))), float(punch_fx["params"].get("zoom", 1.08)))
        return out

    def frame(self, i):
        t = i / FPS
        seg = self.segment_at(t)
        idx = self.segments.index(seg)
        im = self.picture(seg, t, i)
        tr = seg.get("transitionIn")
        if tr and idx > 0 and tr["id"] in TRANSITION:
            p = (t - seg["start"]) / max(0.04, tr["seconds"])
            if p < 1:
                prev = self.segments[idx - 1]
                im = TRANSITION[tr["id"]](self.picture(prev, min(t, prev["end"] - 1e-3) if prev["source"] != "ai_clip" else t, i), im, p, tr.get("params", {}), i, self.brand)
        # A small pulse on every beat after the drop, and a punch with a split on each real screen cut.
        if seg["source"] == "real_screen" and self.pulse and self.bpm:
            k = (t - seg["start"])
            beat = ((t - self.drop) / (60.0 / self.bpm)) % 1
            if k < 0.12:
                im = rgb_split(punch(im, k / 0.12), 10 * (1 - k / 0.12))
            elif beat < 0.15:
                im = punch(im, 0.6 + beat * 2.6)
        c = im.convert("RGBA")
        lt = t - seg["start"]
        dur = seg["end"] - seg["start"]
        for n, o in enumerate(seg.get("overlays") or []):
            out = ease((lt - dur * 0.62) / 0.3)
            if out < 1:
                card = self.screen_image(o["asset"])
                kk = (lt - (0.25 + 0.6 * n)) / 0.35
                if n == 0:
                    float_card(c, card, o["label"], kk, 20 - int(out * 400), 250, 250, 6, -1, self.brand)
                else:
                    float_card(c, card, o["label"], kk, 440 + int(out * 400), 250, 250, -6, 1, self.brand)
        for ti in self.edl.get("titles", []):
            if ti["start"] <= t < ti["end"] and ti["style"] in TITLES:
                TITLES[ti["style"]](c, ti["text"], t - ti["start"], ti.get("y", 0.12) * H, self.brand)
        style = self.edl.get("captions", {}).get("style", "karaoke")
        y = self.edl.get("captions", {}).get("y", 0.7) * H
        if seg["source"] == "real_screen":
            y = 0.875 * H
        elif seg["source"] == "end_card":
            y = 0.78 * H
        if style == "karaoke":
            karaoke(c, self.groups, t, y, self.brand)
        elif style == "one_word":
            one_word(c, self.words, t, y, self.brand)
        return c.convert("RGB")


def render(job_path, out_path):
    started = time.time()
    job = json.load(open(job_path))
    ad = Ad(job)
    total = int(round(float(ad.edl["canvas"]["seconds"]) * FPS))
    wav = os.path.join(ad.work, "mix.wav")
    sound = audio.mix(ad.edl, ad.files, wav, ad.work)
    enc = subprocess.Popen(
        [ffmpeg_bin(), "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", "%dx%d" % (W, H), "-r", str(FPS), "-i", "-", "-i", wav,
         "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-shortest", "-movflags", "+faststart", out_path],
        stdin=subprocess.PIPE,
    )
    try:
        for i in range(total):
            enc.stdin.write(ad.frame(i).tobytes())
            if i % 48 == 0:
                print(json.dumps({"progress": round(i / total, 3)}), flush=True)
        enc.stdin.close()
    except BrokenPipeError:
        pass
    if enc.wait() != 0:
        raise RuntimeError("ffmpeg could not encode the ad.")
    result = {"ok": True, "seconds": total / FPS, "frames": total, "renderSeconds": round(time.time() - started, 1), "bytes": os.path.getsize(out_path), **sound}
    json.dump(result, open(out_path + ".json", "w"))
    print(json.dumps(result), flush=True)
    return result


def frames(job_path, out_dir, times):
    job = json.load(open(job_path))
    ad = Ad(job)
    os.makedirs(out_dir, exist_ok=True)
    for t in times:
        i = int(float(t) * FPS)
        ad.frame(i).save(os.path.join(out_dir, "f%05d.jpg" % i), quality=88)


def selftest():
    out = {"python": sys.version.split()[0], "fonts": {k: font_path(k) for k in ("black", "bold", "mono", "impact")}, "segment": sorted(SEGMENT), "transition": sorted(TRANSITION), "screen": sorted(SCREEN), "title": sorted(TITLES)}
    out["ffmpeg"] = subprocess.run([ffmpeg_bin(), "-version"], capture_output=True, text=True).stdout.split("\n")[0]
    print(json.dumps(out))


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    try:
        if cmd == "render":
            render(sys.argv[2], sys.argv[3])
        elif cmd == "frames":
            frames(sys.argv[2], sys.argv[3], sys.argv[4:])
        elif cmd == "analyze":
            print(json.dumps(audio.analyze_music(sys.argv[2])))
        elif cmd == "selftest":
            selftest()
        else:
            print(__doc__ or "usage: render.py render|frames|analyze|selftest", file=sys.stderr)
            sys.exit(2)
    except Exception as e:  # The Node side shows this line to the admin.
        print(json.dumps({"ok": False, "error": str(e)[:400]}), flush=True)
        sys.exit(1)



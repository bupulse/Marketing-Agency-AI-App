# The effects library's pictures (lib/ad-brain/effects.ts lists the same ids; tests/ad-brain/renderer-sync.test.ts
# checks both lists match). Each segment effect is fn(im, ctx) -> im, where ctx carries the segment's local time `lt`,
# its length `dur`, progress `k`, the frame index and the effect's params. Ported from the prototypes.
import math
import random

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageEnhance, ImageFilter, ImageOps

from .core import FPS, H, W, clamp, ease, font, rounded, shadow_of, white, zoom

SEGMENT = {}
TRANSITION = {}
SCREEN = {}


def segment_fx(name):
    def deco(fn):
        SEGMENT[name] = fn
        return fn
    return deco


def transition_fx(name):
    def deco(fn):
        TRANSITION[name] = fn
        return fn
    return deco


def screen_fx(name):
    def deco(fn):
        SCREEN[name] = fn
        return fn
    return deco


# ---- Building blocks ----------------------------------------------------------------------------------------------
def rgb_split(im, amt):
    if amt < 1:
        return im
    r, g, b = im.split()
    r = ImageChops.offset(r, -int(amt), 0)
    b = ImageChops.offset(b, int(amt), int(amt * 0.3))
    return Image.merge("RGB", (r, g, b))


def slices(im, strength, seed):
    if strength <= 0.01:
        return im
    rnd = random.Random(seed)
    out = im.copy()
    for _ in range(int(6 + strength * 14)):
        y = rnd.randint(0, H - 20)
        h = rnd.randint(6, 60)
        dx = int(rnd.uniform(-1, 1) * strength * 80)
        out.paste(im.crop((0, y, W, y + h)), (dx, y))
    return out


def scanlines(im, a=26):
    ov = Image.new("RGBA", im.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(ov)
    for y in range(0, H, 4):
        d.line((0, y, W, y), fill=(0, 10, 30, int(a)))
    o = im.convert("RGBA")
    o.alpha_composite(ov)
    return o.convert("RGB")


def shake(im, amp, t):
    if amp <= 0.3:
        return im
    return ImageChops.offset(zoom(im, 1 + amp / 250), int(math.sin(t * 97) * amp), int(math.cos(t * 83) * amp))


def punch(im, k, z=1.08):
    if k >= 1:
        return im
    return zoom(im, z - (z - 1) * ease(k))


def grain(im, amt, seed):
    if amt <= 0:
        return im
    rng = np.random.default_rng(seed)
    n = rng.normal(0, amt, (H // 2, W // 2)).astype(np.int16)
    n = np.kron(n, np.ones((2, 2), dtype=np.int16))
    a = np.asarray(im).astype(np.int16) + n[..., None]
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))


_VIGNETTE = {}


def vignette(im, s=0.55):
    if s <= 0:
        return im
    m = _VIGNETTE.get("mask")
    if m is None:
        m = Image.new("L", (W, H), 0)
        ImageDraw.Draw(m).ellipse((-W * 0.35, -H * 0.2, W * 1.35, H * 1.2), fill=255)
        m = m.filter(ImageFilter.GaussianBlur(160))
        _VIGNETTE["mask"] = m
    return Image.composite(im, ImageEnhance.Brightness(im).enhance(1 - s), m)


def night_grade(im):
    im = ImageEnhance.Color(im).enhance(0.6)
    return Image.blend(im, Image.new("RGB", im.size, (30, 60, 140)), 0.18)


def typewriter(c, text, t, y, speed=18, size=46):
    n = int(max(0, t) * speed)
    s = text[:n]
    if not s:
        return
    f = font("mono", size)
    d = ImageDraw.Draw(c)
    tw = d.textlength(text, font=f)
    while tw > W - 60 and size > 22:
        size -= 4
        f = font("mono", size)
        tw = d.textlength(text, font=f)
    x = (W - tw) / 2
    d.rectangle((x - 18, y - 10, x + tw + 18, y + f.size + 14), fill=(0, 0, 0))
    d.text((x, y), s + ("_" if n < len(text) and int(t * 6) % 2 == 0 else ""), font=f, fill=(255, 255, 255))


def debris(c, t, seed=7, n=34, top=170):
    rnd = random.Random(seed)
    d = ImageDraw.Draw(c)
    for _ in range(int(n)):
        x0 = rnd.uniform(160, 560)
        vx = rnd.uniform(-90, 90)
        vy0 = rnd.uniform(-40, 160)
        sz = rnd.uniform(5, 22)
        delay = rnd.uniform(0, 0.5)
        g = rnd.randint(205, 245)
        tt = t - delay
        if tt < 0:
            continue
        x = x0 + vx * tt
        y = top + vy0 * tt + 0.5 * 1500 * tt * tt
        if y > H:
            continue
        pts = [(x + sz * math.cos(a + tt * 3), y + sz * 0.7 * math.sin(a + tt * 3)) for a in (0, 2.1, 4.0)]
        d.polygon(pts, fill=(g, g - 4, g - 10))


# ---- Segment effects ------------------------------------------------------------------------------------------------
def fade(ctx, seconds):
    return max(0.0, 1 - ctx["lt"] / max(0.05, seconds))


@segment_fx("rgb_split")
def _rgb(im, ctx):
    p = ctx["params"]
    return rgb_split(im, float(p.get("amount", 12)) * fade(ctx, float(p.get("seconds", 0.3))))


@segment_fx("slice_glitch")
def _slices(im, ctx):
    p = ctx["params"]
    return slices(im, float(p.get("strength", 0.6)) * fade(ctx, float(p.get("seconds", 0.35))), ctx["i"])


@segment_fx("camera_shake")
def _shake(im, ctx):
    p = ctx["params"]
    return shake(im, float(p.get("amp", 12)) * fade(ctx, float(p.get("seconds", 0.5))), ctx["t"])


@segment_fx("punch_in")
def _punch(im, ctx):
    p = ctx["params"]
    return punch(im, ctx["lt"] / max(0.05, float(p.get("seconds", 0.3))), float(p.get("zoom", 1.08)))


@segment_fx("freeze_frame")
def _freeze(im, ctx):
    # The picture itself stops moving in render.py (frozen time); here: colour drains, grain, vignette, a flash.
    p = ctx["params"]
    fz = float(p.get("at", 0.3)) * ctx["dur"] * 0.2
    since = ctx["lt"] - fz
    if since < 0:
        return im
    k = ease(since / 0.25)
    g = ImageOps.grayscale(im).convert("RGB")
    out = Image.blend(im, g, float(p.get("drain", 0.75)) * k)
    out = grain(vignette(out, 0.45 * k), float(p.get("grain", 12)), ctx["i"])
    if since < 0.06:
        out = white(out, 0.7)
    return out


@segment_fx("tape_rewind")
def _rewind(im, ctx):
    p = ctx["params"]
    k = ctx["k"]
    base = zoom(im, 1.06 - 0.06 * k, 0.5, 0.2)
    streak = base
    for s in (10, 22, 34):
        streak = Image.blend(streak, ImageChops.offset(base, 0, -s), 0.35)
    out = grain(ImageEnhance.Contrast(streak).enhance(1.3), 18, ctx["i"]).convert("RGBA")
    d = ImageDraw.Draw(out)
    for y in range(int(k * 900) % 160, H, 160):
        d.rectangle((0, y, W, y + 6), fill=(255, 255, 255, 70))
    d.polygon([(40, 84), (64, 66), (64, 102)], fill=(255, 255, 255))
    d.polygon([(66, 84), (90, 66), (90, 102)], fill=(255, 255, 255))
    d.text((104, 60), "REWIND", font=font("mono", 46), fill=(255, 255, 255))
    typewriter(out, str(p.get("label", "EARLIER THAT DAY")).upper(), ctx["lt"] * 1.6, H // 2 - 40)
    hh = 3 - k * 3
    d.text((40, H - 110), "-%02d:%02d:%02d" % (int(hh), int((hh % 1) * 60), int(ctx["t"] * 97) % 60), font=font("mono", 30), fill=(255, 255, 255))
    return out.convert("RGB")


@segment_fx("night_grade")
def _night(im, ctx):
    p = ctx["params"]
    out = grain(vignette(night_grade(zoom(im, 1.0 + 0.05 * ctx["k"])), 0.35), 8, ctx["i"]).convert("RGBA")
    d = ImageDraw.Draw(out)
    d.text((W - 270, 70), str(p.get("stamp", "11:47 PM")), font=font("mono", 30), fill=(255, 255, 255))
    d.ellipse((W - 300, 78, W - 282, 96), fill=(255, 60, 60))
    return out.convert("RGB")


@segment_fx("scanlines")
def _scan(im, ctx):
    p = ctx["params"]
    out = ImageEnhance.Color(scanlines(im, float(p.get("alpha", 26)))).enhance(1 - float(p.get("desat", 0.2)))
    if ctx["i"] % 23 == 0:
        out = rgb_split(out, 10)
    return out


@segment_fx("debris")
def _debris(im, ctx):
    c = im.convert("RGBA")
    debris(c, ctx["lt"], seed=7 + len(ctx["seg"]["id"]), n=float(ctx["params"].get("count", 34)))
    return c.convert("RGB")


@segment_fx("bounce_cam")
def _bounce(im, ctx):
    p = ctx["params"]
    lt, dur = ctx["lt"], ctx["dur"]
    hold = dur * 0.8
    bounce = abs(math.sin(lt * math.pi * float(p.get("speed", 1.6)))) * float(p.get("height", 46)) if lt < hold else 0
    s = 1.08 + (0.0 if lt < hold else 0.9 * ease((lt - hold) / max(0.1, dur * 0.12)))
    out = ImageChops.offset(zoom(im, s, 0.5, 0.18 if lt >= hold else 0.5), 0, int(-bounce + 23))
    if lt > dur - 0.08:
        out = white(out, (lt - (dur - 0.08)) / 0.08)
    return out


@segment_fx("slow_push")
def _push(im, ctx):
    return zoom(im, 1 + (float(ctx["params"].get("zoom", 1.06)) - 1) * ctx["k"])


# ---- Transitions: fn(prev, cur, p, params, i) -> im, p 0..1 over the transition ------------------------------------
@transition_fx("cut")
def _cut(prev, cur, p, params, i, brand):
    return cur


@transition_fx("scan_wipe")
def _scan_wipe(prev, cur, p, params, i, brand):
    down = params.get("direction", "down") != "up"
    color = {"cyan": (90, 220, 255), "pink": (255, 120, 220)}.get(params.get("color", "cyan"), brand)
    g = ease(p)
    if down:
        y = int(g * H)
        im = prev.copy()
        if y > 0:
            im.paste(cur.crop((0, 0, W, y)), (0, 0))
    else:
        y = H - int(g * H)
        im = prev.copy()
        im.paste(cur.crop((0, y, W, H)), (0, y))
    s = math.sin(p * math.pi)
    im = slices(rgb_split(im, 18 * s + 4), 0.8 * s, i)
    c = im.convert("RGBA")
    d = ImageDraw.Draw(c)
    for k in range(14):
        yy = y - k if down else y + k
        d.line((0, yy, W, yy), fill=color + (max(0, 255 - k * 18),))
    return c.convert("RGB")


@transition_fx("white_flash")
def _flash(prev, cur, p, params, i, brand):
    return white(cur, 1 - p)


def _whip(a, b, p):
    off = int(ease(p) * W)
    comp = Image.new("RGB", (W, H))
    comp.paste(a, (-off, 0))
    comp.paste(b, (W - off, 0))
    half = Image.new("RGB", (W, H), (128, 128, 128))
    blur = comp
    for s in (18, 36, 54):
        blur = ImageChops.add(ImageChops.multiply(blur, half), ImageChops.multiply(ImageChops.offset(comp, s, 0), half))
    return blur


@transition_fx("whip_pan")
def _whip_pan(prev, cur, p, params, i, brand):
    return _whip(prev, cur, p)


# ---- Real screens ---------------------------------------------------------------------------------------------------
def persp_coeffs(src, dst):
    A, B = [], []
    for (x, y), (u, v) in zip(dst, src):
        A += [[x, y, 1, 0, 0, 0, -u * x, -u * y], [0, 0, 0, x, y, 1, -v * x, -v * y]]
        B += [u, v]
    return np.linalg.lstsq(np.array(A, float), np.array(B, float), rcond=None)[0]


def ripple(d, cx, cy, rk):
    for j in range(3):
        r = int(18 + (rk * 1.2 - j * 0.2) * 110)
        if r > 18:
            d.ellipse((cx - r, cy - r, cx + r, cy + r), outline=(255, 255, 255, max(0, int(255 * (1 - rk)))), width=5)
    if rk < 0.5:
        d.ellipse((cx - 20, cy - 20, cx + 20, cy + 20), fill=(255, 255, 255, 190))


@screen_fx("browser_window")
def browser_window(c, im, k, t, params, idx, tap, host):
    """A real screenshot in a browser-like window, slow 3D drift and push-in (the twist ad's montage)."""
    w = 660
    h = int(w * im.size[1] / im.size[0])
    if h > 780:
        h = 780
        w = int(h * im.size[0] / im.size[1])
    win = Image.new("RGBA", (w + 16, h + 52), (0, 0, 0, 0))
    dw = ImageDraw.Draw(win)
    dw.rounded_rectangle((0, 0, w + 15, h + 51), 20, fill=(250, 250, 252, 255))
    for i, col in enumerate([(255, 95, 87), (255, 189, 46), (40, 200, 64)]):
        dw.ellipse((16 + i * 22, 14, 30 + i * 22, 28), fill=col + (255,))
    dw.rounded_rectangle((90, 10, w - 60, 32), 11, fill=(232, 233, 240, 255))
    dw.text((106, 12), host, font=font("bold", 15), fill=(110, 112, 125, 255))
    zend = float(params.get("zoom", 1.15))
    fx, fy = float(params.get("fx", 0.5)), float(params.get("fy", 0.4))
    z = 1 + (zend - 1) * ease(min(1, k * 1.1))
    inner = im.resize((int(w * z), int(h * z)), Image.LANCZOS)
    ix = int((inner.size[0] - w) * fx)
    iy = int((inner.size[1] - h) * fy)
    win.alpha_composite(rounded(inner.crop((ix, iy, ix + w, iy + h)), 12), (8, 44))
    ang = (-4 if idx % 2 else 4) * (1 - ease(min(1, k * 1.5))) + math.sin(t * 1.3) * 1.2
    win = win.rotate(ang, expand=True, resample=Image.BICUBIC)
    y = 300 + (760 - win.size[1]) // 2 + int((1 - ease(k / 0.3)) * 120)
    c.alpha_composite(shadow_of(win, 140, 18), ((W - win.size[0]) // 2 + 6, y + 20))
    c.alpha_composite(win, ((W - win.size[0]) // 2, y))
    if tap and k > 0.55:
        rk = (k - 0.55) / 0.35
        bx = tap[0] * w * z - ix
        by = tap[1] * h * z - iy
        wx = (W - win.size[0]) // 2
        ripple(ImageDraw.Draw(c), int(wx + 8 + bx), int(y + 44 + by), rk)


_MOIRE = {}


def _moire():
    m = _MOIRE.get("m")
    if m is None:
        m = Image.new("L", (W, H), 0)
        md = ImageDraw.Draw(m)
        for i in range(-H, W, 7):
            md.line((i, 0, i + H, H), fill=26, width=2)
        _MOIRE["m"] = m
    return m


def filmed_monitor_picture(scr, k, t, seed, tap=None):
    """A REAL screenshot on a monitor, filmed up close with a phone: perspective, handheld drift, moire, glare, grain."""
    bg = Image.new("RGB", (W, H), (14, 15, 20))
    sw, sh = scr.size
    pw = 1000
    ph = int(pw * sh / sw)
    panel = Image.new("RGB", (pw + 30, ph + 30), (8, 8, 10))
    panel.paste(scr.resize((pw, ph), Image.LANCZOS), (15, 15))
    pw, ph = panel.size
    dx = math.sin(t * 1.7 + seed) * 20 + math.sin(t * 5.3) * 5
    dy = math.cos(t * 1.3 + seed) * 14 + math.cos(t * 6.1) * 4
    z = min((W * 1.08) / pw, 1020 / ph) * (1 + 0.07 * ease(k))
    cx, cy = W / 2 + dx, 600 + dy
    hw, hh = pw * z / 2, ph * z / 2
    tilt = 0.07 + 0.03 * math.sin(t * 0.9 + seed)
    dst = [(cx - hw * (1 - tilt), cy - hh * 0.94), (cx + hw * (1 + tilt * 0.4), cy - hh), (cx + hw * (1 + tilt * 0.4), cy + hh), (cx - hw * (1 - tilt), cy + hh * 0.94)]
    src = [(0, 0), (pw, 0), (pw, ph), (0, ph)]
    co = persp_coeffs(src, dst)
    warped = panel.transform((W, H), Image.PERSPECTIVE, tuple(co), Image.BICUBIC)
    mask = Image.new("L", (pw, ph), 255).transform((W, H), Image.PERSPECTIVE, tuple(co), Image.BICUBIC)
    bg.paste(warped, (0, 0), mask)
    out = bg.convert("RGBA")
    moire = Image.new("RGBA", (W, H), (255, 255, 255, 0))
    moire.putalpha(ImageChops.multiply(_moire(), mask))
    out.alpha_composite(moire)
    glare = Image.new("L", (W, H), 0)
    gd = ImageDraw.Draw(glare)
    gx = int(W * (0.2 + 0.25 * math.sin(t * 0.7 + seed)))
    gd.polygon([(gx, 0), (gx + 140, 0), (gx - 260, H), (gx - 400, H)], fill=40)
    glare = ImageChops.multiply(glare.filter(ImageFilter.GaussianBlur(40)), mask)
    gl = Image.new("RGBA", (W, H), (255, 255, 255, 0))
    gl.putalpha(glare)
    out.alpha_composite(gl)
    if tap and k > 0.5:
        fwd = persp_coeffs(dst, src)
        x0, y0 = 15 + tap[0] * (pw - 30), 15 + tap[1] * (ph - 30)
        a_, b_, c_, d_, e_, f_, g_, h_ = fwd
        den = g_ * x0 + h_ * y0 + 1
        px, py = (a_ * x0 + b_ * y0 + c_) / den, (d_ * x0 + e_ * y0 + f_) / den
        ripple(ImageDraw.Draw(out), int(px), int(py), (k - 0.5) / 0.4)
    out = out.convert("RGB")
    if k < 0.12:
        out = out.filter(ImageFilter.GaussianBlur(3 * (1 - k / 0.12)))
    return grain(out, 7, seed * 100 + int(t * FPS))


@screen_fx("filmed_monitor")
def filmed_monitor(c, im, k, t, params, idx, tap, host):
    c.paste(filmed_monitor_picture(im, k, t, idx + 1, tap).convert("RGBA"), (0, 0))


@screen_fx("tap_ripple")
def _tap(c, im, k, t, params, idx, tap, host):
    # Drawn by the screen presentation itself (it knows where the real button is after its transforms).
    return None


def clamp01(x):
    return clamp(x, 0.0, 1.0)

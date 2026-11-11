# Ad renderer core: canvas size, fonts on macOS / Windows / Linux, easing, picture helpers and clip frames.
# Ported from the 10 Nov 2026 prototypes (~/bupulse-ugc-ads/twist/render_twist.py, story/render_story.py).
# Python 3.9+, Pillow and numpy only (docs/AD_BRAIN.md "Where the renderer runs").
import math
import os
import subprocess
from functools import lru_cache

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont, ImageOps

W, H, FPS = 720, 1280, 24

# ---- Fonts --------------------------------------------------------------------------------------------------------
# The prototypes used Arial Black, Arial Bold, Courier New Bold and Impact. Windows has them in C:\Windows\Fonts, macOS
# in /System/Library/Fonts/Supplemental; AD_RENDER_FONTS points at another folder holding the same files.
_FONT_FILES = {
    "black": ["Arial Black.ttf", "ariblk.ttf", "DejaVuSans-Bold.ttf"],
    "bold": ["Arial Bold.ttf", "arialbd.ttf", "DejaVuSans-Bold.ttf"],
    "mono": ["Courier New Bold.ttf", "courbd.ttf", "DejaVuSansMono-Bold.ttf"],
    "impact": ["Impact.ttf", "impact.ttf", "Arial Black.ttf", "ariblk.ttf", "DejaVuSans-Bold.ttf"],
}
_FONT_DIRS = [
    os.environ.get("AD_RENDER_FONTS", ""),
    "/System/Library/Fonts/Supplemental",
    "/Library/Fonts",
    os.path.join(os.environ.get("WINDIR", "C:\\Windows"), "Fonts"),
    "/usr/share/fonts/truetype/dejavu",
    "/usr/share/fonts/TTF",
]


@lru_cache(maxsize=None)
def font_path(kind):
    for name in _FONT_FILES[kind]:
        for d in _FONT_DIRS:
            if d and os.path.isfile(os.path.join(d, name)):
                return os.path.join(d, name)
    raise RuntimeError("No font found for '%s'. Install Arial / Impact / Courier New or set AD_RENDER_FONTS." % kind)


@lru_cache(maxsize=None)
def font(kind, size):
    return ImageFont.truetype(font_path(kind), int(size))


# ---- Small helpers ------------------------------------------------------------------------------------------------
def ease(x):
    x = max(0.0, min(1.0, x))
    return 1 - (1 - x) ** 3


def clamp(x, a, b):
    return max(a, min(b, x))


def hex_rgb(h, default=(47, 107, 255)):
    try:
        h = h.lstrip("#")
        return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))
    except Exception:
        return default


def tint(rgb, white=0.45):
    return tuple(int(c + (255 - c) * white) for c in rgb)


def fit(im, centering=(0.5, 0.45)):
    return ImageOps.fit(im.convert("RGB"), (W, H), method=Image.LANCZOS, centering=centering)


def zoom(im, s, cx=0.5, cy=0.5):
    if abs(s - 1) < 1e-3:
        return im
    big = im.resize((int(W * s), int(H * s)), Image.BILINEAR)
    x = int((big.size[0] - W) * cx)
    y = int((big.size[1] - H) * cy)
    return big.crop((x, y, x + W, y + H))


def rounded(im, r):
    m = Image.new("L", im.size, 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, im.size[0] - 1, im.size[1] - 1), r, fill=255)
    o = im.convert("RGBA")
    o.putalpha(m)
    return o


def white(im, amount):
    if amount <= 0:
        return im
    return Image.blend(im, Image.new("RGB", im.size, (255, 255, 255)), clamp(amount, 0, 1))


def shadow_of(layer, alpha=110, blur=12):
    sh = Image.new("RGBA", layer.size, (0, 0, 0, 0))
    sh.putalpha(layer.getchannel("A").point(lambda v: v * alpha // 255))
    return sh.filter(ImageFilter.GaussianBlur(blur))


# ---- Pictures from files ------------------------------------------------------------------------------------------
@lru_cache(maxsize=64)
def load_image(path):
    return Image.open(path).convert("RGB")


@lru_cache(maxsize=32)
def load_fitted(path):
    return fit(load_image(path))


def ffmpeg_bin():
    return os.environ.get("AD_RENDER_FFMPEG", "ffmpeg")


def ffprobe_bin():
    return os.environ.get("AD_RENDER_FFPROBE", "ffprobe")


def extract_frames(video, out_dir):
    """Every frame of a clip at 24 fps and 720x1280 (cropped to fill), as JPEGs in out_dir. Done once per clip."""
    if os.path.isdir(out_dir) and os.listdir(out_dir):
        return sorted(os.path.join(out_dir, f) for f in os.listdir(out_dir))
    os.makedirs(out_dir, exist_ok=True)
    vf = "scale=%d:%d:force_original_aspect_ratio=increase,crop=%d:%d,fps=%d" % (W, H, W, H, FPS)
    subprocess.run([ffmpeg_bin(), "-v", "error", "-y", "-i", video, "-vf", vf, "-q:v", "3", os.path.join(out_dir, "%05d.jpg")], check=True)
    return sorted(os.path.join(out_dir, f) for f in os.listdir(out_dir))


class Clips:
    """Frames of the ad's clips, read on demand (a few hundred JPEGs per clip, cached by Pillow's loader)."""

    def __init__(self, work_dir):
        self.work_dir = work_dir
        self.frames = {}

    def prepare(self, key, path):
        if key not in self.frames:
            safe = "".join(c if c.isalnum() else "_" for c in key)
            self.frames[key] = extract_frames(path, os.path.join(self.work_dir, "frames", safe))

    def frame(self, key, t):
        f = self.frames.get(key) or []
        if not f:
            return Image.new("RGB", (W, H), (10, 10, 14))
        return load_image(f[int(clamp(int(t * FPS), 0, len(f) - 1))])


def bg_tech_base(primary):
    g = Image.new("RGB", (W, H), (8, 10, 32))
    d = ImageDraw.Draw(g)
    for i in range(H // 8):
        y = i * 8
        v = int(18 + 30 * (y / H))
        d.line((0, y, W, y), fill=(8, 10 + v // 3, 32 + v))
    glow = Image.new("RGB", (W, H), (0, 0, 0))
    gc = tuple(int(c * 0.8) for c in primary)
    ImageDraw.Draw(glow).ellipse((W // 2 - 420, 300, W // 2 + 420, 1100), fill=gc)
    return ImageChops.add(g, glow.filter(ImageFilter.GaussianBlur(140)))


@lru_cache(maxsize=4)
def _bg_cached(primary):
    return bg_tech_base(primary)


def bg_tech(t, primary):
    """A dark blue tech background with a slowly moving grid (the base layer under real screens)."""
    g = _bg_cached(tuple(primary)).copy()
    d = ImageDraw.Draw(g)
    off = int((t * 40) % 60)
    for x in range(-60, W + 60, 60):
        d.line((x + off, 0, x + off, H), fill=(28, 36, 90))
    for y in range(-60, H + 60, 60):
        d.line((0, y + off, W, y + off), fill=(28, 36, 90))
    return g


def osc(t, a, b):
    return math.sin(t * a) * b

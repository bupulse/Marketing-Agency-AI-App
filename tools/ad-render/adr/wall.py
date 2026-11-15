# The poster wall (the owner's hand-made "which ad stops the scroll?" video, 11 Nov 2026, judge 8/10; ported from
# ~/bupulse-ugc-ads/wall/render_wall.py). A streaming-style wall of ad cards in 4 columns; for each pick the columns spin
# like a slot machine (motion blur, slowing down) and land the picked card in the middle row; it glows in BuPulse
# blue-violet, then expands into its clip (transition "wall_expand"), and later the clip shrinks back into the wall
# ("wall_collapse"). The EDL gives the cards (edl.wall.cards), the card of each pick (edl.wall.picks) and the wall
# segments (source "wall", wallPick = the pick it lands on); render.py calls this module for them.
import math
import random

from PIL import Image, ImageChops, ImageDraw, ImageEnhance, ImageFilter, ImageOps

from .core import FPS, H, W, font
from .fx import segment_fx, transition_fx

SPIN, GLOW = 1.3, 0.32
CW, CH, GAP = 160, 284, 14
PITCH = CH + GAP
COLS = 4
X0 = (W - (COLS * CW + (COLS - 1) * GAP)) // 2
CY = H // 2 - CH // 2
DIR = [1, -1, 1, -1]
VIOLET = (123, 92, 255)
BG = (9, 10, 18)


def ease_out(x):
    x = max(0.0, min(1.0, x))
    return 1 - (1 - x) ** 4


def smooth(x):
    x = max(0.0, min(1.0, x))
    return x * x * (3 - 2 * x)


def rounded(im, r):
    m = Image.new("L", im.size, 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, im.size[0] - 1, im.size[1] - 1), max(0, int(r)), fill=255)
    o = im.convert("RGBA")
    o.putalpha(m)
    return o


def card_image(im, label=None):
    """A card: the picture filled to the card, a dark fade at the bottom, a play badge, rounded corners."""
    c = ImageEnhance.Contrast(ImageOps.fit(im.convert("RGB"), (CW, CH), centering=(0.5, 0.35))).enhance(1.05).convert("RGBA")
    grad = Image.new("L", (1, CH))
    for y in range(CH):
        grad.putpixel((0, y), int(max(0, (y - CH * 0.55) / (CH * 0.45)) * 210))
    c.alpha_composite(Image.merge("RGBA", (Image.new("L", (CW, CH), 0),) * 3 + (grad.resize((CW, CH)),)))
    d = ImageDraw.Draw(c)
    if label:
        d.text((10, CH - 30), label[:18], font=font("bold", 15), fill=(255, 255, 255, 255))
    d.ellipse((CW - 30, 10, CW - 10, 30), fill=(0, 0, 0, 120))
    d.polygon([(CW - 23, 15), (CW - 23, 25), (CW - 14, 20)], fill=(255, 255, 255, 230))
    m = Image.new("L", (CW, CH), 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, CW - 1, CH - 1), 16, fill=255)
    c.putalpha(ImageChops.multiply(c.getchannel("A"), m))
    return c


class Wall:
    def __init__(self, ad):
        edl = ad.edl
        cfg = edl.get("wall") or {}
        brand = ad.brand
        self.brand = tuple(brand)
        self.card_of = {}
        for key in cfg.get("cards", []):
            if key not in self.card_of:
                self.card_of[key] = card_image(ad.wall_picture(key))
        self.picks = [self.card_of.get(k) or card_image(ad.wall_picture(k)) for k in cfg.get("picks", [])]
        pool = [im for k, im in self.card_of.items() if k not in cfg.get("picks", [])] or self.picks[:]
        rnd = random.Random(7)
        # Picks alternate between the two middle columns (as in the prototype); each column also holds the pool.
        self.pick_col = [1 + (i % 2) for i in range(len(self.picks))]
        self.columns = []
        for c in range(COLS):
            lst = pool[:]
            rnd.shuffle(lst)
            lst = lst[:6] + [self.picks[i] for i in range(len(self.picks)) if self.pick_col[i] == c]
            if not lst:
                lst = self.picks[:] or pool[:]
            rnd.shuffle(lst)
            while len(lst) < 5:
                lst = lst + lst
            self.columns.append(lst)
        self.cycle = [len(col) * PITCH for col in self.columns]
        # The spins: the wall segments that land on a pick, in time order.
        self.spins = sorted([(s["start"], s["wallPick"]) for s in edl["segments"] if s["source"] == "wall" and s.get("wallPick") is not None])
        glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        ImageDraw.Draw(glow).ellipse((-200, 300, W + 200, 1000), fill=(40, 70, 200, 70))
        self.glow = glow.filter(ImageFilter.GaussianBlur(140))
        shade = Image.new("L", (1, H))
        for y in range(H):
            shade.putpixel((0, y), int(min(255, 230 * max(0, 1 - y / 220) + 230 * max(0, (y - (H - 260)) / 260))))
        self.shade = Image.merge("RGBA", (Image.new("L", (W, H), 0),) * 3 + (shade.resize((W, H)),))

    def index_of(self, c, pick):
        im = self.picks[pick]
        for i, x in enumerate(self.columns[c]):
            if x is im:
                return i
        return 2

    def landing(self, c, pick):
        if c == self.pick_col[pick]:
            return self.index_of(c, pick) * PITCH
        return 2 * PITCH + PITCH // 2 * (c + 1)

    def offset(self, c, t):
        """How far a column has scrolled at time t: a slow drift, and at each spin a fast spin that lands its card."""
        prev, last, drift = 0.0, 0.0, 18 * DIR[c]
        for start, pick in self.spins:
            if t < start:
                return prev + drift * (t - last)
            begin = prev + drift * (start - last)
            target = self.landing(c, pick)
            base = begin + DIR[c] * (3 + c % 2) * self.cycle[c]
            end = base + ((target - base) % self.cycle[c] if DIR[c] > 0 else -((base - target) % self.cycle[c]))
            if t < start + SPIN:
                return begin + (end - begin) * ease_out((t - start) / SPIN)
            prev, last = end, start + SPIN
        return prev + drift * (t - last)

    def card_box(self, pick):
        x = X0 + self.pick_col[pick] * (CW + GAP)
        return (x, CY, x + CW, CY + CH)

    def draw(self, t, dim=0.0, hide=None):
        c = Image.new("RGBA", (W, H), BG + (255,))
        c.alpha_composite(self.glow)
        hide_im = self.picks[hide] if hide is not None and hide < len(self.picks) else None
        for col in range(COLS):
            off = self.offset(col, t)
            x = X0 + col * (CW + GAP)
            n = len(self.columns[col])
            first = math.floor((off - CY) / PITCH) - 1
            for k in range(first, first + 7):
                y = CY + k * PITCH - off
                if y > H or y + CH < 0:
                    continue
                im = self.columns[col][k % n]
                if hide_im is not None and im is hide_im and abs(y - CY) < 2:
                    continue
                c.alpha_composite(im, (int(x), int(y)))
        sp = max(abs(self.offset(col, t + 1 / FPS) - self.offset(col, t)) for col in range(COLS))
        if sp > 25:  # motion blur while the columns race
            n = min(6, int(sp / 25))
            acc = c.copy()
            for k in range(1, n + 1):
                acc = Image.blend(acc, ImageChops.offset(c, 0, int(-k * sp / (n + 1))), 1 / (k + 1))
            c = acc
        if dim > 0:
            c.alpha_composite(Image.new("RGBA", (W, H), (0, 0, 0, int(200 * dim))))
        c.alpha_composite(self.shade)
        return c

    def glow_ring(self, c, box, k, t):
        if k <= 0:
            return
        x0, y0, x1, y1 = box
        lay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        d = ImageDraw.Draw(lay)
        pulse = 0.75 + 0.25 * math.sin(t * 18)
        for i, wd in enumerate((26, 16, 8)):
            col = tuple(int(self.brand[j] + (VIOLET[j] - self.brand[j]) * (i / 2)) for j in range(3))
            d.rounded_rectangle((x0 - wd, y0 - wd, x1 + wd, y1 + wd), 22 + wd, outline=col + (int(255 * k * pulse * (0.35 + i * 0.3)),), width=6)
        c.alpha_composite(lay.filter(ImageFilter.GaussianBlur(6)))
        c.alpha_composite(lay)

    def pick_label(self, c, pick, k):
        if k <= 0:
            return
        d = ImageDraw.Draw(c)
        last = pick == len(self.picks) - 1
        txt = "FINAL PICK" if last else "PICK %d OF %d" % (pick + 1, max(1, len(self.picks) - 1))
        f = font("black", 22)
        tw = d.textlength(txt, font=f)
        d.rounded_rectangle(((W - tw) / 2 - 20, 116, (W + tw) / 2 + 20, 156), 20, fill=self.brand + (int(230 * k),))
        d.text(((W - tw) / 2, 124), txt, font=f, fill=(255, 255, 255, int(255 * k)))

    def segment_picture(self, seg, t):
        """A wall segment's frame: drifting, or spinning to its pick, then the landed card glowing."""
        pick = seg.get("wallPick")
        if pick is None or pick >= len(self.picks):
            return self.draw(t).convert("RGB")
        lt = t - seg["start"]
        label = smooth(lt / 0.25)
        if lt < SPIN:
            c = self.draw(t)
            self.pick_label(c, pick, label)
            return c.convert("RGB")
        k = smooth((lt - SPIN) / 0.18)
        box = self.card_box(pick)
        c = self.draw(t, dim=0.45 * k, hide=pick)
        c.alpha_composite(self.picks[pick], box[:2])
        self.glow_ring(c, box, k, t)
        self.pick_label(c, pick, label)
        return c.convert("RGB")

    def _box_at(self, pick, k):
        return tuple(int(a + (b - a) * k) for a, b in zip(self.card_box(pick), (0, 0, W, H)))

    def expand(self, clip_frame, pick, p, t):
        """wall_expand: the landed card grows into the full-screen clip."""
        k = smooth(p)
        c = self.draw(t, dim=0.45 + 0.4 * k, hide=pick)
        bx = self._box_at(pick, k)
        im = rounded(ImageOps.fit(clip_frame, (max(2, bx[2] - bx[0]), max(2, bx[3] - bx[1])), centering=(0.5, 0.4)), 18 * (1 - k))
        c.alpha_composite(im, bx[:2])
        self.glow_ring(c, bx, 1 - k, t)
        return c.convert("RGB")

    def collapse(self, clip_frame, pick, p, t):
        """wall_collapse: the clip's last frame shrinks back into its card while the wall comes back."""
        k = 1 - smooth(p)
        c = self.draw(t, dim=0.85 * k, hide=pick)
        bx = self._box_at(pick, k)
        im = rounded(ImageOps.fit(clip_frame, (max(2, bx[2] - bx[0]), max(2, bx[3] - bx[1])), centering=(0.5, 0.4)), 18 * (1 - k))
        c.alpha_composite(im, bx[:2])
        return c.convert("RGB")


def chip(c, text, k, brand):
    """A small live-style chip over a picked clip ("Example ad · bakery")."""
    if k <= 0 or not text:
        return
    d = ImageDraw.Draw(c)
    f = font("bold", 24)
    tw = d.textlength(text, font=f)
    y = 70
    d.rounded_rectangle((28, y, 28 + tw + 34, y + 44), 22, fill=(0, 0, 0, int(150 * k)))
    d.ellipse((40, y + 16, 52, y + 28), fill=(255, 70, 90, int(255 * k)))
    d.text((60, y + 9), text, font=f, fill=(255, 255, 255, int(255 * k)))


# Registered so the effects library and the renderer stay in step (render.py draws them through Wall, which needs the
# whole wall; these entries only mark them as drawable).
@segment_fx("poster_wall")
def _poster_wall(im, ctx):
    return im


@transition_fx("wall_expand")
def _wall_expand(prev, cur, p, params, i, brand):
    return cur


@transition_fx("wall_collapse")
def _wall_collapse(prev, cur, p, params, i, brand):
    return cur



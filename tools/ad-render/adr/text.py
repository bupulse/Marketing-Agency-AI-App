# Titles, captions, floating screen cards and the end card. Ported from the prototypes.
import re

from PIL import Image, ImageDraw, ImageFilter, ImageOps

from .core import H, W, ease, font, load_image, rounded, shadow_of, tint
from .fx import typewriter

YELLOW = (255, 225, 77)
TITLES = {}


def title_style(name):
    def deco(fn):
        TITLES[name] = fn
        return fn
    return deco


@title_style("slam")
def slam_title(c, text, lt, y, brand):
    """A bold skewed title slams in big and settles (first 0.25 s), with a dark outline."""
    if lt <= 0:
        return
    s = 1.45 - 0.45 * ease(lt / 0.25) if lt < 0.25 else 1.0
    f = font("black", 64)
    tw = ImageDraw.Draw(c).textlength(text, font=f)
    lay = Image.new("RGBA", (int(tw) + 40, 100), (0, 0, 0, 0))
    ImageDraw.Draw(lay).text((20, 10), text, font=f, fill=(255, 255, 255, 255), stroke_width=4, stroke_fill=(0, 0, 0, 200))
    lay = lay.transform(lay.size, Image.AFFINE, (1, 0.16, -10, 0, 1, 0), resample=Image.BICUBIC)
    maxw = W - 40
    if lay.size[0] * s > maxw:
        s = maxw / lay.size[0]
    lay = lay.resize((max(1, int(lay.size[0] * s)), max(1, int(lay.size[1] * s))), Image.LANCZOS)
    c.alpha_composite(lay, ((W - lay.size[0]) // 2, int(y - lay.size[1] // 2)))


@title_style("typewriter")
def type_title(c, text, lt, y, brand):
    typewriter(c, text, lt - 0.1, int(y))


@title_style("pop")
def pop_title(c, text, lt, y, brand):
    """One big yellow word pops in (Impact, black outline)."""
    f = font("impact", 96)
    kk = ease(lt / 0.12)
    tw = ImageDraw.Draw(c).textlength(text, font=f)
    lay = Image.new("RGBA", (int(tw) + 40, 130), (0, 0, 0, 0))
    ImageDraw.Draw(lay).text((22, 8), text, font=f, fill=YELLOW + (255,), stroke_width=5, stroke_fill=(0, 0, 0, 255))
    s = (0.6 + 0.4 * kk) * min(1, (W - 40) / lay.size[0])
    lay = lay.resize((max(1, int(lay.size[0] * s)), max(1, int(lay.size[1] * s))), Image.LANCZOS)
    c.alpha_composite(lay, ((W - lay.size[0]) // 2, int(y - lay.size[1] // 2)))


# ---- Captions ---------------------------------------------------------------------------------------------------------
def caption_words(edl):
    """Every spoken word on the ad's timeline. The script's own words (right spelling) take the transcript's timings;
    when the counts differ the script's words are spread over the spoken time."""
    out = []
    for v in edl.get("voice", []):
        a = edl["assets"].get(v["asset"], {})
        heard = [w for w in a.get("words", []) or [] if w["e"] > v["from"] - 0.05 and w["s"] < v["to"] + 0.05]
        text = [w for w in re.split(r"\s+", v["text"].strip()) if re.search(r"\w", w)]
        if not text:
            continue
        if heard and len(heard) == len(text):
            spans = [(w["s"], w["e"]) for w in heard]
        else:
            s0 = heard[0]["s"] if heard else v["from"]
            e0 = heard[-1]["e"] if heard else v["to"]
            step = (e0 - s0) / len(text)
            spans = [(s0 + i * step, s0 + (i + 1) * step - 0.02) for i in range(len(text))]
        for word, (s, e) in zip(text, spans):
            out.append({"w": word, "s": v["at"] + s - v["from"], "e": v["at"] + e - v["from"]})
    return sorted(out, key=lambda w: w["s"])


def caption_groups(words):
    groups, g = [], []
    for i, w in enumerate(words):
        g.append(w)
        gap = words[i + 1]["s"] - w["e"] if i + 1 < len(words) else 9
        if len(g) == 3 or w["w"].endswith((".", ",", "?", "!")) or gap > 0.4:
            groups.append(g)
            g = []
    if g:
        groups.append(g)
    return groups


def clean_word(w):
    return w.strip(".,?!:;\"'").upper()


def karaoke(c, groups, t, y, brand):
    """CapCut-style: three words at a time, the word being said in yellow."""
    cur = None
    for i, g in enumerate(groups):
        nxt = groups[i + 1][0]["s"] if i + 1 < len(groups) else 99
        if g[0]["s"] - 0.04 <= t < min(nxt, g[-1]["e"] + 0.5):
            cur = g
    if not cur:
        return
    f = font("black", 54)
    d = ImageDraw.Draw(c)
    txt = [clean_word(w["w"]) for w in cur]
    sp = d.textlength(" ", font=f)
    ws = [d.textlength(x, font=f) for x in txt]
    while sum(ws) + sp * (len(ws) - 1) > W - 40 and f.size > 30:
        f = font("black", f.size - 4)
        sp = d.textlength(" ", font=f)
        ws = [d.textlength(x, font=f) for x in txt]
    x = (W - sum(ws) - sp * (len(ws) - 1)) / 2
    for w, tx, wd in zip(cur, txt, ws):
        if t >= w["s"] - 0.04:
            hot = t <= w["e"] + 0.04
            col = (YELLOW if hot else (255, 255, 255)) + (255,)
            d.text((x, y), tx, font=f, fill=col, stroke_width=8, stroke_fill=(0, 0, 0, 255))
        x += wd + sp


def one_word(c, words, t, y, brand):
    """Each spoken word pops alone, big, with a soft shadow."""
    cur = None
    for w in words:
        if w["s"] - 0.03 <= t < w["e"] + 0.12:
            cur = w
    if not cur:
        return
    txt = clean_word(cur["w"])
    f = font("black", 84)
    k = ease((t - cur["s"] + 0.03) / 0.09)
    s = 0.75 + 0.25 * k
    tw = ImageDraw.Draw(c).textlength(txt, font=f)
    lay = Image.new("RGBA", (int(tw) + 40, 120), (0, 0, 0, 0))
    d = ImageDraw.Draw(lay)
    d.text((22, 14), txt, font=f, fill=(0, 0, 0, 150))
    d.text((20, 10), txt, font=f, fill=(255, 255, 255, 255))
    if lay.size[0] * s > W - 30:
        s = (W - 30) / lay.size[0]
    lay = lay.resize((max(1, int(lay.size[0] * s)), max(1, int(lay.size[1] * s))), Image.LANCZOS)
    c.alpha_composite(lay, ((W - lay.size[0]) // 2, int(y - lay.size[1] // 2)))


# ---- Floating real screen cards (the twist's "which one is AI?") -------------------------------------------------------
def float_card(c, im, label, k, x, y, w, rot, frm, brand):
    if k <= 0:
        return
    e = ease(k)
    h = int(w * im.size[1] / im.size[0])
    lay = Image.new("RGBA", (w + 20, h + 20), (0, 0, 0, 0))
    ImageDraw.Draw(lay).rounded_rectangle((0, 0, w + 19, h + 19), 22, fill=(255, 255, 255, 255))
    lay.alpha_composite(rounded(ImageOps.fit(im, (w, h)), 14), (10, 10))
    dl = ImageDraw.Draw(lay)
    dl.ellipse((-6, -6, 62, 62), fill=tuple(brand) + (255,))
    dl.text((14, 4), label, font=font("black", 46), fill=(255, 255, 255, 255))
    lay = lay.rotate(rot, expand=True, resample=Image.BICUBIC)
    px = int(x + frm * (1 - e) * 300)
    c.alpha_composite(shadow_of(lay), (px + 8, y + 14))
    c.alpha_composite(lay, (px, y))


# ---- End card -----------------------------------------------------------------------------------------------------------
def end_card(c, k, card, brand, logo_path=None, face_path=None, host="bupulse.com"):
    """Dark card: the face in a circle (or the logo), the site big, the button, one small line. Fades in."""
    c.alpha_composite(Image.new("RGBA", (W, H), (8, 10, 30, int(240 * min(1, k * 3)))))
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse((60, 160, 660, 760), fill=tuple(int(x * 0.85) for x in brand) + (110,))
    c.alpha_composite(glow.filter(ImageFilter.GaussianBlur(120)))
    d = ImageDraw.Draw(c)
    al = int(255 * min(1, max(0, (k - 0.05) * 6)))
    if face_path:
        r = int(170 * ease(k / 0.12))
        if r > 4:
            face = ImageOps.fit(load_image(face_path), (2 * r, 2 * r), centering=(0.5, 0.3))
            m = Image.new("L", (2 * r, 2 * r), 0)
            ImageDraw.Draw(m).ellipse((0, 0, 2 * r - 1, 2 * r - 1), fill=255)
            d.ellipse((W // 2 - r - 8, 300 - r - 8, W // 2 + r + 8, 300 + r + 8), fill=(255, 255, 255))
            c.paste(face, (W // 2 - r, 300 - r), m)
    elif logo_path:
        ic = Image.open(logo_path).convert("RGBA").resize((150, 150), Image.LANCZOS)
        ic.putalpha(ic.getchannel("A").point(lambda v: v * al // 255))
        c.alpha_composite(ic, ((W - 150) // 2, 290))

    def ctr(text, kind, size, y, fill):
        f = font(kind, size)
        while d.textlength(text, font=f) > W - 60 and size > 20:
            size -= 4
            f = font(kind, size)
        tw = d.textlength(text, font=f)
        d.text(((W - tw) / 2, y), text, font=f, fill=fill + (al,))

    ctr(card.get("headline", ""), "black", 40, 500, (255, 255, 255))
    ctr(host, "black", 64, 560, tint(brand))
    d.rounded_rectangle((110, 690, W - 110, 770), radius=40, fill=tuple(brand) + (al,))
    ctr(card.get("button", "Get a quote"), "black", 40, 708, (255, 255, 255))
    if card.get("sub"):
        ctr(card["sub"], "bold", 28, 810, (220, 222, 235))
    if face_path and logo_path:
        ic = Image.open(logo_path).convert("RGBA").resize((70, 70), Image.LANCZOS)
        c.alpha_composite(ic, ((W - 70) // 2, 40))

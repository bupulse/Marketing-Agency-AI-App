import random, sys, os
out = sys.argv[1]
W, H = 1600, 1000

def hill(y0, amp, seed, n=7):
    r = random.Random(seed)
    pts = []
    for i in range(n + 1):
        x = i * W / n
        pts.append((x, y0 + r.uniform(-amp, amp)))
    d = f"M0 {H} L0 {pts[0][1]:.0f} "
    for i in range(1, len(pts)):
        x0, y0_ = pts[i - 1]; x1, y1 = pts[i]
        cx = (x0 + x1) / 2
        d += f"C{cx:.0f} {y0_:.0f} {cx:.0f} {y1:.0f} {x1:.0f} {y1:.0f} "
    d += f"L{W} {H} Z"
    return d, pts

def y_on(pts, x):
    for i in range(1, len(pts)):
        if pts[i][0] >= x:
            x0, y0 = pts[i - 1]; x1, y1 = pts[i]
            t = (x - x0) / (x1 - x0); t = t * t * (3 - 2 * t)
            return y0 + (y1 - y0) * t
    return pts[-1][1]

def houses(pts, seed, count, colors, lit=None, rows=2):
    r = random.Random(seed); s = ""
    for _ in range(count):
        x = r.uniform(0, W); y = y_on(pts, x) + r.uniform(4, 40 * rows)
        w = r.uniform(8, 18); h = r.uniform(6, 12)
        c = r.choice(colors)
        s += f'<rect x="{x:.0f}" y="{y:.0f}" width="{w:.0f}" height="{h:.0f}" rx="1.5" fill="{c}"/>'
        if lit and r.random() < lit:
            s += f'<rect x="{x+2:.0f}" y="{y+2:.0f}" width="{max(2,w/4):.0f}" height="3" fill="#ffd27a" opacity=".9"/>'
    return s

def kigali_day():
    s = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" preserveAspectRatio="xMidYMax slice">'
    s += '<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8fc3ff"/><stop offset=".55" stop-color="#cfe6ff"/><stop offset="1" stop-color="#ffe2c4"/></linearGradient></defs>'
    s += f'<rect width="{W}" height="{H}" fill="url(#sky)"/>'
    for cx, cy, sc in [(260, 160, 1), (980, 110, 1.3), (1380, 220, .9)]:
        s += f'<g fill="#ffffff" opacity=".85"><ellipse cx="{cx}" cy="{cy}" rx="{90*sc:.0f}" ry="{26*sc:.0f}"/><ellipse cx="{cx+50*sc:.0f}" cy="{cy-18*sc:.0f}" rx="{60*sc:.0f}" ry="{30*sc:.0f}"/></g>'
    d, p1 = hill(470, 50, 1); s += f'<path d="{d}" fill="#9cc7a4"/>'
    s += houses(p1, 11, 120, ["#e9e2d6", "#d9cbb6", "#c97b5a", "#f4f1ea"])
    # city centre towers + dome on the far hill
    base = y_on(p1, 820)
    for x, h, w in [(700, 120, 34), (745, 170, 40), (795, 140, 30), (900, 110, 28), (940, 150, 36)]:
        s += f'<rect x="{x}" y="{base-h:.0f}" width="{w}" height="{h+30}" rx="3" fill="#dfe8f2"/><rect x="{x+4}" y="{base-h+8:.0f}" width="{w-8}" height="{h-10}" fill="#b9cde3" opacity=".7"/>'
    s += f'<path d="M820 {base+10:.0f} a60 60 0 0 1 120 0 z" fill="#f1f4f8"/><path d="M836 {base+10:.0f} a44 44 0 0 1 88 0" fill="none" stroke="#c6d4e6" stroke-width="4"/>'
    d, p2 = hill(600, 60, 2); s += f'<path d="{d}" fill="#6fae7f"/>'
    s += houses(p2, 12, 160, ["#efe6d8", "#d8c4a8", "#b8694a", "#ffffff"], rows=3)
    d, p3 = hill(760, 50, 3); s += f'<path d="{d}" fill="#4f9466"/>'
    s += houses(p3, 13, 120, ["#f3ebdd", "#c47353", "#e2d3bd"], rows=3)
    d, _ = hill(900, 30, 4); s += f'<path d="{d}" fill="#3b7d52"/>'
    return s + '</svg>'

def kigali_night():
    r = random.Random(5)
    s = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" preserveAspectRatio="xMidYMax slice">'
    s += '<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0b1030"/><stop offset=".6" stop-color="#1c2560"/><stop offset="1" stop-color="#3a2b6b"/></linearGradient><radialGradient id="glow" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#7fb2ff" stop-opacity=".55"/><stop offset="1" stop-color="#7fb2ff" stop-opacity="0"/></radialGradient></defs>'
    s += f'<rect width="{W}" height="{H}" fill="url(#sky)"/>'
    for _ in range(140):
        s += f'<circle cx="{r.uniform(0,W):.0f}" cy="{r.uniform(0,420):.0f}" r="{r.uniform(.6,1.8):.1f}" fill="#ffffff" opacity="{r.uniform(.3,.9):.2f}"/>'
    s += '<circle cx="1320" cy="150" r="46" fill="#f6f1d9"/><circle cx="1340" cy="138" r="46" fill="#1a2358"/>'
    d, p1 = hill(500, 50, 1); s += f'<path d="{d}" fill="#1b1f45"/>'
    base = y_on(p1, 820)
    s += f'<circle cx="880" cy="{base:.0f}" r="160" fill="url(#glow)"/>'
    for x, h, w in [(700, 120, 34), (745, 170, 40), (795, 140, 30), (900, 110, 28), (940, 150, 36)]:
        s += f'<rect x="{x}" y="{base-h:.0f}" width="{w}" height="{h+30}" rx="3" fill="#252b5c"/>'
        for yy in range(int(base - h + 10), int(base + 20), 12):
            for xx in range(x + 5, x + w - 5, 8):
                if r.random() < .55: s += f'<rect x="{xx}" y="{yy}" width="4" height="5" fill="#ffd98a" opacity=".85"/>'
    s += f'<path d="M820 {base+10:.0f} a60 60 0 0 1 120 0 z" fill="#3d56c9"/><path d="M836 {base+10:.0f} a44 44 0 0 1 88 0" fill="none" stroke="#9fd0ff" stroke-width="4"/><path d="M852 {base+10:.0f} a28 28 0 0 1 56 0" fill="none" stroke="#ff9ad5" stroke-width="3"/>'
    for seed, y0, col in [(2, 620, "#151938"), (3, 780, "#10132c"), (4, 910, "#0b0d20")]:
        d, p = hill(y0, 55, seed); s += f'<path d="{d}" fill="{col}"/>'
        rr = random.Random(seed * 7)
        for _ in range(420):
            x = rr.uniform(0, W); y = y_on(p, x) + rr.uniform(6, 160)
            if y < H: s += f'<circle cx="{x:.0f}" cy="{y:.0f}" r="{rr.uniform(1,2.4):.1f}" fill="{rr.choice(["#ffd27a","#ffe4a8","#ffb86b","#fff3d1"])}" opacity="{rr.uniform(.5,1):.2f}"/>'
    return s + '</svg>'

def beach():
    s = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" preserveAspectRatio="xMidYMax slice">'
    s += '<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffb38a"/><stop offset=".5" stop-color="#ffd7a8"/><stop offset="1" stop-color="#fff0d6"/></linearGradient><linearGradient id="sea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4f9fc4"/><stop offset="1" stop-color="#2d7aa3"/></linearGradient></defs>'
    s += f'<rect width="{W}" height="{H}" fill="url(#sky)"/><circle cx="1100" cy="470" r="90" fill="#fff4cf" opacity=".95"/>'
    d, _ = hill(500, 35, 9); s += f'<path d="{d}" fill="#a08cb8"/>'
    d, _ = hill(540, 25, 10); s += f'<path d="{d}" fill="#7d78a6"/>'
    s += f'<rect y="560" width="{W}" height="300" fill="url(#sea)"/>'
    r = random.Random(4)
    for _ in range(60):
        x = r.uniform(0, W); y = r.uniform(580, 820)
        s += f'<rect x="{x:.0f}" y="{y:.0f}" width="{r.uniform(20,90):.0f}" height="2" rx="1" fill="#ffffff" opacity="{r.uniform(.2,.5):.2f}"/>'
    s += f'<rect x="1040" y="570" width="120" height="3" fill="#fff4cf" opacity=".6"/><rect x="1060" y="590" width="80" height="3" fill="#fff4cf" opacity=".5"/>'
    s += f'<path d="M0 820 C400 780 900 800 {W} 760 L{W} {H} L0 {H} Z" fill="#f0d6a8"/><path d="M0 860 C500 830 1000 850 {W} 820 L{W} {H} L0 {H} Z" fill="#e8c890"/>'
    s += '<path d="M230 1000 C240 860 250 760 300 650" stroke="#3b2a1f" stroke-width="14" fill="none" stroke-linecap="round"/>'
    for a, b in [("M300 650 C360 600 430 610 470 640", ""), ("M300 650 C250 590 180 590 140 620", ""), ("M300 650 C320 580 300 530 260 510", ""), ("M300 650 C380 640 420 690 430 730", ""), ("M300 650 C230 660 190 710 190 750", "")]:
        s += f'<path d="{a}" stroke="#2f4a2a" stroke-width="16" fill="none" stroke-linecap="round"/>'
    s += '<path d="M1300 860 l60 -40 l60 40 z" fill="#d95f43"/><rect x="1357" y="820" width="6" height="60" fill="#6b4a33"/>'
    return s + '</svg>'

def volcanoes():
    s = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" preserveAspectRatio="xMidYMax slice">'
    s += '<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7a8cc9"/><stop offset=".55" stop-color="#e9b6c4"/><stop offset="1" stop-color="#ffe0bf"/></linearGradient><linearGradient id="mist" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity="0"/><stop offset="1" stop-color="#ffffff" stop-opacity=".55"/></linearGradient></defs>'
    s += f'<rect width="{W}" height="{H}" fill="url(#sky)"/>'
    s += '<path d="M120 640 L430 300 L470 290 L780 640 Z" fill="#5a5f8f"/><path d="M560 640 L900 220 L950 215 L1300 640 Z" fill="#4c5183"/><path d="M1080 640 L1340 360 L1370 355 L1640 640 Z" fill="#5a5f8f"/>'
    s += '<path d="M900 220 L950 215 L990 270 L860 272 Z" fill="#e8e6f2" opacity=".85"/>'
    s += f'<rect y="520" width="{W}" height="160" fill="url(#mist)"/>'
    d, p = hill(660, 40, 21); s += f'<path d="{d}" fill="#4f8a5c"/>'
    r = random.Random(8)
    for _ in range(90):
        x = r.uniform(0, W); y = y_on(p, x) + r.uniform(10, 120)
        s += f'<path d="M{x:.0f} {y:.0f} l8 -22 l8 22 z" fill="#3a6f47"/>'
    d, _ = hill(820, 40, 22); s += f'<path d="{d}" fill="#3e7a4e"/>'
    d, _ = hill(930, 30, 23); s += f'<path d="{d}" fill="#2f6340"/>'
    return s + '</svg>'

for name, fn in [("kigali-hills", kigali_day), ("kigali-night", kigali_night), ("kivu-beach", beach), ("virunga", volcanoes)]:
    open(os.path.join(out, name + ".svg"), "w").write(fn())

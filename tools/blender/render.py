# BuPulse Video Studio, premium 3D (docs/BLENDER.md): renders one scene JSON with Blender (Eevee) to an MP4.
#
#   /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P tools/blender/render.py -- \
#       --scene scene.json --out clip.mp4 [--stills 0.1,0.5,0.9 --stills-dir dir] [--fonts-dir dir] [--base-dir dir]
#
# The scene is data written by Claude (or by hand), already checked by tools/blender/scene.ts; this script still applies
# safe defaults and limits to every field so a hand-written scene cannot break it. Everything is deterministic: random
# numbers come from the scene's seed, and every animated value is computed in Python and keyed on every frame.
# Progress lines for the job runner (video-lab/blender-jobs.ts): "BLENDER_PROGRESS <frame> <total>" and
# "BLENDER_DONE <path>" on stdout.
import argparse
import json
import math
import os
import random
import sys
import time

import bmesh
import bpy
from bpy_extras import anim_utils
from mathutils import Euler, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))

RATIOS = {"9:16": (9, 16), "3:4": (3, 4), "4:5": (4, 5), "1:1": (1, 1), "4:3": (4, 3), "16:9": (16, 9)}
QUALITIES = {"480p": 480, "540p": 540, "720p": 720, "1080p": 1080}
FONTS = {
    "inter": "inter-latin-800-normal.woff2",
    "poppins": "poppins-latin-800-normal.woff2",
    "nunito": "nunito-latin-800-normal.woff2",
    "space-grotesk": "space-grotesk-latin-700-normal.woff2",
    "anton": "anton-latin-400-normal.woff2",
    "playfair": "playfair-display-latin-700-normal.woff2",
    "dm-serif": "dm-serif-display-latin-400-normal.woff2",
}
MATERIALS = ("metal", "glass", "matte", "gloss", "neon", "chrome")


# ---------------------------------------------------------------- small helpers


def clamp(v, lo, hi):
    return max(lo, min(hi, v))


def num(v, default, lo, hi):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return default
    if math.isnan(f) or math.isinf(f):
        return default
    return clamp(f, lo, hi)


def pick(v, options, default):
    return v if v in options else default


def vec3(v, default):
    if isinstance(v, (list, tuple)) and len(v) == 3:
        return tuple(num(x, d, -50, 50) for x, d in zip(v, default))
    return tuple(default)


def hex_rgb(h, default="#ffffff"):
    """'#rrggbb' (or '#rgb') to linear RGB, as Blender colours are linear."""
    s = h if isinstance(h, str) else default
    s = s.strip().lstrip("#")
    if len(s) == 3:
        s = "".join(c * 2 for c in s)
    try:
        r, g, b = (int(s[i : i + 2], 16) / 255 for i in (0, 2, 4))
    except ValueError:
        return hex_rgb(default)

    def lin(c):
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

    return (lin(r), lin(g), lin(b))


def rgba(h, default="#ffffff"):
    return (*hex_rgb(h, default), 1.0)


def ease(kind, t):
    """The studio's easing curves (lib/video-engine/animate.ts, `ease`)."""
    x = clamp(t, 0.0, 1.0)
    if kind == "linear":
        return x
    if kind == "in":
        return x * x * x
    if kind == "out":
        return 1 - (1 - x) ** 3
    if kind == "back":
        c1 = 1.70158
        return 1 + (c1 + 1) * (x - 1) ** 3 + c1 * (x - 1) ** 2
    if kind == "elastic":
        if x in (0.0, 1.0):
            return x
        return 2 ** (-10 * x) * math.sin((x * 10 - 0.75) * (2 * math.pi / 3)) + 1
    if kind == "bounce":
        n1, d1 = 7.5625, 2.75
        if x < 1 / d1:
            return n1 * x * x
        if x < 2 / d1:
            x -= 1.5 / d1
            return n1 * x * x + 0.75
        if x < 2.5 / d1:
            x -= 2.25 / d1
            return n1 * x * x + 0.9375
        x -= 2.625 / d1
        return n1 * x * x + 0.984375
    return 4 * x * x * x if x < 0.5 else 1 - (-2 * x + 2) ** 3 / 2


def bake(owner, path, values_by_frame, start=1):
    """Keys `owner.<path>` (an ID such as an object or camera; the path may be dotted) on every frame:
    values_by_frame[i] is the value (a tuple for vectors) at frame start + i."""
    first = values_by_frame[0]
    width = len(first) if isinstance(first, (tuple, list)) else 1
    head, _, attr = path.rpartition(".")
    holder = owner.path_resolve(head) if head else owner
    current = getattr(holder, attr)
    setattr(holder, attr, bool(first) if isinstance(current, bool) else first)
    owner.keyframe_insert(path, frame=start)
    ad = owner.animation_data
    bag = anim_utils.action_get_channelbag_for_slot(ad.action, ad.action_slot)
    for i in range(width):
        fc = bag.fcurves.find(path, index=i)
        pts = fc.keyframe_points
        if len(values_by_frame) > 1:
            pts.add(len(values_by_frame) - 1)
        co = []
        for f, v in enumerate(values_by_frame):
            co += [start + f, v[i] if width > 1 else v]
        pts.foreach_set("co", co)
        pts.foreach_set("interpolation", [1] * len(pts))  # LINEAR between exact per-frame values
        fc.update()


# ---------------------------------------------------------------- defaults (mirrors tools/blender/scene.ts)


def normalize(raw):
    s = raw if isinstance(raw, dict) else {}
    canvas = s.get("canvas") or {}
    out = {
        "canvas": {
            "ratio": pick(canvas.get("ratio"), RATIOS, "9:16"),
            "quality": pick(canvas.get("quality"), QUALITIES, "540p"),
            "fps": int(pick(canvas.get("fps"), (24, 25, 30), 24)),
            "samples": int(num(canvas.get("samples"), 16, 1, 128)),
        },
        "duration": num(s.get("duration"), 4, 1, 15),
        "seed": int(num(s.get("seed"), 1, 0, 1_000_000)),
    }
    bg = s.get("background") or {}
    kind = pick(bg.get("kind"), ("solid", "gradient", "studio"), "studio")
    colors = [c for c in (bg.get("colors") or []) if isinstance(c, str)][:2] or ["#1a1d24", "#3a4255"]
    if len(colors) == 1:
        colors.append(colors[0])
    floor = bg.get("floor") or {}
    light = bg.get("light") or {}
    out["background"] = {
        "kind": kind,
        "colors": colors,
        "floor": {"color": floor.get("color") if isinstance(floor.get("color"), str) else colors[0], "reflect": num(floor.get("reflect"), 0.55, 0, 1)},
        "light": {
            "preset": pick(light.get("preset"), ("studio", "soft", "dramatic", "warm"), "studio"),
            "intensity": num(light.get("intensity"), 1, 0.2, 3),
            "rim": light.get("rim") if isinstance(light.get("rim"), str) else "#bcd4ff",
            "side": pick(light.get("side"), ("left", "right"), "left"),
        },
    }
    cam = s.get("camera") or {}
    out["camera"] = {
        "move": pick(cam.get("move"), ("static", "orbitLeft", "orbitRight", "dollyIn", "dollyOut", "craneUp", "craneDown", "pushPull"), "orbitRight"),
        "intensity": num(cam.get("intensity"), 0.5, 0, 1),
        "ease": pick(cam.get("ease"), ("linear", "in", "out", "inOut", "back", "elastic", "bounce"), "inOut"),
        "target": vec3(cam.get("target"), (0, 0, 1.6)),
        "distance": num(cam.get("distance"), 8, 2, 20),
        "height": num(cam.get("height"), 1.8, -2, 10),
        "lens": num(cam.get("lens"), 50, 18, 135),
        "fstop": num(cam.get("fstop"), 0, 0, 32),
    }
    p = s.get("product")
    if isinstance(p, dict) and (p.get("image") or p.get("cutout")):
        out["product"] = {
            "image": p.get("image") if isinstance(p.get("image"), str) else None,
            "cutout": p.get("cutout") if isinstance(p.get("cutout"), str) else None,
            "shape": pick(p.get("shape"), ("card", "box"), "card"),
            "height": num(p.get("height"), 2.4, 0.3, 6),
            "position": vec3(p.get("position"), (0, 0, 0)),
            "radius": num(p.get("radius"), 0.08, 0, 0.5),
            "frame": p.get("frame") if isinstance(p.get("frame"), str) else "#f4f4f4",
            **motion(p, "rise", "float"),
        }
    else:
        out["product"] = None
    out["texts"] = []
    for t in (s.get("texts") or [])[:6]:
        if not isinstance(t, dict) or not isinstance(t.get("text"), str) or not t["text"].strip():
            continue
        out["texts"].append(
            {
                "text": t["text"][:60],
                "font": pick(t.get("font"), FONTS, "anton"),
                "size": num(t.get("size"), 0.6, 0.1, 3),
                "position": vec3(t.get("position"), (0, 0, 3)),
                "rotation": num(t.get("rotation"), 0, -90, 90),
                "depth": num(t.get("depth"), 0.25, 0, 1),
                "bevel": num(t.get("bevel"), 0.5, 0, 1),
                "material": pick(t.get("material"), MATERIALS, "metal"),
                "color": t.get("color") if isinstance(t.get("color"), str) else "#ffffff",
                "face": num(t.get("face"), 0.6, 0, 1),
                **motion(t, "spinIn", "none"),
            }
        )
    out["props"] = []
    for pr in (s.get("props") or [])[:12]:
        if not isinstance(pr, dict):
            continue
        out["props"].append(
            {
                "kind": pick(pr.get("kind"), ("sphere", "box", "ring", "cylinder", "plinth"), "sphere"),
                "position": vec3(pr.get("position"), (0, 0, 0)),
                "size": num(pr.get("size"), 0.5, 0.05, 6),
                "height": num(pr.get("height"), 0, 0, 6),
                "material": pick(pr.get("material"), MATERIALS, "gloss"),
                "color": pr.get("color") if isinstance(pr.get("color"), str) else "#ffffff",
                **motion(pr, "none", "none"),
            }
        )
    out["particles"] = []
    for pa in (s.get("particles") or [])[:3]:
        if not isinstance(pa, dict):
            continue
        out["particles"].append(
            {
                "kind": pick(pa.get("kind"), ("confetti", "sparkles", "bubbles", "dust"), "sparkles"),
                "count": int(num(pa.get("count"), 40, 1, 150)),
                "colors": [c for c in (pa.get("colors") or []) if isinstance(c, str)][:5] or ["#ffffff"],
                "size": num(pa.get("size"), 1, 0.2, 4),
                "speed": num(pa.get("speed"), 1, 0, 3),
                "center": vec3(pa.get("center"), (0, 0, 2.5)),
                "area": vec3(pa.get("area"), (6, 4, 6)),
                "seed": int(num(pa.get("seed"), out["seed"], 0, 1_000_000)),
            }
        )
    look = s.get("look") or {}
    out["look"] = {
        "contrast": pick(look.get("contrast"), ("base", "medium", "high", "punchy"), "medium"),
        "exposure": num(look.get("exposure"), 0, -3, 3),
        "bloom": num(look.get("bloom"), 0.3, 0, 1),
    }
    sound = s.get("sound") or {}
    out["sound"] = {
        # Paths only in hand-written scenes; the studio passes them as --audio and --music (checked by the job runner).
        "voice": sound.get("voice") if isinstance(sound.get("voice"), str) else None,
        "music": sound.get("music") if isinstance(sound.get("music"), str) else None,
        "voiceAt": num(sound.get("voiceAt"), 0.3, 0, 15),
        "voiceVolume": num(sound.get("voiceVolume"), 1, 0, 2),
        # None: 0.18 under a voice, 0.7 for music alone (decided in add_sound).
        "musicVolume": None if sound.get("musicVolume") is None else num(sound.get("musicVolume"), 0.18, 0, 1),
    }
    return out


def motion(o, enter_default, idle_default):
    return {
        "enter": pick(o.get("enter"), ("none", "spinIn", "rise", "drop", "scale", "pop"), enter_default),
        "enterAt": num(o.get("enterAt"), 0, 0, 15),
        "enterFor": num(o.get("enterFor"), 0.9, 0.1, 5),
        "idle": pick(o.get("idle"), ("none", "float", "turntable", "swing", "spin"), idle_default),
        "spin": num(o.get("spin"), 1, 0, 4),
        "angle": num(o.get("angle"), 30, 5, 360),
    }


# ---------------------------------------------------------------- materials


def principled(name, color="#ffffff", metallic=0.0, roughness=0.5, coat=0.0, transmission=0.0, emission=None, strength=0.0):
    m = bpy.data.materials.new(name)
    nodes = m.node_tree.nodes
    b = nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = rgba(color)
    b.inputs["Metallic"].default_value = metallic
    b.inputs["Roughness"].default_value = roughness
    b.inputs["Coat Weight"].default_value = coat
    b.inputs["Coat Roughness"].default_value = 0.05
    b.inputs["Transmission Weight"].default_value = transmission
    if emission:
        b.inputs["Emission Color"].default_value = rgba(emission)
        b.inputs["Emission Strength"].default_value = strength
    return m, b


def surface(kind, color, name):
    """The studio's surface presets for 3D text and props."""
    if kind == "metal":
        m, _ = principled(name, color, metallic=1.0, roughness=0.22)
    elif kind == "chrome":
        m, _ = principled(name, color, metallic=1.0, roughness=0.06)
    elif kind == "glass":
        m, b = principled(name, color, roughness=0.04, transmission=1.0)
        b.inputs["IOR"].default_value = 1.45
        m.use_raytrace_refraction = True
        m.surface_render_method = "BLENDED"
        m.use_transparent_shadow = True
    elif kind == "matte":
        m, b = principled(name, color, roughness=0.6)
        b.inputs["Specular IOR Level"].default_value = 0.3
    elif kind == "neon":
        m, _ = principled(name, "#111111", roughness=0.3, emission=color, strength=6.0)
    else:  # gloss: lacquered plastic
        m, _ = principled(name, color, roughness=0.18, coat=1.0)
    return m


def photo_material(name, path, cutout):
    m, b = principled(name, "#ffffff", roughness=0.4)  # no clear coat: its streaks hid the photo
    nodes, links = m.node_tree.nodes, m.node_tree.links
    tex = nodes.new("ShaderNodeTexImage")
    tex.image = bpy.data.images.load(path, check_existing=True)
    tex.interpolation = "Cubic"
    tex.extension = "EXTEND"
    links.new(tex.outputs["Color"], b.inputs["Base Color"])
    if cutout:
        links.new(tex.outputs["Alpha"], b.inputs["Alpha"])
        m.use_transparent_shadow = True
        m.surface_render_method = "DITHERED"
    # A little self-light keeps the photo's own colours readable whatever the light.
    links.new(tex.outputs["Color"], b.inputs["Emission Color"])
    b.inputs["Emission Strength"].default_value = 0.18
    return m, tex.image


# ---------------------------------------------------------------- meshes


def link(obj):
    bpy.context.scene.collection.objects.link(obj)
    return obj


def rounded_rect(w, h, r, seg=8):
    """Outline of a rounded rectangle in the XZ plane, centred on x = 0, bottom at z = 0, counter-clockwise."""
    r = min(r, w / 2, h / 2)
    pts = []
    corners = [(w / 2 - r, h - r, 0), (-w / 2 + r, h - r, 90), (-w / 2 + r, r, 180), (w / 2 - r, r, 270)]
    for cx, cz, a0 in corners:
        for i in range(seg + 1):
            a = math.radians(a0 + 90 * i / seg)
            pts.append((cx + r * math.cos(a), cz + r * math.sin(a)))
    return pts


def slab(name, w, h, thick, radius, front_mat, side_mat):
    """A rounded card (or box): the photo on the front and back faces (UV 0..1), the side material around."""
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")
    outline = rounded_rect(w, h, radius * min(w, h))
    front = [bm.verts.new((x, -thick / 2, z)) for x, z in outline]
    back = [bm.verts.new((x, thick / 2, z)) for x, z in outline]
    f_front = bm.faces.new(front)
    f_back = bm.faces.new(back)
    for f, mirror in ((f_front, False), (f_back, True)):
        f.material_index = 0
        for loop in f.loops:
            x, _, z = loop.vert.co
            u = (x + w / 2) / w
            loop[uv].uv = ((1 - u) if mirror else u, z / h)
    n = len(outline)
    for i in range(n):
        j = (i + 1) % n
        f = bm.faces.new((front[i], front[j], back[j], back[i]))
        f.material_index = 1
        f.smooth = True
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(front_mat)
    me.materials.append(side_mat)
    obj = link(bpy.data.objects.new(name, me))
    bev = obj.modifiers.new("edge", "BEVEL")
    bev.width = min(0.02, thick * 0.3)
    bev.segments = 3
    bev.limit_method = "ANGLE"
    bev.harden_normals = False
    return obj


def bowl(name, mat, radius=16.0, curve=5.0, wall=30.0, seg=128):
    """An infinite studio sweep all around: a round floor curving up into a wall, so the camera can orbit anywhere."""
    profile = [(0.0, 0.0)]
    for i in range(1, 9):
        profile.append((radius * i / 8, 0.0))
    for i in range(1, 13):
        a = math.radians(90 * i / 12)
        profile.append((radius + curve * math.sin(a), curve * (1 - math.cos(a))))
    profile.append((radius + curve, wall))
    bm = bmesh.new()
    rings = []
    for k in range(seg):
        a = 2 * math.pi * k / seg
        rings.append([bm.verts.new((rr * math.cos(a), rr * math.sin(a), z)) for rr, z in profile])
    for k in range(seg):
        r0, r1 = rings[k], rings[(k + 1) % seg]
        for i in range(len(profile) - 1):
            f = bm.faces.new((r0[i], r0[i + 1], r1[i + 1], r1[i]))
            f.smooth = True
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    # Normals must face inwards (towards the camera inside the bowl): flip if the floor points down.
    bm.normal_update()
    floor_face = min(bm.faces, key=lambda f: f.calc_center_median().length)
    if floor_face.normal.z < 0:
        bmesh.ops.reverse_faces(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mat)
    return link(bpy.data.objects.new(name, me))


def backdrop_material(bg):
    """Floor and wall: lit, with the reflectivity of the floor; gradient by height for the gradient kind."""
    c0, c1 = bg["colors"]
    floor = bg["floor"]
    m, b = principled("Backdrop", floor["color"], roughness=0.62 - 0.56 * floor["reflect"], coat=0.0)
    nodes, links = m.node_tree.nodes, m.node_tree.links
    b.inputs["Specular IOR Level"].default_value = 0.5 + 0.5 * floor["reflect"]
    coord = nodes.new("ShaderNodeTexCoord")
    sep = nodes.new("ShaderNodeSeparateXYZ")
    rng = nodes.new("ShaderNodeMapRange")
    ramp = nodes.new("ShaderNodeValToRGB")
    links.new(coord.outputs["Object"], sep.inputs["Vector"])
    links.new(sep.outputs["Z"], rng.inputs["Value"])
    rng.inputs["From Min"].default_value = 0.0
    rng.inputs["From Max"].default_value = 14.0
    links.new(rng.outputs["Result"], ramp.inputs["Fac"])
    els = ramp.color_ramp.elements
    els[0].position = 0.0
    els[0].color = rgba(floor["color"])
    els[1].position = 1.0
    if bg["kind"] == "gradient":
        els.new(0.08).color = rgba(c0)
        els[-1].color = rgba(c1)
    else:
        els.new(0.08).color = rgba(c0)
        els[-1].color = rgba(c0)
    links.new(ramp.outputs["Color"], b.inputs["Base Color"])
    # A faint glow of its own colour so dark brand colours stay that colour instead of black.
    links.new(ramp.outputs["Color"], b.inputs["Emission Color"])
    b.inputs["Emission Strength"].default_value = 0.12
    if bg["kind"] == "studio":
        # The studio glow: a soft pool of the second colour on the wall behind the product (in front of the camera's
        # starting place), drawn as light so the brand colour stays exact, and mirrored by the floor.
        dist = nodes.new("ShaderNodeVectorMath")
        dist.operation = "DISTANCE"
        dist.inputs[1].default_value = (0.0, 21.0, 6.0)
        links.new(coord.outputs["Object"], dist.inputs[0])
        fall = nodes.new("ShaderNodeMapRange")
        fall.inputs["From Min"].default_value = 0.0
        fall.inputs["From Max"].default_value = 11.0
        fall.inputs["To Min"].default_value = 1.0
        fall.inputs["To Max"].default_value = 0.0
        links.new(dist.outputs["Value"], fall.inputs["Value"])
        soft = nodes.new("ShaderNodeMath")
        soft.operation = "POWER"
        soft.inputs[1].default_value = 2.0
        links.new(fall.outputs["Result"], soft.inputs[0])
        mix = nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        links.new(soft.outputs[0], mix.inputs["Factor"])
        links.new(ramp.outputs["Color"], mix.inputs["A"])
        mix.inputs["B"].default_value = rgba(c1)
        links.new(mix.outputs["Result"], b.inputs["Emission Color"])
        strength = nodes.new("ShaderNodeMath")
        strength.operation = "MULTIPLY_ADD"
        strength.inputs[1].default_value = 1.6 * bg["light"]["intensity"]
        strength.inputs[2].default_value = 0.12
        links.new(soft.outputs[0], strength.inputs[0])
        links.new(strength.outputs[0], b.inputs["Emission Strength"])
    return m


# ---------------------------------------------------------------- world, lights, look


def setup_world(bg):
    """An "HDRI-like" studio sky, seen only in reflections (the camera is inside the backdrop): dark below, the backdrop
    colour around the horizon and three tall softboxes, so metal, chrome and glass have bright shapes to mirror."""
    w = bpy.data.worlds.new("World")
    bpy.context.scene.world = w
    nodes, links = w.node_tree.nodes, w.node_tree.links
    out_bg = nodes["Background"]
    coord = nodes.new("ShaderNodeTexCoord")
    sep = nodes.new("ShaderNodeSeparateXYZ")
    links.new(coord.outputs["Generated"], sep.inputs["Vector"])
    # Height gradient: floor dark, horizon in the backdrop colour, sky a soft grey.
    rng = nodes.new("ShaderNodeMapRange")
    rng.inputs["From Min"].default_value = -1.0
    links.new(sep.outputs["Z"], rng.inputs["Value"])
    ramp = nodes.new("ShaderNodeValToRGB")
    links.new(rng.outputs["Result"], ramp.inputs["Fac"])
    els = ramp.color_ramp.elements
    els[0].color = (0.004, 0.004, 0.005, 1)
    els[1].color = (0.35, 0.36, 0.38, 1)
    els.new(0.5).color = rgba(bg["colors"][0])
    # Softboxes: vertical bands of light at three azimuths, between 5 and 60 degrees up.
    atan = nodes.new("ShaderNodeMath")
    atan.operation = "ARCTAN2"
    links.new(sep.outputs["Y"], atan.inputs[0])
    links.new(sep.outputs["X"], atan.inputs[1])
    wave = nodes.new("ShaderNodeMath")
    wave.operation = "SINE"
    times = nodes.new("ShaderNodeMath")
    times.operation = "MULTIPLY"
    times.inputs[1].default_value = 3.0
    links.new(atan.outputs[0], times.inputs[0])
    links.new(times.outputs[0], wave.inputs[0])
    strip = nodes.new("ShaderNodeMapRange")
    strip.inputs["From Min"].default_value = 0.82
    strip.inputs["From Max"].default_value = 0.9
    links.new(wave.outputs[0], strip.inputs["Value"])
    band_lo = nodes.new("ShaderNodeMapRange")
    band_lo.inputs["From Min"].default_value = 0.05
    band_lo.inputs["From Max"].default_value = 0.12
    links.new(sep.outputs["Z"], band_lo.inputs["Value"])
    band_hi = nodes.new("ShaderNodeMapRange")
    band_hi.inputs["From Min"].default_value = 0.9
    band_hi.inputs["From Max"].default_value = 0.8
    links.new(sep.outputs["Z"], band_hi.inputs["Value"])
    m1 = nodes.new("ShaderNodeMath")
    m1.operation = "MULTIPLY"
    links.new(band_lo.outputs["Result"], m1.inputs[0])
    links.new(band_hi.outputs["Result"], m1.inputs[1])
    m2 = nodes.new("ShaderNodeMath")
    m2.operation = "MULTIPLY"
    links.new(m1.outputs[0], m2.inputs[0])
    links.new(strip.outputs["Result"], m2.inputs[1])
    mix = nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    links.new(m2.outputs[0], mix.inputs["Factor"])
    links.new(ramp.outputs["Color"], mix.inputs["A"])
    mix.inputs["B"].default_value = (6.0, 6.0, 6.2, 1)
    links.new(mix.outputs["Result"], out_bg.inputs["Color"])
    out_bg.inputs["Strength"].default_value = 0.5


def area(name, loc, target, energy, size, color=(1, 1, 1), shape="RECTANGLE", size_y=None):
    lt = bpy.data.lights.new(name, "AREA")
    lt.energy = energy
    lt.color = color
    lt.shape = shape
    lt.size = size
    if size_y:
        lt.size_y = size_y
    obj = link(bpy.data.objects.new(name, lt))
    obj.location = loc
    look_at(obj, Vector(target))
    return obj


def look_at(obj, target):
    d = Vector(target) - obj.location
    obj.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()


def exclude_backdrop(light_obj):
    """Light linking: this light skips the floor and wall (no long streaks of its reflection on a glossy floor)."""
    backdrop = bpy.data.objects.get("Backdrop")
    if not backdrop:
        return
    coll = bpy.data.collections.get("NotBackdrop") or bpy.data.collections.new("NotBackdrop")
    if backdrop.name not in coll.objects:
        coll.objects.link(backdrop)
        # Entries follow coll.objects, which holds only the backdrop.
        coll.collection_objects[0].light_linking.link_state = "EXCLUDE"
    light_obj.light_linking.receiver_collection = coll


def setup_lights(bg, target):
    L = bg["light"]
    k = L["intensity"]
    side = -1 if L["side"] == "left" else 1
    warm = hex_rgb("#ffe0b5") if L["preset"] == "warm" else (1.0, 0.98, 0.95)
    key_e, fill_e, rim_e, top_e = {
        "studio": (900, 260, 900, 250),
        "soft": (600, 520, 420, 420),
        "dramatic": (1300, 40, 1500, 80),
        "warm": (950, 220, 700, 220),
    }[L["preset"]]
    t = Vector(target)
    # Only the key and the top light cast shadows: soft shadows from every light cost the most render time.
    area("Key", (side * 4.5, -4.5, 6.5), t, key_e * k, 3.5, warm)
    area("Top", (0, 0.5, 9), (0, 0.5, 0), top_e * k, 5.0)
    fill = area("Fill", (-side * 6.0, -4.0, 2.5), t, fill_e * k, 5.0)
    fill.data.use_shadow = False
    for name, x in (("RimL", -3.0), ("RimR", 3.0)):
        # Nearly level and with a grid (spread), so the edge light lands on the subject, not on the floor by the camera.
        rim = area(name, (x, 4.0, t.z + 1.2), t + Vector((0, 0, 0.8)), rim_e * 0.5 * k, 0.8, hex_rgb(L["rim"]), size_y=4)
        rim.data.use_shadow = False
        rim.data.spread = math.radians(50)
        exclude_backdrop(rim)


def setup_look(look):
    s = bpy.context.scene
    vs = s.view_settings
    vs.view_transform = "AgX"
    vs.look = {"base": "AgX - Base Contrast", "medium": "AgX - Medium High Contrast", "high": "AgX - High Contrast", "punchy": "AgX - Punchy"}[look["contrast"]]
    vs.exposure = look["exposure"]
    if look["bloom"] <= 0:
        return
    try:
        tree = bpy.data.node_groups.new("Look", "CompositorNodeTree")
        tree.interface.new_socket("Image", in_out="OUTPUT", socket_type="NodeSocketColor")
        s.compositing_node_group = tree
        rl = tree.nodes.new("CompositorNodeRLayers")
        glare = tree.nodes.new("CompositorNodeGlare")
        glare.inputs["Type"].default_value = "Bloom"
        glare.inputs["Quality"].default_value = "Medium"
        glare.inputs["Threshold"].default_value = 0.85
        glare.inputs["Strength"].default_value = 0.5 * look["bloom"]
        glare.inputs["Size"].default_value = 0.6
        out = tree.nodes.new("NodeGroupOutput")
        tree.links.new(rl.outputs["Image"], glare.inputs["Image"])
        tree.links.new(glare.outputs["Image"], out.inputs[0])
    except Exception as e:  # the look is a bonus: never fail a render over it
        print(f"BLENDER_WARN bloom skipped: {e}", flush=True)


# ---------------------------------------------------------------- animation


def motion_at(m, t, duration, base_loc, base_rot, phase=0.0):
    """Location, rotation (radians) and scale of an object with an entrance and an idle motion at time t (seconds)."""
    loc = Vector(base_loc)
    rot = Euler(base_rot)
    sc = 1.0
    hidden = False
    e_raw = (t - m["enterAt"]) / m["enterFor"]
    if m["enter"] != "none":
        if e_raw < 0:
            hidden = True
        e = clamp(e_raw, 0, 1)
        if m["enter"] == "spinIn":
            rot.z += (1 - ease("out", e)) * math.radians(-160)
            sc *= 0.35 + 0.65 * ease("back", e)
        elif m["enter"] == "rise":
            loc.z -= (1 - ease("out", e)) * 1.2
            sc *= 0.7 + 0.3 * ease("out", e)
        elif m["enter"] == "drop":
            loc.z += (1 - ease("bounce", e)) * 3.0
        elif m["enter"] == "scale":
            sc *= ease("out", e)
        elif m["enter"] == "pop":
            sc *= ease("back", e)
    idle = m["idle"]
    tt = t + phase
    if idle == "float":
        loc.z += 0.07 * math.sin(2 * math.pi * tt / 2.6)
        rot.z += math.radians(5) * math.sin(2 * math.pi * tt / 4.1)
        rot.x += math.radians(1.5) * math.sin(2 * math.pi * tt / 3.3)
    elif idle == "swing":
        rot.z += math.radians(m["angle"]) * math.sin(2 * math.pi * m["spin"] * t / duration)
    elif idle == "turntable":
        rot.z += math.radians(360) * m["spin"] * t / duration
    elif idle == "spin":
        rot.z += math.radians(m["angle"]) * m["spin"] * t
    return loc, rot, max(sc, 0.0001), hidden


def animate(obj, m, duration, fps, frames, phase=0.0, cam_path=None, face=0.0):
    """Keys an object's entrance and idle motion. With `face` > 0 it also turns that share of the way towards the
    camera on every frame (`cam_path`: the camera position per frame), so 3D text stays readable while the camera
    orbits and its sides still show."""
    base_loc = tuple(obj.location)
    base_rot = tuple(obj.rotation_euler)
    base_scale = tuple(obj.scale)
    locs, rots, scs, hides = [], [], [], []
    for f in range(frames):
        loc, rot, sc, hidden = motion_at(m, f / fps, duration, base_loc, base_rot, phase)
        if face and cam_path:
            to_cam = cam_path[f] - Vector(base_loc)
            rot.z += face * math.atan2(to_cam.x, -to_cam.y)
        locs.append(tuple(loc))
        rots.append(tuple(rot))
        scs.append(tuple(v * sc for v in base_scale))
        hides.append(hidden)
    bake(obj, "location", locs)
    bake(obj, "rotation_euler", rots)
    bake(obj, "scale", scs)
    if any(hides):
        bake(obj, "hide_render", [float(h) for h in hides])


def camera_at(c, u):
    """Camera position, target and lens at clip progress u (0..1), for the studio's camera moves."""
    I = c["intensity"]
    e = ease(c["ease"], u)
    target = Vector(c["target"])
    d, h, lens, az = c["distance"], c["height"], c["lens"], 0.0
    mv = c["move"]
    half = math.radians(8 + 42 * I)
    if mv == "orbitRight":
        az = -half + 2 * half * e
    elif mv == "orbitLeft":
        az = half - 2 * half * e
    elif mv == "dollyIn":
        d = d * (1 + 0.55 * I) + (d * (1 - 0.12 * I) - d * (1 + 0.55 * I)) * e
    elif mv == "dollyOut":
        d = d * (1 - 0.12 * I) + (d * (1 + 0.55 * I) - d * (1 - 0.12 * I)) * e
    elif mv in ("craneUp", "craneDown"):
        lo, hi = target.z - 1.2 * I, target.z + 0.6 + 3.5 * I
        h = (lo + (hi - lo) * e) if mv == "craneUp" else (hi + (lo - hi) * e)
        h -= target.z  # height is relative below
    elif mv == "pushPull":
        # Dolly zoom: the camera pushes in while the lens widens, so the subject keeps its size and the set stretches.
        nd = d * (1 - 0.5 * I * e)
        lens = lens * nd / d
        d = nd
    if mv in ("craneUp", "craneDown"):
        z = target.z + h
    else:
        z = h
    pos = Vector((target.x + d * math.sin(az), target.y - d * math.cos(az), z))
    return pos, target, lens


def setup_camera(c, frames, fps):
    cam = bpy.data.cameras.new("Camera")
    cam.sensor_fit = "AUTO"
    # Depth of field only when asked (fstop > 0): it costs about a fifth of the render time.
    cam.dof.use_dof = c["fstop"] > 0
    cam.dof.aperture_fstop = max(0.8, c["fstop"])
    obj = link(bpy.data.objects.new("Camera", cam))
    bpy.context.scene.camera = obj
    locs, rots, lenses, focus = [], [], [], []
    for f in range(frames):
        u = f / max(1, frames - 1)
        pos, tgt, lens = camera_at(c, u)
        obj.location = pos
        look_at(obj, tgt)
        locs.append(tuple(pos))
        rots.append(tuple(obj.rotation_euler))
        lenses.append(lens)
        focus.append((tgt - pos).length)
    # Keep rotations continuous (no 360 degree jumps between frames).
    for i in range(1, len(rots)):
        rots[i] = tuple(r + 2 * math.pi * round((p - r) / (2 * math.pi)) for r, p in zip(rots[i], rots[i - 1]))
    bake(obj, "location", locs)
    bake(obj, "rotation_euler", rots)
    bake(cam, "lens", lenses)
    bake(cam, "dof.focus_distance", focus)
    return [Vector(v) for v in locs]


# ---------------------------------------------------------------- objects


def add_product(p, base_dir):
    cutout = bool(p["cutout"]) and os.path.isfile(full_path(p["cutout"], base_dir))
    if p["cutout"] and not cutout:
        print(f"BLENDER_WARN cutout not found, showing the photo on a card: {p['cutout']}", flush=True)
    path = resolve(p["cutout"] if cutout else p["image"], base_dir)
    mat, img = photo_material("Product", path, cutout)
    iw, ih = img.size
    aspect = iw / ih if ih else 1
    h = p["height"]
    w = h * aspect
    if cutout:
        me = bpy.data.meshes.new("Product")
        bm = bmesh.new()
        uv = bm.loops.layers.uv.new("UVMap")
        vs = [bm.verts.new(v) for v in ((-w / 2, 0, 0), (w / 2, 0, 0), (w / 2, 0, h), (-w / 2, 0, h))]
        f = bm.faces.new(vs)
        for loop, co in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
            loop[uv].uv = co
        bm.to_mesh(me)
        bm.free()
        me.materials.append(mat)
        obj = link(bpy.data.objects.new("Product", me))
    else:
        thick = 0.06 if p["shape"] == "card" else w * 0.45
        side = surface("gloss", p["frame"], "ProductFrame")
        obj = slab("Product", w, h, thick, p["radius"], mat, side)
    obj.location = p["position"]
    return obj, (w, h)


def add_text(t, i, fonts_dir):
    cu = bpy.data.curves.new(f"Text{i}", "FONT")
    cu.body = t["text"]
    try:
        cu.font = bpy.data.fonts.load(os.path.join(fonts_dir, FONTS[t["font"]]), check_existing=True)
    except RuntimeError:
        print(f"BLENDER_WARN font {t['font']} not found, using Blender's", flush=True)
    cu.size = t["size"]
    cu.align_x = "CENTER"
    cu.align_y = "CENTER"
    cu.extrude = t["depth"] * t["size"] * 0.5
    cu.bevel_depth = t["bevel"] * t["size"] * 0.035
    cu.bevel_resolution = 3
    cu.offset = -cu.bevel_depth * 0.5
    cu.materials.append(surface(t["material"], t["color"], f"TextMat{i}"))
    obj = link(bpy.data.objects.new(f"Text{i}", cu))
    obj.location = t["position"]
    obj.rotation_euler = (math.radians(90), 0, math.radians(t["rotation"]))
    return obj


def add_prop(pr, i):
    s = pr["size"]
    x, y, z = pr["position"]
    kind = pr["kind"]
    if kind == "sphere":
        bpy.ops.mesh.primitive_uv_sphere_add(segments=48, ring_count=24, radius=s / 2, location=(x, y, z))
    elif kind == "ring":
        bpy.ops.mesh.primitive_torus_add(major_radius=s / 2, minor_radius=s * 0.06, major_segments=72, minor_segments=16, location=(x, y, z), rotation=(math.radians(90), 0, 0))
    elif kind == "box":
        hh = pr["height"] or s
        bpy.ops.mesh.primitive_cube_add(size=1, location=(x, y, z + hh / 2))
        bpy.context.object.scale = (s, s, hh)
    else:  # cylinder and plinth: stand on the floor, top at z + height
        hh = pr["height"] or (s * 0.35 if kind == "plinth" else s)
        bpy.ops.mesh.primitive_cylinder_add(vertices=96, radius=s / 2, depth=hh, location=(x, y, z + hh / 2))
    obj = bpy.context.object
    obj.name = f"Prop{i}"
    bpy.ops.object.shade_smooth()
    if kind in ("box", "cylinder", "plinth"):
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        bev = obj.modifiers.new("edge", "BEVEL")
        bev.width = min(0.04, s * 0.04)
        bev.segments = 4
        bev.limit_method = "ANGLE"
        obj.modifiers.new("weighted", "WEIGHTED_NORMAL")
    obj.data.materials.append(surface(pr["material"], pr["color"], f"PropMat{i}"))
    return obj


def add_particles(pa, j, duration, fps, frames):
    rnd = random.Random(pa["seed"] * 7919 + j)
    cx, cy, cz = pa["center"]
    aw, ad, ah = pa["area"]
    kind = pa["kind"]
    mats = []
    for k, c in enumerate(pa["colors"]):
        if kind == "confetti":
            m = surface("gloss", c, f"Confetti{j}_{k}")
            m.use_backface_culling = False
        elif kind == "bubbles":
            m = surface("glass", c, f"Bubble{j}_{k}")
        else:
            m = surface("neon", c, f"Spark{j}_{k}")
        mats.append(m)
    sz = pa["size"]
    if kind == "confetti":
        base = bpy.data.meshes.new(f"ConfettiMesh{j}")
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        bmesh.ops.scale(bm, vec=(0.13 * sz, 0.07 * sz, 0.004), verts=bm.verts)
        bm.to_mesh(base)
        bm.free()
    else:
        base = bpy.data.meshes.new(f"DotMesh{j}")
        bm = bmesh.new()
        r = {"sparkles": 0.035, "dust": 0.012, "bubbles": 0.09}[kind] * sz
        bmesh.ops.create_icosphere(bm, subdivisions=3 if kind == "bubbles" else 1, radius=r)
        for f in bm.faces:
            f.smooth = True
        bm.to_mesh(base)
        bm.free()
    speed = pa["speed"]
    for n in range(pa["count"]):
        me = base.copy()
        me.materials.append(mats[n % len(mats)])
        obj = link(bpy.data.objects.new(f"P{j}_{n}", me))
        obj.visible_shadow = kind == "confetti"
        x0 = cx + (rnd.random() - 0.5) * aw
        y0 = cy + (rnd.random() - 0.5) * ad
        z0 = rnd.random()
        ph = rnd.random() * 2 * math.pi
        spin = (rnd.random() * 2 - 1) * 6
        fall = (0.35 + rnd.random() * 0.4) * speed
        tw = 1.5 + rnd.random() * 2.5
        locs, rots, scs = [], [], []
        for f in range(frames):
            t = f / fps
            if kind == "confetti":
                zz = (z0 - fall * t / ah * 2.2) % 1.0
                loc = (x0 + 0.25 * math.sin(t * 1.8 + ph), y0, cz - ah / 2 + zz * ah)
                rot = (ph + spin * t, ph * 0.7 + spin * 0.6 * t, ph * 1.3 + t * 2)
                sc = 1.0
            elif kind == "bubbles":
                zz = (z0 + fall * t / ah * 1.4) % 1.0
                loc = (x0 + 0.12 * math.sin(t * 2.2 + ph), y0, cz - ah / 2 + zz * ah)
                rot = (0, 0, 0)
                sc = 0.6 + 0.4 * math.sin(ph) ** 2
            elif kind == "sparkles":
                loc = (x0 + 0.1 * math.sin(t * 0.7 + ph), y0, cz - ah / 2 + z0 * ah + 0.15 * math.sin(t * 0.9 + ph))
                rot = (0, 0, 0)
                sc = max(0.0001, math.sin(t * tw + ph)) ** 1.5
            else:  # dust
                loc = (x0 + 0.3 * math.sin(t * 0.25 * speed + ph), y0 + 0.2 * math.cos(t * 0.2 + ph), cz - ah / 2 + ((z0 + 0.03 * speed * t) % 1.0) * ah)
                rot = (0, 0, 0)
                sc = 0.5 + 0.5 * math.sin(t * 0.8 + ph) ** 2
            locs.append(loc)
            rots.append(rot)
            scs.append((sc, sc, sc))
        bake(obj, "location", locs)
        if kind == "confetti":
            bake(obj, "rotation_euler", rots)
        if kind in ("sparkles", "dust", "bubbles"):
            bake(obj, "scale", scs)


def full_path(path, base_dir):
    return path if os.path.isabs(path) else os.path.join(base_dir, path)


def resolve(path, base_dir):
    if not path:
        raise SystemExit("BLENDER_ERROR the product needs an image or a cutout")
    p = full_path(path, base_dir)
    if not os.path.isfile(p):
        raise SystemExit(f"BLENDER_ERROR image not found: {path}")
    return p


# ---------------------------------------------------------------- main


def build(sc, base_dir, fonts_dir):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    s = bpy.context.scene
    fps = sc["canvas"]["fps"]
    frames = max(2, round(sc["duration"] * fps))
    s.render.fps = fps
    s.frame_start = 1
    s.frame_end = frames
    rw, rh = RATIOS[sc["canvas"]["ratio"]]
    short = QUALITIES[sc["canvas"]["quality"]]
    k = short / min(rw, rh)
    s.render.resolution_x = int(round(rw * k / 2) * 2)
    s.render.resolution_y = int(round(rh * k / 2) * 2)
    s.render.resolution_percentage = 100
    s.render.engine = "BLENDER_EEVEE"
    ee = s.eevee
    ee.taa_render_samples = sc["canvas"]["samples"]
    ee.use_raytracing = True
    ee.ray_tracing_method = "SCREEN"
    ee.ray_tracing_options.resolution_scale = "2"
    ee.use_shadows = True
    ee.shadow_ray_count = 2
    ee.shadow_step_count = 6
    ee.use_fast_gi = True
    s.render.film_transparent = False

    bg = sc["background"]
    setup_world(bg)
    setup_look(sc["look"])
    bowl("Backdrop", backdrop_material(bg))
    # No planar light probe: in Blender 5.2 it hid the objects' reflections on the floor; screen tracing shows them.
    setup_lights(bg, sc["camera"]["target"])
    cam_path = setup_camera(sc["camera"], frames, fps)

    if sc["product"]:
        obj, _ = add_product(sc["product"], base_dir)
        animate(obj, sc["product"], sc["duration"], fps, frames)
    for i, t in enumerate(sc["texts"]):
        animate(add_text(t, i, fonts_dir), t, sc["duration"], fps, frames, phase=i * 0.7, cam_path=cam_path, face=t["face"])
    for i, pr in enumerate(sc["props"]):
        animate(add_prop(pr, i), pr, sc["duration"], fps, frames, phase=i * 1.3)
    for j, pa in enumerate(sc["particles"]):
        add_particles(pa, j, sc["duration"], fps, frames)
    return frames


def add_sound(sc, base_dir, frames):
    """The voice and the music as sound strips in the sequencer, trimmed to the clip: the voice from its cue time, the
    music from the start, low under the voice and faded out over the last half second. Returns True when there is sound.
    Sound-only strips do not replace the 3D render (Blender renders the sequencer only when it has picture strips)."""
    snd = sc["sound"]
    fps = sc["canvas"]["fps"]
    s = bpy.context.scene
    added = False
    for kind in ("music", "voice"):
        path = snd[kind]
        if not path:
            continue
        full = full_path(path, base_dir)
        if not os.path.isfile(full):
            raise SystemExit(f"BLENDER_ERROR {kind} file not found: {path}")
        ed = s.sequence_editor_create()
        start = 1 + (round(snd["voiceAt"] * fps) if kind == "voice" else 0)
        if start > frames:
            print(f"BLENDER_WARN the voice starts after the end of the clip: no voice", flush=True)
            continue
        strip = ed.strips.new_sound(kind, full, channel=1 if kind == "music" else 2, frame_start=start)
        # Trim to the clip (a strip may also be shorter than the clip).
        if strip.right_handle > frames + 1:
            strip.right_handle = frames + 1
        if kind == "voice":
            strip.volume = snd["voiceVolume"]
        else:
            vol = snd["musicVolume"] if snd["musicVolume"] is not None else (0.18 if snd["voice"] else 0.7)
            fade = max(1, round(0.5 * fps))
            end = strip.right_handle
            strip.volume = vol
            strip.keyframe_insert("volume", frame=max(start, end - fade))
            strip.volume = 0.0
            strip.keyframe_insert("volume", frame=end)
            strip.volume = vol
        added = True
    return added


def main():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    ap = argparse.ArgumentParser(prog="render.py")
    ap.add_argument("--scene", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--stills", default="", help="comma-separated clip fractions: render PNG stills instead of the MP4")
    ap.add_argument("--stills-dir", default="")
    ap.add_argument("--fonts-dir", default=os.path.join(REPO, "public", "fonts", "video"))
    ap.add_argument("--base-dir", default=REPO, help="folder that relative image paths start from")
    ap.add_argument("--preview", action="store_true", help="quick look: 480p and 8 samples")
    ap.add_argument("--audio", default="", help="the voice-over (MP3, WAV, M4A...): overrides the scene's sound.voice")
    ap.add_argument("--music", default="", help="the music bed: overrides the scene's sound.music")
    ap.add_argument("--voice-at", type=float, default=None, help="seconds into the clip when the voice starts")
    ap.add_argument("--music-volume", type=float, default=None, help="0 to 1 (default 0.18 under a voice)")
    a = ap.parse_args(argv)
    with open(a.scene, encoding="utf-8") as fh:
        sc = normalize(json.load(fh))
    if a.audio:
        sc["sound"]["voice"] = a.audio
    if a.music:
        sc["sound"]["music"] = a.music
    if a.voice_at is not None:
        sc["sound"]["voiceAt"] = num(a.voice_at, 0.3, 0, 15)
    if a.music_volume is not None:
        sc["sound"]["musicVolume"] = num(a.music_volume, 0.18, 0, 1)
    if a.preview:
        sc["canvas"]["quality"] = "480p"
        sc["canvas"]["samples"] = min(sc["canvas"]["samples"], 8)
    t0 = time.time()
    frames = build(sc, a.base_dir, a.fonts_dir)
    s = bpy.context.scene
    print(f"BLENDER_SCENE {s.render.resolution_x}x{s.render.resolution_y} {frames} frames, built in {time.time() - t0:.1f}s", flush=True)

    if a.stills:
        out_dir = a.stills_dir or os.path.dirname(os.path.abspath(a.out))
        os.makedirs(out_dir, exist_ok=True)
        s.render.image_settings.media_type = "IMAGE"
        s.render.image_settings.file_format = "PNG"
        for frac in [float(x) for x in a.stills.split(",") if x.strip()]:
            f = 1 + round(clamp(frac, 0, 1) * (frames - 1))
            s.frame_set(f)
            s.render.filepath = os.path.join(out_dir, f"still-{int(frac * 100):03d}.png")
            bpy.ops.render.render(write_still=True)
            print(f"BLENDER_PROGRESS {f} {frames}", flush=True)
        print(f"BLENDER_DONE {out_dir} {time.time() - t0:.1f}s", flush=True)
        return

    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    im = s.render.image_settings
    im.media_type = "VIDEO"
    im.file_format = "FFMPEG"
    ff = s.render.ffmpeg
    ff.format = "MPEG4"
    ff.codec = "H264"
    ff.constant_rate_factor = "HIGH"
    ff.ffmpeg_preset = "GOOD"
    ff.gopsize = sc["canvas"]["fps"]
    if add_sound(sc, a.base_dir, frames):
        # Blender's own FFmpeg muxes the mixed sound into the MP4: AAC, stereo, 48 kHz.
        ff.audio_codec = "AAC"
        ff.audio_bitrate = 160
        ff.audio_channels = "STEREO"
        ff.audio_mixrate = 48000
        s.render.use_sequencer = True
        print(f"BLENDER_SOUND voice={bool(sc['sound']['voice'])} music={bool(sc['sound']['music'])}", flush=True)
    else:
        ff.audio_codec = "NONE"
    s.render.filepath = os.path.abspath(a.out)
    s.render.use_file_extension = False

    def progress(scene, *_):
        print(f"BLENDER_PROGRESS {scene.frame_current} {frames}", flush=True)

    bpy.app.handlers.render_write.append(progress)
    bpy.ops.render.render(animation=True)
    print(f"BLENDER_DONE {os.path.abspath(a.out)} {time.time() - t0:.1f}s", flush=True)


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as e:
        print(f"BLENDER_ERROR {type(e).__name__}: {e}", flush=True)
        sys.exit(1)

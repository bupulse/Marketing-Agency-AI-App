# Pulls PNG frames out of a rendered MP4 with Blender's video sequencer (no ffmpeg needed), to check the real video
# by eye (docs/BLENDER.md):
#   /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -noaudio -P tools/blender/frames.py -- \
#       --video clip.mp4 --at 0.1,0.5,0.95 --out-dir frames/
import argparse
import os
import sys

import bpy


def main():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    ap = argparse.ArgumentParser(prog="frames.py")
    ap.add_argument("--video", required=True)
    ap.add_argument("--at", default="0.1,0.5,0.95", help="comma-separated fractions of the video")
    ap.add_argument("--out-dir", required=True)
    a = ap.parse_args(argv)
    os.makedirs(a.out_dir, exist_ok=True)
    s = bpy.context.scene
    ed = s.sequence_editor_create()
    strip = ed.strips.new_movie("clip", os.path.abspath(a.video), channel=1, frame_start=1)
    frames = strip.frame_final_duration
    w, h = strip.elements[0].orig_width, strip.elements[0].orig_height
    s.render.resolution_x, s.render.resolution_y, s.render.resolution_percentage = w, h, 100
    s.frame_start, s.frame_end = 1, frames
    s.render.image_settings.file_format = "PNG"
    s.view_settings.view_transform = "Standard"  # the video is already display colour: no second tone mapping
    s.view_settings.look = "None"
    stem = os.path.splitext(os.path.basename(a.video))[0]
    for frac in [float(x) for x in a.at.split(",") if x.strip()]:
        f = 1 + round(max(0.0, min(1.0, frac)) * (frames - 1))
        s.frame_set(f)
        s.render.filepath = os.path.join(a.out_dir, f"{stem}-{int(frac * 100):03d}.png")
        bpy.ops.render.render(write_still=True)
    print(f"FRAMES {frames} frames {w}x{h} -> {a.out_dir}", flush=True)


main()

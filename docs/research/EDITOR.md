# Editor research (prep for the Training Lab editor, board task 10)

Written 24 October 2026. Goal: an in-house browser editor for a finished reel, built on our own spec and encoder so the
Video Studio (studio.bupulse.com) can reuse it. No app is reverse engineered: section 2 is public feature knowledge
only (CapCut's help center and feature pages, Remotion, OpenShot, Shotcut), written from memory of those public pages,
not fetched or copied. `lib/video-engine/spec.ts`, `encode.ts`, `draw.ts` belong to the video-engine session (read-only).

## 1. What a MotionSpec can express today

The spec is plain JSON: `MotionSpec` spec.ts:320 = ratio (`RATIOS` :8, 9:16 to 21:9), a palette, `scenes[]`, `music` (a
mood name only), `caption`, `hashtags`, and an optional film `look` (:83). `encodeSpecMp4` encode.ts:71 draws every frame
with `drawSpecFrame` (draw.ts:54) and muxes H.264 + AAC in the browser (WebCodecs, mp4-muxer); the live preview uses the
same draw function, so what the editor shows is what is exported.

| Need | Where in the spec | Notes |
| --- | --- | --- |
| Clips | `VideoLayer` spec.ts:280: `url`, `start` (seconds into the clip), `fit`, `sound`, `dim` | one clip per scene, full frame; clips are opened once and read front to back (video-frames.ts) |
| Trim | scene `seconds` (:305) + the layer's `start` | a trim is two numbers; limits in `SPEC_LIMITS` :339 (a scene 1.2 to 8 s) |
| Cuts / split | one scene per shot; the reel makes 3 to 7 per clip (`buildReelSpec` story.ts:291, `buildMontageSpec` :359) | splitting = two scenes with different `start` |
| Reorder | `scenes[]` order | order is time; nothing else depends on it |
| Transitions | `Scene.transition` :314, `TRANSITIONS` :43: cut, fade, slideUp, slideLeft, zoom, wipe, flash, whip, blurZoom, spin, dip | length fixed (`transitionSeconds` 0.45) |
| Punch-in / zoom / spin | layer `keyframes` (`Keyframe` :155: at, dx, dy, scale, rotate, opacity, ease) | the reel uses scale keyframes on the video layer for punch-ins |
| Camera moves, focus pull, parallax | `Scene.camera` :68, `CAMERA_MOVES` :49 | designed for photos and 3D layers |
| Captions, word by word | `TextLayer` :203 with `animate: "words" / "wordsPop" / "typewriter"` (`TEXT_ANIMATIONS` :40), `highlight` words, `box` | caption timing is scene length, not per word; the editor re-splits words across shots |
| Stickers | text with `box` (price, hook, brand in the reel), `ShapeLayer` :226 (rect, circle, ring, arrow, burst...), `text3d` :123, `CharacterLayer` :259 | no emoji/image sticker library, no user PNG layer except `PhotoLayer` :179 |
| Music | `EncodeOptions.musicUrl` encode.ts:60 (the spec only holds a mood) | track picked from the library (lib/music/tracks.ts) |
| Beat marks | `beatOfTrack` reel-engine/beats.ts:60 -> `MusicBeat {period, offset}`; `snapToBeat` story.ts:252, `reelCuts` :268 | computed in the browser from the audio; not stored in the spec |
| Voice-over | `EncodeOptions.voice` + `fitSpecToVoice` voice.ts:131 | clip sound mixed by `clipSoundCues` video-frames.ts:43; Veo clips never keep their own sound (:30) |
| Colour grade, grain, vignette, glow, light leak | `Look` :83, `GRADES` :81 | whole video only |
| Brand end card | the last scenes' text layers (name, price sticker, contact) | built in `buildReelSpec`, not a template object |
| Speed, reverse, freeze | none | |
| Per-scene filters, volume, fade of audio | none (volume fixed; sound on/off per layer) | |

Note: the reel specs have up to about 20 scenes, above `SPEC_LIMITS.maxScenes` (8); the limit is enforced by
`validate.ts` for designed specs, not by the encoder, so an editor must not run the designer's validator on them.

## 2. What people use most for short reels (public features)

Trim and split on a timeline; drag to reorder; speed (0.5x to 2x, speed curves); auto-captions (speech to text, then style
presets, word highlight); text styles (font, colour, outline, box, animation in/out); stickers and emoji; transitions
between clips; auto-beat (cut marks on the music's beat); keyframes (position, scale, rotation, opacity); filters and
colour adjust; templates (a fixed edit pattern you drop your clips into); voice-over and sound effects; background
removal; aspect-ratio resize. Open-source editors show the same core: OpenShot and Shotcut have tracks, trim/split,
transitions, keyframes and filters; Remotion models a video as React components on a `<Sequence>` timeline with the
player and the renderer sharing one description, which is the same idea as our spec + `drawSpecFrame`. A timeline UI
exists as open-source React components, but our needs are small enough to write our own (about 600 lines) and avoid a
dependency.

## 3. Gap table

| Feature | In MotionSpec? | Effort in an editor UI on the spec |
| --- | --- | --- |
| Trim a shot | yes (`seconds`, `start`) | S: drag the shot's edges |
| Split / delete a shot | yes | S |
| Reorder shots | yes | S: drag on the timeline |
| Transition between shots | yes (11 kinds) | S: pick from a list |
| Punch-in / zoom | yes (keyframes) | S: a "zoom" slider writes 2 keyframes |
| Caption text, word highlight | yes | S: edit text, re-split across shots |
| Caption word-by-word timing | partly (animation per layer, no per-word times) | M: needs auto-captions from the audio |
| Auto-captions (speech to text) | no | L: new server step (Gemini), then text layers |
| Text style (font, colour, box) | yes | S |
| Stickers: text, shapes, 3D text | yes | S to M: palette + drag on the preview |
| Stickers: emoji / PNG | partly (PhotoLayer) | M: needs an asset picker |
| Music choice | yes (`musicUrl`) | S: library picker |
| Beat marks / snap | partly (computed, not stored) | M: draw marks on the timeline; snap uses `snapToBeat` |
| Voice-over | yes | M: reuse the existing voice step |
| Colour grade / look | yes (global) | S |
| Per-shot filters | no | M (renderer change) |
| Speed / reverse | no | L (encoder and `video-frames.ts` change) |
| Audio volume / fades | no | M (encoder change) |
| Keyframe curves editor | yes in the data, no UI | M |
| Templates (save an edit as a pattern) | partly (a spec is already a template) | S: save/load a spec |
| Background removal | no (`cutout.ts` is for product photos) | L |
| Undo / redo | n/a | S: the state is one JSON |

## 4. Proposed v1 and component outline

**v1 scope: edit a finished reel's spec, nothing generated.** Trim and split shots, drag to reorder, change a shot's
transition, a zoom amount per shot, caption text and highlight words, add/move/delete stickers (text with box, shapes),
change music and show beat marks with snap, grade presets, undo/redo, preview at full speed in a canvas, export with
`encodeSpecMp4` (720p default). Left out of v1: speed, auto-captions, per-shot filters, emoji/PNG stickers, audio fades.

Components (React, client-only, `components/editor/*`, hosted first in Admin > Training Lab, written so the Studio can import it):
- `useSpecHistory(initial)`: the state is a `MotionSpec`; every edit is a pure function `(spec) => spec`; an undo stack of
  specs (the spec is small), `commit`, `undo`, `redo`.
- `EditorShell`: layout, keyboard shortcuts (space, S split, Delete, Cmd-Z), export button with progress.
- `Preview`: a canvas that calls `drawSpecFrame` for the playhead time, plays with `requestAnimationFrame`, and fetches
  video-layer frames through `videoFramesAt` / the video-frames helper, as the export does; clip sound and music via Web Audio.
- `Timeline`: one lane of shots (width = seconds), a caption lane, a sticker lane, a music lane with beat marks;
  drag edges (trim), drag blocks (reorder), click a seam to open `TransitionPicker`.
- `Inspector`: edits the selected shot or layer: text, colour, size, zoom, transition, grade.
- `StickerPalette`: preset text boxes (price, hook, brand), shapes, 3D text.
- `MusicPicker`: the library tracks; runs `beatOfTrack` once and caches the `MusicBeat`.
- `lib/editor/ops.ts` (pure, unit-tested): `splitShot`, `trimShot`, `moveShot`, `setTransition`, `setZoom`, `setCaption`,
  `addSticker`, `retimeToBeat`, each keeping scene lengths within the clip and total at most about 30 s.
- Save: a `spec` JSON on the Lab example or the reel job (no new table for v1), export uploads the MP4 like the reel's finish step.

**Encoder changes that would need the video-engine session's OK (none are needed for v1):**
1. Speed / reverse (`VideoLayer.rate`) in `video-frames.ts` and `clipSoundCues` (audio time-stretch).
2. Audio volume and fades (a `music` object instead of a mood string, or new `EncodeOptions`), in `encodeSoundtrack`.
3. Per-scene `look` / filters in `draw.ts`.
4. Storing a `beats` array or a `musicUrl` inside the spec (spec.ts type change) so a saved edit is self-contained.
5. Raising or bypassing `SPEC_LIMITS.maxScenes` (8) for editor specs, if the Studio's validator will ever see them.
6. Per-word caption times (a `TextLayer.words: {text, fromMs, toMs}[]`) for auto-captions.

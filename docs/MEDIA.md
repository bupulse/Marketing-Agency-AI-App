# Gallery: photos and videos

Code: `lib/media/rules.ts` (pure limits and checks), `lib/media/service.ts` (uploads, quotas, folders),
`lib/media/videos.ts` (album videos for the content pipeline), `components/media/` (Gallery screen, picker, upload).
Albums and folders are described in `docs/KNOWLEDGE_BASE.md`.

## Gallery videos (13 October 2026)

The owner's own clips go in the Gallery like photos, so AI content uses them first ("Gallery first",
`docs/CONTENT.md`): a video idea posts the album's video as it is instead of making one.

- **Files**: MP4, MOV and WebM, up to **60 seconds** and **50 MB** each (the Supabase free plan refuses bigger
  files). MOV is the same file family as MP4: it is stored as `<userId>/clips/<id>.mp4` and served as `video/mp4`,
  which Instagram, Facebook and YouTube take. WebM stays `.webm` (Facebook only through the API).
- **Own private bucket** (review, migration `20261017140000_gallery_videos_bucket`): videos and their posters live in
  `gallery-videos` (50 MB a file; MP4, WebM and JPEG only) with **no Storage policies**: a browser can neither write
  nor read there. The server issues the signed upload tokens (service key), each tied to a `MediaUploadReservation`
  row (path, announced bytes, 2 hours), and signs the playback URLs. `bucketForPath` maps `<userId>/clips/...` to it.
  The shared `media` bucket is back to 10 MB, and no session may overwrite a `media` object any more (the UPDATE
  policy covers brand and designs only; server uploads use the service key). Test-database videos stored in `media`
  before this were removed with the migration; the sweep deletes their files.
- **Upload** (`use-gallery-upload.ts`): the browser reads the length (over 60 s is refused before uploading), the
  size and the first frame, which it saves as a small JPEG **poster** (`<id>-poster.jpg`, at most 720 px and 400 KB).
  `prepareUploads` checks type, size, the company quota and the video cap and gives two signed upload URLs (video and
  poster); the browser uploads straight to Storage, then `finalizeUpload`. A video this browser cannot play (some
  iPhone HEVC MOVs in Chrome) still uploads, without a poster.
- **Server checks** (`finalizeUpload` → `checkVideo`): rate limited (300 an hour per user); only a reserved, open path
  of this company; size (at most 50 MB and the announced size) and the quotas **first**, before any of the file is
  read; then the file's own first bytes (`ftyp` box, or EBML for WebM) and the real length (`lib/visuals/duration.ts`):
  an MP4/MOV is probed with a few ranged reads (box headers, then only the `moov` box; `probeMp4Durations`), and the
  longest of the movie header and the tracks' `mdhd` counts; headers that disagree by more than 10% are refused
  (`trustedLengthMs`). A WebM is read at most 8 MB in (its Info duration; a bigger file without one is refused). Over
  60.5 s, unreadable or not a video: refused, and the file and poster are deleted. The poster is kept only as a JPEG of
  at most 400 KB and 1280 px; its bytes count with the video's.
- **Row**: `MediaAsset.kind` "photo" | "video", `durationMs`, `posterPath`, `width`/`height` (from the browser, which
  applies a phone's rotation), `bytes` (video plus poster) and `description`, the owner's **"What's in this video?"**
  (500 characters; the AI writes the caption about it). Migration `20261017130000_gallery_videos` (also raises the
  media bucket's file limit to 50 MB).
- **Quotas**: videos (and open reservations, at their announced size) count toward the company's 500 items / 2 GB and
  the shared storage guard (`MEDIA_PLATFORM_MAX_BYTES`, 900 MB on the free plan), and have their own cap per company,
  `MEDIA_COMPANY_VIDEO_MAX_BYTES` (300 MB by default), checked when the upload starts, at finalize and again under the
  quota lock. The guard takes the larger of the rows and the real object sizes in Storage (`storage.objects`, summed
  per bucket by the database, cached a minute), so files nobody recorded count too. The Gallery says how much video
  space is used and that storage is small for now.
- **Unrecorded files** (`lib/media/storage-sweep.ts`): the daily media-cleanup cron drops expired reservations and
  walks every company, page by page: its `gallery/` (media), `clips/` (gallery-videos) and any folder under its
  `media` folder the app never writes (not gallery, videos or projects). Files older than an hour that no row records
  (photo or video, poster, Instagram copy, open reservation, waiting post) are deleted. The upload path runs the same
  per-company sweep on a share of requests (`sweepOrphans`).
- **Gallery screen**: video tiles show the poster, a play mark and the length; the viewer plays the video (poster
  first) and has the description field; "Add to album", move, rename and delete work as for photos (delete removes the
  poster too). Pickers for designs and video scenes show photos only; the post composer's picker shows videos too.
- **Never drawn**: videos are not photos: `isOwnGalleryPath` / `isOwnPhotoPath` refuse them, and the album paths the
  designs and Autopilot use are photos only (`writingSubject`, `loadPlanInput` keeps `videoPaths` apart).

## For the content pipeline

`subjectVideos(businessId, { kind: "product" | "campaign", id }, { signed?, take? })` lists the subject's album
videos in album order: `{ id, path, name, mimeType, durationMs, width, height, aspect, description, posterPath,
posterUrl }`, a superset of `lib/content-flow/media.ts`'s `GalleryItem` (`path`, `name`, `mimeType`). A campaign
without videos uses its first product's. `videoLine(video)` is the writer's line about what the video shows.

## Publishing a Gallery video

The same path as a rendered video: `mediaForPost` / `composerMediaFor` (`lib/visuals/post-media.ts`), a Reel on
Instagram, a Page video on Facebook, the reminder's video on TikTok and YouTube. Each network has a longest video
(`NETWORK_VIDEO_MAX_MS`: Instagram 90 s, Facebook 240 s, YouTube Shorts 180 s, TikTok and LinkedIn 600 s); a longer one
is kept out of that network (`mediaForPost` returns a `note` asking to trim it; the composer refuses a TikTok or
YouTube post that would be left without it, with the same note). Instagram's photo-ratio check counts photos only.

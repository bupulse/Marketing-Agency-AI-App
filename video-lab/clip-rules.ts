// The phone clip rules shared by the upload (client-clips.ts) and the design request (client-jobs.ts): how long a
// clip may be, how many go into one design, and where the renderer loads a client's clip. Data only.

/** A clip's length: 5 to 10 seconds, with half a second of slack each way (phones round). */
export const CLIP_SECONDS = { min: 5, max: 10, slack: 0.5 } as const;
export const clipLengthOk = (seconds: number) => seconds >= CLIP_SECONDS.min - CLIP_SECONDS.slack && seconds <= CLIP_SECONDS.max + CLIP_SECONDS.slack;
/** At most this many clips go into one design. */
export const MAX_CLIPS = 4;
/** Where the renderer loads a client's clip (this server, scoped to their session). */
export const clientClipPath = (assetId: string) => `/api/clip/${assetId}`;

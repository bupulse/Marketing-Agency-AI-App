// The video robot's only way to print (docs/VIDEO_ROBOT.md). The repository is public, so GitHub Actions logs are
// public: the robot prints fixed event names and counts, never business names, captions, URLs, tokens or ids.
// Anything else is dropped; a value that is not a small whole number is not printed.

/** Every line the robot may print. */
export const EVENTS = {
  not_configured: "Video robot is not set up (VIDEO_ROBOT_SECRET or ROBOT_APP_URL missing); skipping.",
  waiting: "Videos waiting",
  nothing_to_do: "No videos waiting.",
  chrome_ready: "Chrome started",
  encoder: "Encoder",
  no_encoder: "This Chrome can encode neither MP4 nor WebM; nothing claimed.",
  claimed: "Claimed",
  made: "Made",
  failed: "Failed",
  summary: "Run finished",
  api_error: "The app answered with an error; status",
  network_error: "Could not reach the app.",
  time_up: "Time is nearly up; no more videos this run.",
  fatal: "The robot stopped early.",
};

/** Words that may follow an event (failure reasons, encoder names); nothing else is printed as text. */
export const WORDS = new Set(["mp4", "webm", "render_failed", "unsupported", "timeout", "too_large", "upload_failed", "complete_failed", "claim", "complete", "fail", "report", "peek"]);

/** A count: a whole number from 0 to 9999. */
const isCount = (value) => Number.isInteger(value) && value >= 0 && value < 10_000;

/** One printable line for an event and its details, or null when the event is unknown. */
export function formatLine(event, details = {}) {
  const text = EVENTS[event];
  if (!text) return null;
  const parts = [];
  for (const [key, value] of Object.entries(details)) {
    if (!/^[a-z_]{1,20}$/.test(key)) continue;
    if (isCount(value)) parts.push(`${key} ${value}`);
    else if (typeof value === "string" && WORDS.has(value)) parts.push(`${key} ${value}`);
  }
  return parts.length ? `${text}: ${parts.join(", ")}` : text;
}

/** The robot's logger: `log("claimed", { videos: 2 })`. Writes through `write` (console.log by default). */
export function createLogger(write = (line) => console.log(line)) {
  return function log(event, details) {
    const line = formatLine(event, details);
    if (line) write(`[video-robot] ${line}`);
  };
}

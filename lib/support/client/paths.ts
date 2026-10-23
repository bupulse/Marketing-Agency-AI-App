// Page changes for the live-visitors list: only the path (never the query, which can hold sign-in codes), sent once
// the visitor stays on a page for a moment, and never twice in a row for the same page.

/** The path as reported: no query or hash, no trailing slash, at most 500 characters (visitBody). */
export function reportablePath(pathname: string): string {
  const p = (pathname || "/").split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  return p.slice(0, 500);
}

/** The referrer without its query (it can carry other sites' personal data), or undefined when there is none. */
export function reportableReferrer(referrer: string): string | undefined {
  try {
    const u = new URL(referrer);
    return `${u.origin}${u.pathname}`.slice(0, 500);
  } catch {
    return undefined;
  }
}

type Timers = { set: (fn: () => void, ms: number) => unknown; clear: (id: unknown) => void };
const realTimers: Timers = { set: (fn, ms) => setTimeout(fn, ms), clear: (id) => clearTimeout(id as ReturnType<typeof setTimeout>) };

/** Debounces and dedupes page changes: push() on every navigation, report() runs for the page the visitor settles on. */
export function createPathReporter(report: (path: string, title: string) => void, delayMs = 1500, timers: Timers = realTimers) {
  let last: string | null = null;
  let timer: unknown = null;
  return {
    /** The first page is already known to the server (POST /visit): mark it without reporting. */
    seed(path: string) {
      last = reportablePath(path);
    },
    push(pathname: string, title = "") {
      const path = reportablePath(pathname);
      if (timer !== null) timers.clear(timer);
      timer = timers.set(() => {
        timer = null;
        if (path === last) return;
        last = path;
        report(path, title.slice(0, 300));
      }, delayMs);
    },
    cancel() {
      if (timer !== null) timers.clear(timer);
      timer = null;
    },
  };
}

/** Lets a call through at most once per interval (the typing draft: 1 per second); the last call in a burst still goes. */
export function createThrottle<T>(fn: (value: T) => void, intervalMs: number, now: () => number = Date.now, timers: Timers = realTimers) {
  let lastAt = -Infinity;
  let timer: unknown = null;
  let pending: { value: T } | null = null;
  const fire = (value: T) => {
    lastAt = now();
    fn(value);
  };
  return {
    call(value: T) {
      const wait = lastAt + intervalMs - now();
      if (wait <= 0 && timer === null) return fire(value);
      pending = { value };
      if (timer === null) {
        timer = timers.set(() => {
          timer = null;
          const p = pending;
          pending = null;
          if (p) fire(p.value);
        }, Math.max(0, wait));
      }
    },
    cancel() {
      if (timer !== null) timers.clear(timer);
      timer = null;
      pending = null;
    },
  };
}

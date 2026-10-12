// An iCalendar invite for a demo booking. Pure text building: the route /api/demo/ics/[token] serves it, and the
// booking emails attach it, so the client and the owner can add the call to any calendar app. Follows RFC 5545:
// text values escaped, parameter values quoted, lines folded at 75 octets (not characters).

export type IcsEvent = {
  uid: string;
  /** Bumped on every change (DemoBooking.sequence), so calendar apps replace the earlier version of the same event. */
  sequence: number;
  start: Date;
  end: Date;
  summary: string;
  description: string;
  /** The meeting link, shown as the location and as the URL. */
  url?: string | null;
  organizer: { name: string; email: string };
  attendees: { name?: string | null; email: string }[];
  cancelled?: boolean;
  /** When the invite was made (DTSTAMP). Defaults to now. */
  stamp?: Date;
};

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/** Backslashes, commas, semicolons and line breaks (CRLF, lone CR or LF) are escaped as the format wants. */
export function escapeIcsText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r\n|\r|\n/g, "\\n");
}

/** A parameter value (CN=...): always in DQUOTEs, which the value itself may not contain; control characters dropped. */
export function icsParam(value: string): string {
  return `"${value.replace(/["\r\n\t]/g, "").trim()}"`;
}

const utf8 = new TextEncoder();
const octets = (s: string) => utf8.encode(s).length;

/** Lines longer than 75 octets are folded with a CRLF and a space, never inside a UTF-8 sequence or a surrogate pair. */
export function foldIcsLine(line: string): string {
  const out: string[] = [];
  let rest = line;
  while (octets(rest) > 75) {
    let cut = Math.min(rest.length, 75);
    while (cut > 1 && octets(rest.slice(0, cut)) > 75) cut--;
    const last = rest.charCodeAt(cut - 1);
    if (last >= 0xd800 && last <= 0xdbff) cut--; // a high surrogate: keep the pair together
    out.push(rest.slice(0, cut));
    rest = ` ${rest.slice(cut)}`;
  }
  out.push(rest);
  return out.join("\r\n");
}

export function buildIcs(e: IcsEvent): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//BuPulse//Demo booking//EN",
    "CALSCALE:GREGORIAN",
    `METHOD:${e.cancelled ? "CANCEL" : "REQUEST"}`,
    "BEGIN:VEVENT",
    `UID:${e.uid}`,
    `SEQUENCE:${e.sequence}`,
    `DTSTAMP:${stamp(e.stamp ?? new Date())}`,
    `DTSTART:${stamp(e.start)}`,
    `DTEND:${stamp(e.end)}`,
    `SUMMARY:${escapeIcsText(e.summary)}`,
    `DESCRIPTION:${escapeIcsText(e.description)}`,
    ...(e.url ? [`LOCATION:${escapeIcsText(e.url)}`, `URL:${e.url}`] : []),
    `STATUS:${e.cancelled ? "CANCELLED" : "CONFIRMED"}`,
    `ORGANIZER;CN=${icsParam(e.organizer.name)}:mailto:${e.organizer.email}`,
    ...e.attendees.map((a) => `ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED${a.name ? `;CN=${icsParam(a.name)}` : ""}:mailto:${a.email}`),
    "BEGIN:VALARM",
    "TRIGGER:-PT15M",
    "ACTION:DISPLAY",
    "DESCRIPTION:BuPulse demo in 15 minutes",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(foldIcsLine).join("\r\n") + "\r\n";
}

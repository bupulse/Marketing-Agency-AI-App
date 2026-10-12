// An iCalendar invite for a demo booking. Pure text building: the route /api/demo/ics/[token] serves it, and the
// booking emails attach it, so the client and the owner can add the call to any calendar app.

export type IcsEvent = {
  uid: string;
  /** Bumped on every change, so calendar apps replace the earlier version. */
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

/** Backslashes, commas, semicolons and newlines are escaped as the format wants. */
export function escapeIcsText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Lines longer than 75 octets are folded with a CRLF and a space. */
export function foldIcsLine(line: string): string {
  const out: string[] = [];
  let rest = line;
  while (rest.length > 75) {
    out.push(rest.slice(0, 75));
    rest = ` ${rest.slice(75)}`;
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
    `ORGANIZER;CN=${escapeIcsText(e.organizer.name)}:mailto:${e.organizer.email}`,
    ...e.attendees.map((a) => `ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED${a.name ? `;CN=${escapeIcsText(a.name)}` : ""}:mailto:${a.email}`),
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

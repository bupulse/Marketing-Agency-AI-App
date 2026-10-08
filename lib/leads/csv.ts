// CSV for the leads export. RFC 4180 quoting; cells that a spreadsheet could run as a formula are defused.

/** One cell: formula-injection safe, then quoted when it holds a comma, quote or line break. */
export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : value instanceof Date ? value.toISOString() : String(value);
  // =, +, -, @ (and tab / carriage return) at the start can make Excel, Sheets or Numbers run a formula.
  // A normalised phone number (+250788123456) is safe and stays readable, so it is not prefixed.
  if (/^[=+\-@\t\r]/.test(text) && !/^\+\d{7,15}$/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csvRow(cells: unknown[]): string {
  return cells.map(csvCell).join(",");
}

export type ExportLead = {
  id: string;
  createdAt: Date;
  name: string | null;
  email: string | null;
  phone: string | null;
  interest: string | null;
  message: string | null;
  source: string;
  status: string;
  notes: string | null;
  pageUrl: string | null;
};

export const CSV_HEADER = ["Date", "Name", "Email", "Phone", "Interest", "Message", "Source", "Status", "Notes", "Page", "ID"];

/** The whole file: UTF-8 BOM (so Excel reads accents), CRLF line ends. */
export function leadsToCsv(leads: ExportLead[]): string {
  const rows = [
    CSV_HEADER,
    ...leads.map((l) => [l.createdAt, l.name, l.email, l.phone, l.interest, l.message, l.source, l.status, l.notes, l.pageUrl, l.id]),
  ];
  return "﻿" + rows.map(csvRow).join("\r\n") + "\r\n";
}

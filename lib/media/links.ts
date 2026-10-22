// "Import from a link" (docs/MEDIA.md): what a pasted link means and where the server downloads it from. Pure, so the
// browser checks a link before sending it and the server checks it again. The download itself is in
// lib/media/importers.ts (importLinkedFile).

import { isBlockedHost } from "@/lib/webhooks/core";

export const LINK_MAX_LENGTH = 2000;

export const DRIVE_SHARE_MESSAGE = "BuPulse can't open that Drive file. In Drive, set Share → General access → Anyone with the link, then paste the link again.";
export const DRIVE_FOLDER_MESSAGE = "That is a Drive folder. Share one file at a time: open the photo or video in Drive, copy its link and paste it here.";
export const DRIVE_DOCS_MESSAGE = "That is a Google Docs, Sheets or Slides file, not a photo or video. Paste a link to a photo or video file.";
export const DROPBOX_FOLDER_MESSAGE = "That is a Dropbox folder. Share one file at a time: open the photo or video in Dropbox, copy its link and paste it here.";
export const DROPBOX_OPEN_MESSAGE = "BuPulse can't open that Dropbox file. Check that the link still works, then paste it again.";
export const WEB_PAGE_MESSAGE = "That link opens a web page, not a photo or video. Open the photo or video itself, copy its address and paste that.";

/** Where the file comes from (it picks the error messages) and the address the server downloads. */
export type MediaLink = { kind: "drive" | "dropbox" | "web"; url: string };
export type LinkCheck = { ok: true; link: MediaLink } | { ok: false; error: string };

const DRIVE_ID = /^[A-Za-z0-9_-]{10,128}$/;

/** Google Drive's direct download for a file shared "Anyone with the link": no key, no sign-in. */
export const driveDownloadUrl = (id: string) => `https://drive.usercontent.google.com/download?id=${encodeURIComponent(id)}&export=download&confirm=t`;

function driveLink(url: URL): LinkCheck {
  const path = url.pathname;
  if (/\/folders\//.test(path) || /^\/drive\/(u\/\d+\/)?(my-drive|shared-with-me|recent|starred)?\/?$/.test(path)) return { ok: false, error: DRIVE_FOLDER_MESSAGE };
  if (/^\/(document|spreadsheets|presentation|forms|drawings)\//.test(path)) return { ok: false, error: DRIVE_DOCS_MESSAGE };
  // drive.google.com/file/d/<id>/view, /open?id=<id>, /uc?id=<id>, drive.usercontent.google.com/download?id=<id>
  const id = /^\/(?:file\/)?(?:u\/\d+\/)?d\/([^/]+)/.exec(path)?.[1] ?? (/^\/(open|uc|download)\/?$/.test(path) ? url.searchParams.get("id") : null);
  if (!id || !DRIVE_ID.test(id)) return { ok: false, error: DRIVE_SHARE_MESSAGE };
  return { ok: true, link: { kind: "drive", url: driveDownloadUrl(id) } };
}

function dropboxLink(url: URL): LinkCheck {
  if (/^\/(sh|scl\/fo)\//.test(url.pathname)) return { ok: false, error: DROPBOX_FOLDER_MESSAGE };
  // A share link (…?dl=0) opens Dropbox's preview page; dl=1 gives the file itself. rlkey (new links) is kept.
  if (url.hostname.endsWith("dropbox.com")) {
    url.searchParams.delete("raw");
    url.searchParams.set("dl", "1");
  }
  return { ok: true, link: { kind: "dropbox", url: url.toString() } };
}

/**
 * Checks a pasted link and turns it into the address to download: a Google Drive file link becomes Drive's direct
 * download, a Dropbox share link gets dl=1, any other https link is used as it is. Only https on port 443, no
 * username or password, and no IP address or private or local name (the server also checks where the name points).
 */
export function parseMediaLink(raw: string): LinkCheck {
  const text = raw.trim();
  if (!text) return { ok: false, error: "Paste a link first." };
  if (text.length > LINK_MAX_LENGTH) return { ok: false, error: "That link is too long. Use a shorter link to the file." };
  let url: URL;
  try {
    // "drive.google.com/file/d/…" pasted without its https:// still works.
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`);
  } catch {
    return { ok: false, error: "That does not look like a link. Copy the whole link and paste it again." };
  }
  if (url.protocol !== "https:") return { ok: false, error: "Use a link that starts with https://." };
  if (url.username || url.password || (url.port && url.port !== "443")) return { ok: false, error: "BuPulse can't open that link. Copy the file's normal link and paste it again." };
  const host = url.hostname.toLowerCase();
  if (/^[\d.]+$/.test(host) || host.includes(":") || host.startsWith("[") || isBlockedHost(host)) return { ok: false, error: "That link points to a private or local address, which BuPulse can't open." };
  url.hash = "";
  if (host === "drive.google.com" || host === "docs.google.com" || host === "drive.usercontent.google.com") return driveLink(url);
  if (host === "dropbox.com" || host === "www.dropbox.com" || host === "dl.dropboxusercontent.com" || host === "dl.dropbox.com") return dropboxLink(url);
  return { ok: true, link: { kind: "web", url: url.toString() } };
}

/**
 * The file's name: the server's Content-Disposition filename when it sends one (Drive does), else the link's last path
 * part, else null.
 */
export function linkFileName(contentDisposition: string | null, link: string): string | null {
  const header = contentDisposition ?? "";
  const star = /filename\*\s*=\s*(?:UTF-8|utf-8)?''([^;]+)/.exec(header)?.[1];
  const plain = /filename\s*=\s*"([^"]+)"|filename\s*=\s*([^;]+)/.exec(header);
  const decode = (value: string) => {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  };
  const fromHeader = star ? decode(star.trim()) : (plain?.[1] ?? plain?.[2])?.trim();
  if (fromHeader) return fromHeader;
  try {
    const last = new URL(link).pathname.split("/").filter(Boolean).pop();
    const name = last ? decode(last) : "";
    // Drive's /download and similar paths are not names.
    return /\.[a-z0-9]{2,5}$/i.test(name) ? name : null;
  } catch {
    return null;
  }
}

/** Whether downloaded bytes are a web page (HTML) rather than a file: a sign-in or share page, or a site's page. */
export function looksLikeHtml(bytes: Uint8Array): boolean {
  const head = new TextDecoder().decode(bytes.subarray(0, 512)).replace(/^﻿/, "").trimStart().toLowerCase();
  return head.startsWith("<!doctype html") || head.startsWith("<html") || head.startsWith("<head") || head.startsWith("<body") || (head.startsWith("<") && head.includes("<html"));
}

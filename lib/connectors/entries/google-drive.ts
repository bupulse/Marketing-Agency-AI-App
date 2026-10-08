import { googlePickerConfig } from "@/lib/media/importers";
import { hasImported } from "@/lib/media/service";
import type { ConnectorEntry } from "../types";

const GALLERY = "/dashboard/gallery";

/** Google Drive through the file picker only (drive.file scope): BuPulse sees just the files the client picks, and keeps no token. */
export const connector: ConnectorEntry = {
  id: "google-drive",
  name: "Google Drive",
  group: "files",
  description: "Pick photos from your Drive and add them to your gallery.",
  icon: "hard-drive",
  async status({ businessId }) {
    if (!googlePickerConfig()) return { state: "unavailable" };
    return (await hasImported(businessId, "google_drive"))
      ? { state: "connected", detail: "You have imported photos from Drive" }
      : { state: "not_connected", detail: "Pick photos when you want them" };
  },
  connectHref: GALLERY,
  manageHref: GALLERY,
  // Nothing is stored, so there is nothing to remove. Access given in the picker is revoked on Google's side.
  async disconnect() {},
};

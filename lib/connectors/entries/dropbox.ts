import { dropboxAppKey } from "@/lib/media/importers";
import { hasImported } from "@/lib/media/service";
import type { ConnectorEntry } from "../types";

const GALLERY = "/dashboard/gallery";

/** Dropbox through the Chooser drop-in: no sign-in on BuPulse's side and nothing stored. */
export const connector: ConnectorEntry = {
  id: "dropbox",
  name: "Dropbox",
  group: "files",
  description: "Pick photos from your Dropbox and add them to your gallery.",
  icon: "box",
  async status({ businessId }) {
    if (!dropboxAppKey()) return { state: "unavailable" };
    return (await hasImported(businessId, "dropbox"))
      ? { state: "connected", detail: "You have imported photos from Dropbox" }
      : { state: "not_connected", detail: "Pick photos when you want them" };
  },
  connectHref: GALLERY,
  manageHref: GALLERY,
  async disconnect() {},
};

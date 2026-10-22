import { redirect } from "next/navigation";

// The demo booking step is gone (docs/REGIONS.md, "Trial first"): old links and bookmarks land on the free trial start.
export default function BookDemoPage() {
  redirect("/start-trial");
}

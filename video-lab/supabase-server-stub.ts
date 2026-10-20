// Stands in for lib/supabase/server.ts in the studio's bundle (scripts/video-lab/start.mjs). That file builds a Storage
// client from the signed-in person's cookies (next/headers), which the studio does not have: lib/media/service.ts
// reads and writes the Gallery's photo bucket through it. The studio scopes every request to the session's business
// itself (video-lab/session.ts, client-jobs.ts), so the server's own key does the Storage work.
import { createAdminClient } from "@/lib/supabase/admin";

export async function createClient() {
  return createAdminClient();
}

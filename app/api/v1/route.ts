import { apiError } from "@/lib/api/auth";

// Nothing lives at /api/v1 itself; a JSON answer beats an HTML 404 for API clients.
export function GET() {
  return apiError(404, "not_found", "See https://bupulse.com/docs/api or the BuPulse dashboard (Connectors > API) for the endpoints.");
}

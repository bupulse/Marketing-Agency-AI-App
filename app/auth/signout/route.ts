import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requestSiteUrl } from "@/lib/auth/request-site";

export async function POST() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  // Back to the sign-in page of the site the person is on (the tunnel on the test machine), not the server's own URL.
  return NextResponse.redirect(new URL("/login", await requestSiteUrl()), { status: 303 });
}

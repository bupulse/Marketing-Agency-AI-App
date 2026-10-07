"use server";

import { redirect } from "next/navigation";
import { markPostedFromEmail } from "@/lib/publishing/service";
import { readMarkPostedToken } from "@/lib/publishing/token";

export async function confirmPosted(formData: FormData) {
  const token = String(formData.get("token") ?? "").slice(0, 400);
  const postId = await readMarkPostedToken(token).catch(() => null);
  if (!postId) redirect(`/posted?token=${encodeURIComponent(token)}`);
  await markPostedFromEmail(postId);
  redirect(`/posted?token=${encodeURIComponent(token)}&done=1`);
}

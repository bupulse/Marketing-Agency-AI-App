"use client";

import { useCallback, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { extractColorsFromFile } from "@/lib/brand/image-colors";
import { LOGO_MAX_BYTES, LOGO_TYPES } from "@/lib/brand/schemas";
import { createLogoUpload } from "@/app/onboarding/actions";

export type LogoUploaded = { ok: true; path: string; colors: string[]; preview: string } | { ok: false; error: string };

/**
 * A logo straight to the private brand bucket (a signed upload), with colours suggested from the image. Shared by the
 * brand form (LookFields) and the Business info quiz. `preview` is a local link to show it; the caller frees it.
 * Saving it on the business is the caller's (saveLook).
 */
export function useLogoUpload() {
  const [uploading, setUploading] = useState(false);
  const upload = useCallback(async (file: File): Promise<LogoUploaded> => {
    if (!(LOGO_TYPES as readonly string[]).includes(file.type)) return { ok: false, error: "Use a PNG, JPG or WebP image." };
    if (file.size > LOGO_MAX_BYTES) return { ok: false, error: "The logo must be 5 MB or smaller." };
    setUploading(true);
    try {
      const [target, colors] = await Promise.all([createLogoUpload({ fileName: file.name, type: file.type, size: file.size }), extractColorsFromFile(file)]);
      if (!target.ok) return { ok: false, error: target.error };
      const { error } = await createClient().storage.from("brand").uploadToSignedUrl(target.path, target.token, file, { contentType: file.type });
      if (error) return { ok: false, error: "The upload did not work. Please try again." };
      return { ok: true, path: target.path, colors, preview: URL.createObjectURL(file) };
    } catch {
      return { ok: false, error: "The upload did not work. Please try again." };
    } finally {
      setUploading(false);
    }
  }, []);
  return { upload, uploading };
}

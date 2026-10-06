"use client";

import { useEffect, useRef, useState } from "react";
import { ImagePlus, Plus, Trash2, Upload } from "lucide-react";
import { Button, Input } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { extractColorsFromFile } from "@/lib/brand/image-colors";
import { LOGO_MAX_BYTES, LOGO_TYPES, MAX_COLORS } from "@/lib/brand/schemas";
import { createLogoUpload } from "@/app/onboarding/actions";
import type { BrandValues, Errors } from "./steps";

const HEX = /^#[0-9a-f]{6}$/i;

/**
 * Logo upload (straight to the private brand bucket) with colours suggested from the image.
 * `savedLogoUrl` is a signed link to the logo already saved, if any.
 */
export function LookFields({
  values,
  errors,
  onChange,
  onBusyChange,
  savedLogoUrl,
}: {
  values: BrandValues;
  errors: Errors;
  onChange: (patch: Partial<BrandValues>) => void;
  onBusyChange: (busy: boolean) => void;
  savedLogoUrl: string | null;
}) {
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "info"; text: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Free the temporary preview link when it is replaced or the step closes.
  useEffect(
    () => () => {
      if (localPreview) URL.revokeObjectURL(localPreview);
    },
    [localPreview],
  );

  const preview = values.logoPath ? (localPreview ?? savedLogoUrl) : null;
  const colorError = errors.brandColors ?? Object.entries(errors).find(([k]) => k.startsWith("brandColors."))?.[1];

  async function onFile(file: File) {
    setMessage(null);
    if (!(LOGO_TYPES as readonly string[]).includes(file.type)) {
      setMessage({ tone: "error", text: "Use a PNG, JPG or WebP image." });
      return;
    }
    if (file.size > LOGO_MAX_BYTES) {
      setMessage({ tone: "error", text: "The logo must be 5 MB or smaller." });
      return;
    }

    setUploading(true);
    onBusyChange(true);
    try {
      const [target, colors] = await Promise.all([
        createLogoUpload({ fileName: file.name, type: file.type, size: file.size }),
        extractColorsFromFile(file),
      ]);
      if (!target.ok) {
        setMessage({ tone: "error", text: target.error });
        return;
      }
      const { error } = await createClient().storage.from("brand").uploadToSignedUrl(target.path, target.token, file, { contentType: file.type });
      if (error) {
        setMessage({ tone: "error", text: "The upload did not work. Please try again." });
        return;
      }
      setLocalPreview(URL.createObjectURL(file));
      onChange({ logoPath: target.path, ...(colors.length ? { brandColors: colors } : {}) });
      setMessage({ tone: "info", text: colors.length ? "Logo added. We picked colours from it. Change them below if you like." : "Logo added." });
    } catch {
      setMessage({ tone: "error", text: "The upload did not work. Please try again." });
    } finally {
      setUploading(false);
      onBusyChange(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function setColor(index: number, value: string) {
    onChange({ brandColors: values.brandColors.map((c, i) => (i === index ? value : c)) });
  }

  return (
    <>
      <div className="flex flex-col gap-3">
        <p className="text-[13px] font-medium text-muted">Logo</p>
        <div className="flex flex-wrap items-center gap-4">
          <div className="glass flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-2xl">
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element -- private signed URL or local blob
              <img src={preview} alt="Your logo" className="max-h-full max-w-full object-contain p-2" />
            ) : (
              <ImagePlus aria-hidden className="size-7 text-muted" />
            )}
          </div>
          <div className="flex flex-col items-start gap-2">
            <input
              ref={inputRef}
              type="file"
              accept={LOGO_TYPES.join(",")}
              className="sr-only"
              tabIndex={-1}
              aria-hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void onFile(file);
              }}
            />
            <Button
              variant="ghost"
              size="sm"
              disabled={uploading}
              leading={<Upload aria-hidden className="size-4" />}
              onClick={() => inputRef.current?.click()}
            >
              {uploading ? "Uploading…" : values.logoPath ? "Replace logo" : "Upload logo"}
            </Button>
            {values.logoPath && !uploading && (
              <Button variant="outline" size="sm" leading={<Trash2 aria-hidden className="size-4" />} onClick={() => onChange({ logoPath: null })}>
                Remove logo
              </Button>
            )}
            <p className="text-[13px] text-muted">PNG, JPG or WebP. Up to 5 MB.</p>
          </div>
        </div>
        <p
          role={message?.tone === "error" ? "alert" : "status"}
          className={message?.tone === "error" ? "text-[13px] font-medium text-danger" : "text-[13px] text-muted"}
        >
          {message?.text}
        </p>
      </div>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-[13px] font-medium text-muted">Brand colours (up to {MAX_COLORS})</legend>
        {values.brandColors.map((color, i) => (
          <div key={i} className="flex items-center gap-3">
            <input
              type="color"
              aria-label={`Colour ${i + 1} picker`}
              value={HEX.test(color) ? color.toLowerCase() : "#000000"}
              onChange={(e) => setColor(i, e.target.value.toUpperCase())}
              className="size-11 shrink-0 cursor-pointer rounded-xl border border-line bg-transparent p-1"
            />
            <Input
              aria-label={`Colour ${i + 1} hex code`}
              maxLength={7}
              spellCheck={false}
              autoCapitalize="characters"
              invalid={!!colorError && !HEX.test(color)}
              value={color}
              onChange={(e) => setColor(i, e.target.value.trim())}
              onBlur={() => {
                if (/^[0-9a-f]{6}$/i.test(color)) setColor(i, `#${color.toUpperCase()}`);
              }}
              className="max-w-40 font-mono"
            />
            <Button
              variant="outline"
              size="sm"
              aria-label={`Remove colour ${i + 1}`}
              onClick={() => onChange({ brandColors: values.brandColors.filter((_, j) => j !== i) })}
            >
              <Trash2 aria-hidden className="size-4" />
            </Button>
          </div>
        ))}
        {values.brandColors.length === 0 && (
          <p className="text-[13px] text-muted">No colours yet. Upload a logo and we will suggest some, or add your own.</p>
        )}
        {values.brandColors.length < MAX_COLORS && (
          <Button
            variant="ghost"
            size="sm"
            className="self-start"
            leading={<Plus aria-hidden className="size-4" />}
            onClick={() => onChange({ brandColors: [...values.brandColors, "#2F6BFF"] })}
          >
            Add a colour
          </Button>
        )}
        {(colorError || errors.logoPath) && (
          <p role="alert" className="text-[13px] font-medium text-danger">
            {colorError ?? errors.logoPath}
          </p>
        )}
      </fieldset>
    </>
  );
}

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { installPlatform, isStandalone } from "@/lib/phone-app";

const ANDROID_CHROME = "Mozilla/5.0 (Linux; Android 14; SM-A155F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36";
const IPHONE_SAFARI = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1";
const IPAD_AS_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15";
const WINDOWS_CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

describe("installPlatform", () => {
  it("knows Android phones and iPhones", () => {
    expect(installPlatform(ANDROID_CHROME, 5)).toBe("android");
    expect(installPlatform(IPHONE_SAFARI, 5)).toBe("ios");
  });

  it("treats an iPad that says it is a Mac as iOS, and a real Mac as a computer", () => {
    expect(installPlatform(IPAD_AS_MAC, 5)).toBe("ios");
    expect(installPlatform(IPAD_AS_MAC, 0)).toBeNull();
  });

  it("shows nothing on computers", () => {
    expect(installPlatform(WINDOWS_CHROME, 0)).toBeNull();
    expect(installPlatform("", 0)).toBeNull();
  });
});

describe("isStandalone", () => {
  it("is true in the installed app on Android and on an iPhone", () => {
    expect(isStandalone(true, undefined)).toBe(true);
    expect(isStandalone(false, true)).toBe(true);
    expect(isStandalone(false, undefined)).toBe(false);
    expect(isStandalone(false, "yes")).toBe(false);
  });
});

describe("the web app manifest", () => {
  const manifest = JSON.parse(readFileSync("public/manifest.webmanifest", "utf8")) as { start_url: string; display: string; icons: { src: string; sizes: string; purpose?: string }[] };

  it("opens the dashboard full screen", () => {
    expect(manifest.start_url).toBe("/dashboard");
    expect(manifest.display).toBe("standalone");
  });

  it("has the 192 and 512 px icons Android needs, and a maskable one, all present in public/", () => {
    expect(manifest.icons.some((i) => i.sizes === "192x192")).toBe(true);
    expect(manifest.icons.some((i) => i.sizes === "512x512" && i.purpose !== "maskable")).toBe(true);
    expect(manifest.icons.some((i) => i.purpose === "maskable")).toBe(true);
    for (const icon of manifest.icons) expect(() => readFileSync(`public${icon.src}`)).not.toThrow();
  });

  it("has no offline cache in the service worker, so private pages never stay on a phone", () => {
    const sw = readFileSync("public/sw.js", "utf8");
    expect(sw).not.toMatch(/addEventListener\(\s*["']fetch["']/);
    expect(sw).not.toMatch(/caches\./);
  });
});

// BuPulse as a phone app (docs/guide/features/32-phone-app-and-whatsapp-share.md): which install help a device gets.
// Pure, so it can be tested; components/app/phone-app.tsx reads the browser and shows the prompt.

export type InstallPlatform = "android" | "ios";

/** Where a dismissed "Install BuPulse on your phone" is remembered (localStorage). */
export const INSTALL_DISMISSED_KEY = "bp-install-dismissed";

/**
 * "android": Android, where Chrome offers the install itself (beforeinstallprompt); "ios": an iPhone or iPad, where it
 * is two taps in the Share menu (an iPad says it is a Mac, but a Mac has no touch screen); null for computers.
 */
export function installPlatform(userAgent: string, maxTouchPoints = 0): InstallPlatform | null {
  if (/Android/i.test(userAgent)) return "android";
  if (/iPhone|iPad|iPod/i.test(userAgent)) return "ios";
  if (/Macintosh/i.test(userAgent) && maxTouchPoints > 1) return "ios";
  return null;
}

/** Whether the page runs as the installed app (from the Home Screen), not in a browser tab. */
export function isStandalone(displayModeStandalone: boolean, navigatorStandalone: unknown): boolean {
  return displayModeStandalone || navigatorStandalone === true;
}

// Browser side of the importers: loads Google Identity Services + Google Picker and the Dropbox Chooser
// on demand, and wraps them in promises. Scripts are loaded when the Import menu opens, so the pickers
// can start straight from the click (Safari blocks popups that open after an await).

type GoogleToken = { access_token?: string; error?: string };
type GooglePickerDoc = { id: string; name: string; mimeType?: string };
type GooglePickerResult = { action: string; docs?: GooglePickerDoc[] };

type GoogleGlobal = {
  accounts: {
    oauth2: {
      initTokenClient(config: { client_id: string; scope: string; callback: (r: GoogleToken) => void; error_callback: (e: { type?: string }) => void }): { requestAccessToken(options?: { prompt?: string }): void };
    };
  };
  picker?: {
    ViewId: { DOCS_IMAGES: string };
    Feature: { MULTISELECT_ENABLED: string };
    Action: { PICKED: string; CANCEL: string };
    DocsView: new (viewId: string) => DocsView;
    PickerBuilder: new () => PickerBuilder;
  };
};
type DocsView = { setMimeTypes(types: string): DocsView; setIncludeFolders(on: boolean): DocsView; setSelectFolderEnabled(on: boolean): DocsView };
type PickerBuilder = {
  addView(view: unknown): PickerBuilder;
  setOAuthToken(token: string): PickerBuilder;
  setDeveloperKey(key: string): PickerBuilder;
  setAppId(id: string): PickerBuilder;
  setMaxItems(n: number): PickerBuilder;
  enableFeature(feature: string): PickerBuilder;
  setCallback(cb: (r: GooglePickerResult) => void): PickerBuilder;
  build(): { setVisible(on: boolean): void };
};

export type DropboxFile = { name: string; link: string; bytes: number };
type DropboxGlobal = { choose(options: { success(files: DropboxFile[]): void; cancel(): void; linkType: "direct"; multiselect: boolean; extensions: string[]; sizeLimit?: number }): void };

declare global {
  interface Window {
    google?: GoogleGlobal;
    gapi?: { load(name: string, options: { callback: () => void; onerror?: () => void }): void };
    Dropbox?: DropboxGlobal;
  }
}

const loading = new Map<string, Promise<void>>();

function loadScript(src: string, attrs: Record<string, string> = {}): Promise<void> {
  const known = loading.get(src);
  if (known) return known;
  const promise = new Promise<void>((resolve, reject) => {
    const el = document.createElement("script");
    el.src = src;
    el.async = true;
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
    el.onload = () => resolve();
    el.onerror = () => {
      loading.delete(src);
      el.remove();
      reject(new Error("blocked"));
    };
    document.head.appendChild(el);
  });
  loading.set(src, promise);
  return promise;
}

export const GOOGLE_SCOPE = "https://www.googleapis.com/auth/drive.file";
export const PICKER_MIME_TYPES = "image/jpeg,image/png,image/webp";
export const DROPBOX_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"];
const DROPBOX_SIZE_LIMIT = 10 * 1024 * 1024;

export function googleReady(): boolean {
  return !!window.google?.accounts?.oauth2 && !!window.google?.picker;
}

/** Loads Google Identity Services and the Picker. Safe to call again. */
export async function preloadGoogle(): Promise<void> {
  await Promise.all([loadScript("https://accounts.google.com/gsi/client"), loadScript("https://apis.google.com/js/api.js")]);
  if (!window.google?.picker) {
    await new Promise<void>((resolve, reject) => window.gapi?.load("picker", { callback: resolve, onerror: () => reject(new Error("blocked")) }) ?? reject(new Error("blocked")));
  }
}

export type DrivePick = { token: string; files: { id: string; name: string }[] };

/**
 * Asks for a drive.file token, then opens the Google Picker for images. Must be called straight from a click
 * and only after `googleReady()`. Resolves null when the person cancels. `onPickerVisible` lets the page get
 * out of the way of the Picker (it cannot sit above a modal <dialog>).
 */
export function pickFromDrive(config: { apiKey: string; clientId: string; appId: string }, maxFiles: number, onPickerVisible: (visible: boolean) => void): Promise<DrivePick | null> {
  return new Promise((resolve, reject) => {
    const google = window.google;
    if (!google?.picker) return reject(new Error("not_ready"));
    const picker = google.picker;
    const client = google.accounts.oauth2.initTokenClient({
      client_id: config.clientId,
      scope: GOOGLE_SCOPE,
      callback: (response) => {
        if (!response.access_token) return reject(new Error(response.error ?? "no_token"));
        const token = response.access_token;
        const view = new picker.DocsView(picker.ViewId.DOCS_IMAGES).setMimeTypes(PICKER_MIME_TYPES).setIncludeFolders(true).setSelectFolderEnabled(false);
        onPickerVisible(true);
        new picker.PickerBuilder()
          .addView(view)
          .setOAuthToken(token)
          .setDeveloperKey(config.apiKey)
          .setAppId(config.appId)
          .setMaxItems(maxFiles)
          .enableFeature(picker.Feature.MULTISELECT_ENABLED)
          .setCallback((result) => {
            if (result.action === picker.Action.PICKED) {
              onPickerVisible(false);
              resolve({ token, files: (result.docs ?? []).map((d) => ({ id: d.id, name: d.name })) });
            } else if (result.action === picker.Action.CANCEL) {
              onPickerVisible(false);
              resolve(null);
            }
          })
          .build()
          .setVisible(true);
      },
      error_callback: (error) => (error.type === "popup_closed" ? resolve(null) : reject(new Error(error.type ?? "popup_failed"))),
    });
    client.requestAccessToken();
  });
}

/** Loads the Dropbox Chooser drop-in. Its app key is read from the script tag. */
export async function preloadDropbox(appKey: string): Promise<void> {
  await loadScript("https://www.dropbox.com/static/api/2/dropins.js", { id: "dropboxjs", "data-app-key": appKey });
}

export const dropboxReady = () => !!window.Dropbox;

/** Opens the Dropbox Chooser for images with direct links. Call straight from a click. Resolves [] on cancel. */
export function pickFromDropbox(): Promise<DropboxFile[]> {
  return new Promise((resolve, reject) => {
    if (!window.Dropbox) return reject(new Error("not_ready"));
    window.Dropbox.choose({ success: resolve, cancel: () => resolve([]), linkType: "direct", multiselect: true, extensions: DROPBOX_EXTENSIONS, sizeLimit: DROPBOX_SIZE_LIMIT });
  });
}

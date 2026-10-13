/** The page-loading animation, chosen in Admin -> Settings -> Loading animation. */
export const PAGE_LOADERS = ["bar", "preloader", "off"] as const;
export type PageLoader = (typeof PAGE_LOADERS)[number];

export function isPageLoader(v: unknown): v is PageLoader {
  return typeof v === "string" && (PAGE_LOADERS as readonly string[]).includes(v);
}

/** Remembered in the browser so the choice applies from the very first paint of the next page load. */
export const PAGE_LOADER_STORAGE_KEY = "bp-page-loader";

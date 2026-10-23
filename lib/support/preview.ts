/** The support app's dev-only preview pages (app/support/preview) exist outside production builds only. */
export const previewAllowed = (env: string | undefined = process.env.NODE_ENV) => env !== "production";

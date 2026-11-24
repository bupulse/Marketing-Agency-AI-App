// The browser build of mammoth (Word .docx to HTML), loaded only when a Word file is previewed.
declare module "mammoth/mammoth.browser.js" {
  type Result = { value: string; messages: { type: string; message: string }[] };
  export function convertToHtml(input: { arrayBuffer: ArrayBuffer }, options?: Record<string, unknown>): Promise<Result>;
  const mammoth: { convertToHtml: typeof convertToHtml };
  export default mammoth;
}

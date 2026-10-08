// Install guide content: the exact code per platform and the steps of the animated walkthrough.
// Pure data builders (no React), so the snippets can be unit tested.

export type PlatformId = "html" | "wordpress" | "nextjs" | "react" | "shopify" | "wix" | "squarespace" | "webflow" | "gtm";

export type EditorLine = { text: string; mark?: "focus" | "new" };

/** What one step of the walkthrough draws. */
export type Scene =
  | { type: "editor"; file: string; lines: EditorLine[] }
  | { type: "menu"; app: string; items: string[] }
  | { type: "paste"; app: string; label: string; action: string }
  | { type: "site" };

export interface InstallStep {
  title: string;
  text: string;
  scene: Scene;
}

export interface InstallVariant {
  id: string;
  label: string;
  /** Language label of the code block, e.g. "HTML" or "TSX". */
  language: string;
  code: string;
  /** One honest sentence shown under the code (plan needed, where it does not work...). */
  note?: string;
  steps: InstallStep[];
}

export interface Platform {
  id: PlatformId;
  name: string;
  tagline: string;
  variants: InstallVariant[];
}

/** Escapes a value for use inside a double-quoted HTML attribute or a double-quoted JS string in the snippets. */
export function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escapeJs(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/</g, "\\u003c").replace(/\n/g, "\\n");
}

// Short form shown while the animation types; the Copy box above always has the exact line.
// Two short lines, so the typing animation fits a phone screen.
const shortLines = (indent: string): EditorLine[] => [
  { text: `${indent}<script src="…/widget.js"`, mark: "new" },
  { text: `${indent}  data-key="…" async></script>`, mark: "new" },
];
const scriptLines = (indent: string): EditorLine[] => [
  { text: `${indent}<Script`, mark: "new" },
  { text: `${indent}  src="…/widget.js"`, mark: "new" },
  { text: `${indent}  data-key="…"`, mark: "new" },
  { text: `${indent}  strategy="afterInteractive"`, mark: "new" },
  { text: `${indent}/>`, mark: "new" },
];
const site: InstallStep = { title: "Open your website", text: "Reload your site. The chat bubble appears in the corner.", scene: { type: "site" } };

export function scriptTag(baseUrl: string, key: string): string {
  return `<script src="${escapeAttr(baseUrl.replace(/\/+$/, ""))}/widget.js" data-key="${escapeAttr(key)}" async></script>`;
}

export function buildPlatforms({ baseUrl, key }: { baseUrl: string; key: string }): Platform[] {
  const base = baseUrl.replace(/\/+$/, "");
  const tag = scriptTag(base, key);
  const jsBase = escapeJs(base);
  const jsKey = escapeJs(key);

  const htmlSteps = (file: string): InstallStep[] => [
    { title: `Open ${file}`, text: `Open ${file} in your editor or hosting file manager.`, scene: { type: "editor", file, lines: [{ text: "<!doctype html>" }, { text: "<html>" }, { text: "  <body>" }, { text: "    …your page…" }, { text: "  </body>" }, { text: "</html>" }] } },
    { title: "Find the closing body tag", text: "Scroll to the end and find </body>.", scene: { type: "editor", file, lines: [{ text: "<!doctype html>" }, { text: "<html>" }, { text: "  <body>" }, { text: "    …your page…" }, { text: "  </body>", mark: "focus" }, { text: "</html>" }] } },
    { title: "Paste the line above it", text: "Paste the copied line on its own line, just above </body>. Paste it as text; do not save it as a separate file.", scene: { type: "editor", file, lines: [{ text: "<!doctype html>" }, { text: "<html>" }, { text: "  <body>" }, { text: "    …your page…" }, ...shortLines("    "), { text: "  </body>" }, { text: "</html>" }] } },
    { title: "Save and publish", text: "Save the file and upload or publish the page as you normally do.", scene: { type: "paste", app: file, label: "Publish", action: "Save and upload" } },
    site,
  ];

  return [
    {
      id: "html",
      name: "HTML",
      tagline: "Any website you edit by hand",
      variants: [{ id: "html", label: "HTML page", language: "HTML", code: tag, note: "Add it to every page that should show the chat, or to the shared footer or template.", steps: htmlSteps("index.html") }],
    },
    {
      id: "wordpress",
      name: "WordPress",
      tagline: "Plugin or theme footer",
      variants: [
        {
          id: "plugin",
          label: "WPCode plugin",
          language: "HTML",
          code: tag,
          note: "The safest way: it survives theme updates. Any plugin that adds code to the site footer works the same way.",
          steps: [
            { title: "Install WPCode", text: "Go to Plugins → Add New Plugin, search for \"WPCode\", then Install and Activate.", scene: { type: "menu", app: "WordPress", items: ["Plugins", "Add New Plugin", "WPCode → Install"] } },
            { title: "Add a snippet", text: "Go to Code Snippets → + Add Snippet → Add Your Custom Code (New Snippet) → Use snippet.", scene: { type: "menu", app: "WordPress", items: ["Code Snippets", "+ Add Snippet", "Add Your Custom Code", "Use snippet"] } },
            { title: "Paste the line", text: "Choose the code type \"HTML Snippet\", paste the copied line and set Insertion to \"Site Wide Footer\".", scene: { type: "paste", app: "WPCode", label: "HTML Snippet · Site Wide Footer", action: "Active" } },
            { title: "Activate and save", text: "Switch the snippet to Active and click Save Snippet.", scene: { type: "menu", app: "WPCode", items: ["Active", "Save Snippet"] } },
            site,
          ],
        },
        {
          id: "footer",
          label: "Theme footer.php",
          language: "HTML",
          code: tag,
          note: "Needs a classic theme with a footer.php file. Block themes (such as Twenty Twenty-Four) have none: use the plugin. A theme update can remove your change; a child theme avoids that.",
          steps: [
            { title: "Open the theme editor", text: "Go to Appearance → Theme File Editor.", scene: { type: "menu", app: "WordPress", items: ["Appearance", "Theme File Editor"] } },
            { title: "Pick footer.php", text: "On the right, choose \"Theme Footer (footer.php)\".", scene: { type: "menu", app: "Theme File Editor", items: ["Theme Footer (footer.php)"] } },
            { title: "Paste above </body>", text: "Paste the copied line just above </body>, then click Update File.", scene: { type: "editor", file: "footer.php", lines: [{ text: "<?php wp_footer(); ?>" }, ...shortLines(""), { text: "</body>" }, { text: "</html>" }] } },
            { title: "Update the file", text: "Click Update File.", scene: { type: "menu", app: "Theme File Editor", items: ["Update File"] } },
            site,
          ],
        },
      ],
    },
    {
      id: "nextjs",
      name: "Next.js",
      tagline: "App Router or Pages Router",
      variants: [
        {
          id: "app",
          label: "App Router",
          language: "TSX",
          note: "Put it in the root layout so it stays on every page and keeps working when visitors move between pages. If your site sets a Content-Security-Policy, allow this address in script-src, frame-src and connect-src.",
          code: `import Script from "next/script";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Script
          src="${jsBase}/widget.js"
          data-key="${jsKey}"
          strategy="afterInteractive"
        />
      </body>
    </html>
  );
}`,
          steps: [
            { title: "Open app/layout.tsx", text: "Open your root layout, app/layout.tsx (or src/app/layout.tsx).", scene: { type: "editor", file: "app/layout.tsx", lines: [{ text: "export default function RootLayout({ children }) {", mark: "focus" }, { text: "  return (" }, { text: "    <html lang=\"en\">" }, { text: "      <body>" }, { text: "        {children}" }, { text: "      </body>" }, { text: "    </html>" }, { text: "  );" }, { text: "}" }] } },
            { title: "Import Script", text: "Add the import at the top of the file.", scene: { type: "editor", file: "app/layout.tsx", lines: [{ text: 'import Script from "next/script";', mark: "new" }, { text: "" }, { text: "export default function RootLayout({ children }) {" }, { text: "  return (" }, { text: "    <html lang=\"en\">" }, { text: "      <body>" }] } },
            { title: "Add <Script> in <body>", text: "Inside <body>, after {children}, add the <Script> line from the code above.", scene: { type: "editor", file: "app/layout.tsx", lines: [{ text: "        {children}", mark: "focus" }, ...scriptLines("        "), { text: "      </body>" }] } },
            { title: "Run or deploy", text: "Restart your dev server or deploy. The chat is on every page.", scene: { type: "paste", app: "Terminal", label: "npm run dev", action: "Deploy" } },
            site,
          ],
        },
        {
          id: "pages",
          label: "Pages Router",
          language: "TSX",
          note: "Put it in pages/_app.tsx so it loads once and stays while visitors move between pages.",
          code: `import type { AppProps } from "next/app";
import Script from "next/script";

export default function App({ Component, pageProps }: AppProps) {
  return (
    <>
      <Component {...pageProps} />
      <Script
        src="${jsBase}/widget.js"
        data-key="${jsKey}"
        strategy="afterInteractive"
      />
    </>
  );
}`,
          steps: [
            { title: "Open pages/_app.tsx", text: "Open pages/_app.tsx. If you do not have one, create it with the code above.", scene: { type: "editor", file: "pages/_app.tsx", lines: [{ text: "export default function App({ Component, pageProps }) {", mark: "focus" }, { text: "  return <Component {...pageProps} />;" }, { text: "}" }] } },
            { title: "Import Script", text: "Add the import at the top.", scene: { type: "editor", file: "pages/_app.tsx", lines: [{ text: 'import Script from "next/script";', mark: "new" }, { text: "" }, { text: "export default function App({ Component, pageProps }) {" }] } },
            { title: "Add <Script> after the page", text: "Wrap the page in a fragment and add the <Script> line after <Component />.", scene: { type: "editor", file: "pages/_app.tsx", lines: [{ text: "    <>" }, { text: "      <Component {...pageProps} />", mark: "focus" }, ...scriptLines("      "), { text: "    </>" }] } },
            site,
          ],
        },
      ],
    },
    {
      id: "react",
      name: "React",
      tagline: "Vite or Create React App",
      variants: [
        { id: "index", label: "index.html", language: "HTML", code: tag, note: "Vite: index.html in the project root. Create React App: public/index.html. Easiest, and it loads once for the whole app.", steps: htmlSteps("index.html") },
        {
          id: "component",
          label: "React component",
          language: "TSX",
          code: `import { useEffect } from "react";

export function ChatWidget() {
  useEffect(() => {
    const selector = 'script[data-key="${jsKey.replace(/'/g, "\\'")}"]';
    if (document.querySelector(selector)) return;
    const script = document.createElement("script");
    script.src = "${jsBase}/widget.js";
    script.async = true;
    script.dataset.key = "${jsKey}";
    document.body.appendChild(script);
  }, []);
  return null;
}`,
          note: "Render <ChatWidget /> once, at the top of your app. It adds the script only once, even in React strict mode.",
          steps: [
            { title: "Create the component", text: "Create src/ChatWidget.tsx and paste the code above.", scene: { type: "editor", file: "src/ChatWidget.tsx", lines: [{ text: 'import { useEffect } from "react";', mark: "new" }, { text: "export function ChatWidget() {", mark: "new" }, { text: "  useEffect(() => { …add the script… }, []);", mark: "new" }, { text: "  return null;", mark: "new" }, { text: "}", mark: "new" }] } },
            { title: "Import it", text: "Open src/App.tsx and import the component.", scene: { type: "editor", file: "src/App.tsx", lines: [{ text: 'import { ChatWidget } from "./ChatWidget";', mark: "new" }, { text: "" }, { text: "export default function App() {" }] } },
            { title: "Render it once", text: "Add <ChatWidget /> at the top level of your App.", scene: { type: "editor", file: "src/App.tsx", lines: [{ text: "    <>" }, { text: "      <Routes>…</Routes>", mark: "focus" }, { text: "      <ChatWidget />", mark: "new" }, { text: "    </>" }] } },
            site,
          ],
        },
      ],
    },
    {
      id: "shopify",
      name: "Shopify",
      tagline: "Theme code",
      variants: [
        {
          id: "theme",
          label: "theme.liquid",
          language: "HTML",
          code: tag,
          note: "Shopify checkout pages are separate and do not show it. If you change themes, add the line to the new theme too.",
          steps: [
            { title: "Open the theme code", text: "In Shopify admin go to Online Store → Themes, click the ⋯ button next to your theme and choose Edit code.", scene: { type: "menu", app: "Shopify admin", items: ["Online Store", "Themes", "⋯ → Edit code"] } },
            { title: "Open theme.liquid", text: "Under Layout, click theme.liquid.", scene: { type: "menu", app: "Edit code", items: ["Layout", "theme.liquid"] } },
            { title: "Paste above </body>", text: "Find </body> near the end of the file and paste the copied line just above it.", scene: { type: "editor", file: "theme.liquid", lines: [{ text: "  {{ content_for_layout }}" }, ...shortLines("  "), { text: "</body>", mark: "focus" }, { text: "</html>" }] } },
            { title: "Save", text: "Click Save.", scene: { type: "menu", app: "Edit code", items: ["Save"] } },
            site,
          ],
        },
      ],
    },
    {
      id: "wix",
      name: "Wix",
      tagline: "Settings → Custom code",
      variants: [
        {
          id: "custom",
          label: "Custom code",
          language: "HTML",
          code: tag,
          note: "Wix only allows custom code on a Premium plan with a connected domain.",
          steps: [
            { title: "Open Custom code", text: "In your Wix dashboard go to Settings → Custom code (under Advanced).", scene: { type: "menu", app: "Wix dashboard", items: ["Settings", "Custom code"] } },
            { title: "Add the code", text: "Click + Add Custom Code, then paste the copied line into the box.", scene: { type: "paste", app: "Wix", label: "Paste the code snippet here", action: "Apply" } },
            { title: "Choose where it loads", text: "Name it \"BuPulse chat\", choose All pages, and place the code in \"Body - end\".", scene: { type: "menu", app: "Wix", items: ["Add Code to Pages: All pages", "Place Code in: Body - end"] } },
            { title: "Apply and publish", text: "Click Apply, then publish your site.", scene: { type: "menu", app: "Wix", items: ["Apply", "Publish"] } },
            site,
          ],
        },
      ],
    },
    {
      id: "squarespace",
      name: "Squarespace",
      tagline: "Code Injection",
      variants: [
        {
          id: "injection",
          label: "Code Injection",
          language: "HTML",
          code: tag,
          note: "Code Injection needs a Business plan or higher. On older sites the menu is Settings → Advanced → Code Injection.",
          steps: [
            { title: "Open Code Injection", text: "Go to Settings → Developer Tools → Code Injection.", scene: { type: "menu", app: "Squarespace", items: ["Settings", "Developer Tools", "Code Injection"] } },
            { title: "Paste in the Footer box", text: "Paste the copied line into the Footer box (not the Header box).", scene: { type: "paste", app: "Code Injection", label: "Footer", action: "Save" } },
            { title: "Save", text: "Click Save.", scene: { type: "menu", app: "Code Injection", items: ["Save"] } },
            site,
          ],
        },
      ],
    },
    {
      id: "webflow",
      name: "Webflow",
      tagline: "Site settings → Custom code",
      variants: [
        {
          id: "footer",
          label: "Footer code",
          language: "HTML",
          code: tag,
          note: "Custom code needs a paid Site plan. Webflow only shows it on the published site, not in the Designer preview.",
          steps: [
            { title: "Open Site settings", text: "Open your project, then Site settings → Custom code.", scene: { type: "menu", app: "Webflow", items: ["Site settings", "Custom code"] } },
            { title: "Paste in Footer code", text: "Paste the copied line into the \"Footer code\" box (before </body> tag).", scene: { type: "paste", app: "Custom code", label: "Footer code", action: "Save changes" } },
            { title: "Save and publish", text: "Click Save changes, then Publish your site.", scene: { type: "menu", app: "Webflow", items: ["Save changes", "Publish"] } },
            site,
          ],
        },
      ],
    },
    {
      id: "gtm",
      name: "Google Tag Manager",
      tagline: "Custom HTML tag",
      variants: [
        {
          id: "tag",
          label: "Custom HTML tag",
          language: "HTML",
          code: tag,
          note: "Use this when your site already runs Google Tag Manager. Some cookie banners hold tags back until the visitor accepts.",
          steps: [
            { title: "Create a tag", text: "In Tag Manager open Tags → New.", scene: { type: "menu", app: "Tag Manager", items: ["Tags", "New"] } },
            { title: "Choose Custom HTML", text: "Under Tag Configuration choose Custom HTML and paste the copied line.", scene: { type: "paste", app: "Tag Manager", label: "Custom HTML", action: "Triggering" } },
            { title: "Fire on All Pages", text: "Under Triggering choose All Pages, name the tag \"BuPulse chat\" and click Save.", scene: { type: "menu", app: "Tag Manager", items: ["Triggering → All Pages", "Save"] } },
            { title: "Submit", text: "Click Submit, then Publish.", scene: { type: "menu", app: "Tag Manager", items: ["Submit", "Publish"] } },
            site,
          ],
        },
      ],
    },
  ];
}

export const PASTE_WARNING = "Paste the line exactly as shown. Don't save the code as a file.";

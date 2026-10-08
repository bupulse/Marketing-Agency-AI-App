// Installs the BuPulse chat widget on a zone through Cloudflare Zaraz's "Custom HTML" tool.
//
// Why Zaraz: it is available on the Free plan, needs only a "Zaraz Edit" token permission, is configured as data (no
// code is deployed to the customer's account), and a tool can be removed again by deleting its entry. The alternatives
// were ruled out: Snippets are not on the Free plan, and an HTML-rewriting Worker route needs Workers permissions and
// puts the whole site behind the Free plan's 100,000 requests a day limit.
//
// The whole Zaraz config is read, one tool is added or replaced (found by name, so running it twice changes nothing),
// and the config is written back and published. Every other tool and trigger is passed through untouched.
//
// NOTE: the custom-html tool shape below follows Cloudflare's config schema as far as it is documented; it has not been
// run against a real account yet (see docs/CONNECTORS.md). If Cloudflare rejects it, the caller falls back to the
// "copy this into your site" step.
import { cf } from "./client";

export const TOOL_NAME = "BuPulse chat widget";

/**
 * The tool is named after the business's widget key, so two BuPulse businesses on the same zone each keep their own
 * tool and neither can take over, update or remove the other's. (The key is already public in the script tag.)
 */
export const toolNameFor = (widgetKey: string) => `${TOOL_NAME} (${widgetKey})`;

type ZarazConfig = {
  tools?: Record<string, ZarazTool>;
  triggers?: Record<string, Record<string, unknown> & { system?: string }>;
  [key: string]: unknown;
};
type ZarazAction = { data?: { htmlCode?: string }; [key: string]: unknown };
type ZarazTool = { name?: string; actions?: Record<string, ZarazAction>; [key: string]: unknown };

const rid = () => `bp${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`;

/** The tool entry for the widget script. */
export function buildTool(html: string, triggerId: string, actionId: string, name = TOOL_NAME): ZarazTool {
  return {
    blockingTriggers: [],
    enabled: true,
    name,
    type: "custom-html",
    component: "html",
    defaultFields: {},
    settings: {},
    actions: {
      [actionId]: { actionType: "html", blockingTriggers: [], firingTriggers: [triggerId], data: { htmlCode: html } },
    },
  };
}

/** Finds this widget's tool by its name (which holds the widget key). Tools of other businesses are never matched. */
export function findTool(config: ZarazConfig, widgetKey: string): [string, ZarazTool] | null {
  const name = toolNameFor(widgetKey);
  return Object.entries(config.tools ?? {}).find(([, tool]) => tool?.name === name) ?? null;
}

const htmlOf = (tool: ZarazTool | undefined) => Object.values(tool?.actions ?? {})[0]?.data?.htmlCode;

/** Reads the config back: a change Cloudflare accepted but did not keep must not be reported as done. */
async function confirmInstalled(token: string, zoneId: string, widgetKey: string, html: string, fetchImpl: typeof fetch) {
  const { result: after } = await cf<ZarazConfig>(token, configPath(zoneId), {}, fetchImpl);
  const found = findTool(after, widgetKey);
  if (!found || htmlOf(found[1]) !== html || found[1].enabled === false) throw new Error("Cloudflare accepted the change but did not keep it.");
}

function pageviewTrigger(config: ZarazConfig): { id: string; add?: Record<string, unknown> } {
  const existing = Object.entries(config.triggers ?? {}).find(([, t]) => t.system === "pageload");
  if (existing) return { id: existing[0] };
  const id = rid();
  return {
    id,
    add: { name: "Pageview", system: "pageload", excludeRules: [], loadRules: [{ match: "{{ client.__zarazTrack }}", op: "EQUALS", value: "Pageview" }] },
  };
}

const configPath = (zoneId: string) => `/zones/${zoneId}/settings/zaraz/config`;

async function writeAndPublish(token: string, zoneId: string, config: ZarazConfig, note: string, fetchImpl: typeof fetch) {
  await cf(token, configPath(zoneId), { method: "PUT", body: config }, fetchImpl);
  await cf(token, `/zones/${zoneId}/settings/zaraz/publish`, { method: "POST", body: note }, fetchImpl);
}

/** Adds the widget (or updates its HTML). `changed` is false when it was already there exactly as wanted. */
export async function installWidget(token: string, zoneId: string, html: string, widgetKey: string, fetchImpl: typeof fetch = fetch): Promise<{ toolId: string; changed: boolean }> {
  const { result: config } = await cf<ZarazConfig>(token, configPath(zoneId), {}, fetchImpl);
  const found = findTool(config, widgetKey);
  if (found) {
    const [toolId, tool] = found;
    const actions = Object.values(tool.actions ?? {});
    if (tool.enabled !== false && actions.length > 0 && actions.every((a) => a.data?.htmlCode === html)) return { toolId, changed: false };
    const trigger = pageviewTrigger(config);
    const next: ZarazConfig = {
      ...config,
      triggers: trigger.add ? { ...config.triggers, [trigger.id]: trigger.add } : config.triggers,
      tools: { ...config.tools, [toolId]: buildTool(html, trigger.id, Object.keys(tool.actions ?? {})[0] ?? rid(), toolNameFor(widgetKey)) },
    };
    await writeAndPublish(token, zoneId, next, "Updated BuPulse chat widget", fetchImpl);
    await confirmInstalled(token, zoneId, widgetKey, html, fetchImpl);
    return { toolId, changed: true };
  }
  const trigger = pageviewTrigger(config);
  const toolId = rid();
  const next: ZarazConfig = {
    ...config,
    triggers: trigger.add ? { ...config.triggers, [trigger.id]: trigger.add } : config.triggers,
    tools: { ...config.tools, [toolId]: buildTool(html, trigger.id, rid(), toolNameFor(widgetKey)) },
  };
  await writeAndPublish(token, zoneId, next, "Added BuPulse chat widget", fetchImpl);
  await confirmInstalled(token, zoneId, widgetKey, html, fetchImpl);
  return { toolId, changed: true };
}

/** Removes the widget tool. Other tools and triggers stay. Safe to call when it is already gone. */
export async function removeWidget(token: string, zoneId: string, widgetKey: string, fetchImpl: typeof fetch = fetch): Promise<{ changed: boolean }> {
  const { result: config } = await cf<ZarazConfig>(token, configPath(zoneId), {}, fetchImpl);
  const found = findTool(config, widgetKey);
  if (!found) return { changed: false };
  const tools = { ...config.tools };
  delete tools[found[0]];
  await writeAndPublish(token, zoneId, { ...config, tools }, "Removed BuPulse chat widget", fetchImpl);
  return { changed: true };
}

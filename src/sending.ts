import {
  fetchTorrent,
  isIsolatedContext,
  type LinkContext,
  magnetName,
} from "./links.ts";
import { QuiClient, type TorrentFile } from "./qui.ts";
import type { SendChoices } from "./schemas.ts";
import { isConfigured, loadSettings, type Settings } from "./settings.ts";
import { refreshQuiTheme } from "./theme.ts";

export const SETUP_NOTIFICATION = "qui-setup";
const NOTIFICATION_ICON = browser.runtime.getURL("icons/icon-192.png");

export class NotConfiguredError extends Error {
  constructor() {
    super("qui isn't set up yet. Open the extension's settings to connect it.");
  }
}

/** What qui should receive, plus a name to show the user. */
export type Source = { file: TorrentFile } | { url: string; name: string };

export function sourceName(source: Source): string {
  return "file" in source ? source.file.filename : source.name;
}

/** Best-effort: a notification that can't be shown mustn't turn a successful send into a failure. */
export async function notify(title: string, message: string, id?: string) {
  const options = { type: "basic", iconUrl: NOTIFICATION_ICON, title, message } as const;
  try {
    await (id ? browser.notifications.create(id, options) : browser.notifications.create(options));
  } catch (err) {
    console.warn("Couldn't show notification", err);
  }
}

/**
 * Turns a clicked link into a source: magnets, and links from contexts whose cookies this
 * script can't use, go to qBittorrent as URLs; anything else is downloaded here.
 */
export async function resolveLink(url: string, context: LinkContext): Promise<Source> {
  if (/^magnet:/i.test(url)) return { url, name: magnetName(url) };
  if (isIsolatedContext(context)) return { url, name: url };
  return { file: await fetchTorrent(url) };
}

/** The settings' defaults, with any per-torrent overrides applied. */
export function resolveChoices(
  settings: Settings & { instanceId: number },
  overrides: Partial<SendChoices> = {},
): SendChoices {
  return {
    instanceId: settings.instanceId,
    category: settings.category,
    tags: settings.tags,
    startState: settings.startState,
    ...overrides,
  };
}

/** Adds a source to qui. Resolves to the name of the instance it went to. */
export async function sendSource(source: Source, overrides: Partial<SendChoices> = {}): Promise<string> {
  const settings = await loadSettings();
  if (!isConfigured(settings)) throw new NotConfiguredError();

  const { instanceId, ...options } = resolveChoices(settings, overrides);
  const client = new QuiClient(settings.baseUrl, settings.apiKey);
  await client.addTorrents(instanceId, {
    ...("file" in source ? { files: [source.file] } : { urls: [source.url] }),
    ...options,
  });
  // qui answered, so this is a cheap moment to pick up any theme change made there.
  refreshQuiTheme(client).catch(() => {});
  return settings.instances.find((i) => i.id === instanceId)?.name ?? "qui";
}

/**
 * Resolves a source, sends it, and reports the outcome as a notification. Resolves to whether
 * it succeeded; `failureNote` is appended to the error notification.
 */
export async function sendAndNotify(
  getSource: () => Promise<Source>,
  { overrides, failureNote = "" }: { overrides?: Partial<SendChoices>; failureNote?: string } = {},
): Promise<boolean> {
  try {
    if (!isConfigured(await loadSettings())) throw new NotConfiguredError();
    const source = await getSource();
    const instance = await sendSource(source, overrides);
    await notify(`Sent to ${instance}`, sourceName(source));
    return true;
  } catch (err) {
    if (err instanceof NotConfiguredError) {
      await notify("qui isn't set up", "Click to open the extension settings.", SETUP_NOTIFICATION);
    } else {
      await notify("Couldn't send to qui", `${(err as Error).message}${failureNote}`);
    }
    return false;
  }
}

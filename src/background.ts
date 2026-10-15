import * as v from "valibot";
import { toBase64 } from "./bytes.ts";
import { readDownloadedFile } from "./host-client.ts";
import { fetchTorrent, isIsolatedContext, isTorrentDownload, looksLikeTorrent, torrentFile } from "./links.ts";
import { svgDataUrl } from "./logo.ts";
import { parseMenuId, rebuildMenus, refreshCategoryCache } from "./menus.ts";
import { cancelPending, cancelPendingForWindow, openPicker, sendPending } from "./pending.ts";
import { QuiClient } from "./qui.ts";
import { type MagnetReply, type Message, MessageSchema, type Pending } from "./schemas.ts";
import {
  NotConfiguredError,
  notify,
  resolveLink,
  SETUP_NOTIFICATION,
  sendAndNotify,
  type Source,
} from "./sending.ts";
import { isConfigured, loadSettings } from "./settings.ts";
import { applyQuiTheme, darkSchemeQuery, refreshQuiTheme, themedBadgeSvg } from "./theme.ts";

const DEFAULT_TOOLBAR_ICON = { 64: "icons/icon-64.png", 192: "icons/icon-192.png" };
const TOOLBAR_ICON_SIZES = [16, 32, 64];

async function pendingSource(source: Source): Promise<Pending["source"]> {
  if (!("file" in source)) return { kind: "url", url: source.url, name: source.name };
  const bytes = new Uint8Array(await source.file.blob.arrayBuffer());
  return { kind: "file", filename: source.file.filename, base64: toBase64(bytes) };
}

async function reportFailure(err: unknown, failureNote = "") {
  if (err instanceof NotConfiguredError) {
    await notify("qui isn't set up", "Click to open the extension settings.", SETUP_NOTIFICATION);
  } else {
    await notify("Couldn't send to qui", `${(err as Error).message}${failureNote}`);
  }
}

/**
 * Redraws the toolbar icon in qui's theme colours. The theme is applied to this background
 * page's own document so that the browser resolves its variables, variations and dark mode.
 */
async function updateToolbarIcon() {
  applyQuiTheme((await loadSettings()).theme);
  const badge = themedBadgeSvg();
  if (!badge) {
    await browser.action.setIcon({ path: DEFAULT_TOOLBAR_ICON });
    return;
  }

  const image = new Image();
  image.src = svgDataUrl(badge);
  await image.decode();

  const imageData: Record<number, ImageData> = {};
  for (const size of TOOLBAR_ICON_SIZES) {
    const canvas = new OffscreenCanvas(size, size);
    const context = canvas.getContext("2d");
    if (!context) return;
    context.drawImage(image, 0, 0, size, size);
    imageData[size] = context.getImageData(0, 0, size, size);
  }
  await browser.action.setIcon({ imageData });
}

async function refreshFromQui() {
  const settings = await loadSettings();
  if (settings.baseUrl && settings.apiKey) {
    // Offline: keep the cached theme.
    await refreshQuiTheme(new QuiClient(settings.baseUrl, settings.apiKey)).catch(() => {});
  }
  await updateToolbarIcon();
  await refreshCategoryCache();
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

browser.runtime.onInstalled.addListener(async ({ reason }) => {
  await rebuildMenus();
  if (reason === "install") await browser.runtime.openOptionsPage();
  await refreshFromQui();
});

browser.runtime.onStartup.addListener(async () => {
  await rebuildMenus();
  await refreshFromQui();
});

browser.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (["instances", "instanceId", "category", "categories"].some((key) => key in changes)) {
    rebuildMenus();
  }
  if ("theme" in changes) updateToolbarIcon();
});

// Only fires while the background page is awake; a scheme change while it sleeps is picked
// up the next time it starts.
darkSchemeQuery.addEventListener("change", updateToolbarIcon);

browser.action.onClicked.addListener(() => browser.runtime.openOptionsPage());

browser.notifications.onClicked.addListener((id) => {
  if (id === SETUP_NOTIFICATION) browser.runtime.openOptionsPage();
});

// Categories change in qui without the extension hearing about it, so the menu re-checks
// them each time it opens and redraws if they moved.
browser.menus.onShown.addListener(async (info) => {
  if (!info.contexts.includes("link")) return;
  if (await refreshCategoryCache()) {
    await rebuildMenus();
    browser.menus.refresh();
  }
});

browser.menus.onClicked.addListener(async (info, tab) => {
  const action = parseMenuId(String(info.menuItemId));
  const url = info.linkUrl;
  if (!action || !url) return;
  const context = { incognito: tab?.incognito, cookieStoreId: tab?.cookieStoreId };

  if (action.kind === "category") {
    await sendAndNotify(() => resolveLink(url, context), {
      overrides: { instanceId: action.instanceId, category: action.category },
    });
    return;
  }
  try {
    if (!isConfigured(await loadSettings())) throw new NotConfiguredError();
    await openPicker({
      source: await pendingSource(await resolveLink(url, context)),
      instanceId: action.instanceId,
      onCancel: { action: "nothing" },
    });
  } catch (err) {
    await reportFailure(err);
  }
});

/**
 * "refetch" mode: cancels a torrent download as it starts and fetches the link again here.
 * Works without the helper, but the tracker sees a second request. If the torrent can't be
 * sent, or the picker is dismissed, the user still ends up with the file.
 */
browser.downloads.onCreated.addListener(async (item) => {
  if (item.byExtensionId === browser.runtime.id) return;
  if (!isTorrentDownload(item) || item.url.startsWith("blob:")) return;

  const settings = await loadSettings();
  if (settings.downloadHandling !== "refetch" || !isConfigured(settings)) return;

  // Small files are often finished by the time this runs, so cancel alone isn't enough.
  await browser.downloads.cancel(item.id).catch(() => {});
  await browser.downloads.removeFile(item.id).catch(() => {});
  await browser.downloads.erase({ id: item.id });

  const context = { incognito: item.incognito, cookieStoreId: item.cookieStoreId };
  const failureNote = " The file was downloaded instead.";
  const redownload = () =>
    browser.downloads
      .download({
        url: item.url,
        ...(item.incognito ? { incognito: true } : { cookieStoreId: item.cookieStoreId }),
      })
      .catch(() => {});

  if (!settings.askBeforeSending) {
    const sent = await sendAndNotify(() => resolveLink(item.url, context), { failureNote });
    if (!sent) await redownload();
    return;
  }

  try {
    if (isIsolatedContext(context)) {
      await openPicker({
        source: { kind: "url", url: item.url, name: basename(item.filename) },
        onCancel: {
          action: "redownload",
          url: item.url,
          incognito: item.incognito,
          cookieStoreId: item.incognito ? undefined : item.cookieStoreId,
        },
      });
    } else {
      // Bytes already fetched are saved directly on cancel, rather than asking the tracker again.
      await openPicker({
        source: await pendingSource({ file: await fetchTorrent(item.url) }),
        onCancel: { action: "save-file" },
      });
    }
  } catch (err) {
    await reportFailure(err, failureNote);
    await redownload();
  }
});

/**
 * "file" mode: lets the download finish untouched, then sends the saved file through the
 * native helper and removes it. If sending fails, the file stays where Firefox saved it.
 */
browser.downloads.onChanged.addListener(async (delta) => {
  if (delta.state?.current !== "complete") return;

  const settings = await loadSettings();
  if (settings.downloadHandling !== "file" || !isConfigured(settings)) return;
  const [item] = await browser.downloads.search({ id: delta.id });
  if (!item || item.byExtensionId === browser.runtime.id || !isTorrentDownload(item)) return;

  const readFile = async () => {
    const bytes = await readDownloadedFile(item.filename);
    if (!looksLikeTorrent(bytes)) throw new Error("The downloaded file isn't a torrent.");
    return bytes;
  };
  const failureNote = " The file is still in your downloads.";

  if (settings.askBeforeSending) {
    try {
      const bytes = await readFile();
      await openPicker({
        source: { kind: "file", filename: basename(item.filename), base64: toBase64(bytes) },
        downloadId: item.id,
        onCancel: { action: "nothing" },
      });
    } catch (err) {
      await reportFailure(err, failureNote);
    }
    return;
  }

  const sent = await sendAndNotify(
    async () => ({ file: torrentFile(await readFile(), basename(item.filename)) }),
    { failureNote },
  );
  if (sent) {
    await browser.downloads.removeFile(item.id).catch(() => {});
    await browser.downloads.erase({ id: item.id });
  }
});

browser.windows.onRemoved.addListener(cancelPendingForWindow);

async function handleMessage(message: Message): Promise<unknown> {
  switch (message.type) {
    case "send-link": {
      const settings = await loadSettings();
      if (settings.askBeforeSending && isConfigured(settings)) {
        // The magnet page shows the picker in its own tab instead of opening a window.
        const pickerId = await openPicker(
          { source: await pendingSource(await resolveLink(message.url, {})), onCancel: { action: "nothing" } },
          { inTab: true },
        );
        return { result: "ask", pickerId } satisfies MagnetReply;
      }
      const sent = await sendAndNotify(() => resolveLink(message.url, {}));
      return { result: sent ? "sent" : "failed" } satisfies MagnetReply;
    }
    case "picker-send":
      return sendPending(message.id, message.choices);
    case "picker-cancel":
      return cancelPending(message.id);
    case "refresh-categories":
      await refreshCategoryCache();
      return undefined;
  }
}

browser.runtime.onMessage.addListener((message: unknown) => {
  const parsed = v.safeParse(MessageSchema, message);
  return parsed.success ? handleMessage(parsed.output) : undefined;
});

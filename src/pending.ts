import * as v from "valibot";
import { fromBase64 } from "./bytes.ts";
import { torrentFile } from "./links.ts";
import { type Pending, PendingSchema, type PickerReply, type SendChoices } from "./schemas.ts";
import { notify, sendSource, type Source, sourceName } from "./sending.ts";

const PREFIX = "pending:";
const PICKER_SIZE = { width: 460, height: 560 };

async function getPending(id: string): Promise<Pending | null> {
  const key = PREFIX + id;
  const parsed = v.safeParse(PendingSchema, (await browser.storage.session.get(key))[key]);
  return parsed.success ? parsed.output : null;
}

function removePending(id: string) {
  return browser.storage.session.remove(PREFIX + id);
}

function toSource(pending: Pending): Source {
  const { source } = pending;
  return source.kind === "file"
    ? { file: torrentFile(fromBase64(source.base64), source.filename) }
    : { url: source.url, name: source.name };
}

/**
 * Stores a torrent for the picker and opens it in a small window, or, with `inTab`, leaves
 * the caller to show it in its own tab. Resolves to the picker id.
 */
export async function openPicker(pending: Pending, { inTab = false } = {}): Promise<string> {
  const id = crypto.randomUUID();
  await browser.storage.session.set({ [PREFIX + id]: pending });
  if (!inTab) {
    const window = await browser.windows.create({
      type: "popup",
      url: `picker.html?id=${id}`,
      ...PICKER_SIZE,
    });
    await browser.storage.session.set({ [PREFIX + id]: { ...pending, windowId: window.id } });
  }
  return id;
}

/** Sends a pending torrent with the picker's choices. On failure it stays pending, for a retry. */
export async function sendPending(id: string, choices: SendChoices): Promise<PickerReply> {
  const pending = await getPending(id);
  if (!pending) return { ok: false, error: "This torrent has already been handled." };

  try {
    const source = toSource(pending);
    const instance = await sendSource(source, choices);
    await removePending(id);
    await notify(`Sent to ${instance}`, sourceName(source));
    if (pending.downloadId !== undefined) {
      await browser.downloads.removeFile(pending.downloadId).catch(() => {});
      await browser.downloads.erase({ id: pending.downloadId });
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** Drops a pending torrent without sending it, leaving any download as Firefox would have. */
export async function cancelPending(id: string): Promise<void> {
  const pending = await getPending(id);
  if (!pending) return;
  await removePending(id);

  const { onCancel, source } = pending;
  if (onCancel.action === "save-file" && source.kind === "file") {
    const blob = new Blob([fromBase64(source.base64)], { type: "application/x-bittorrent" });
    const url = URL.createObjectURL(blob);
    try {
      await browser.downloads.download({ url, filename: source.filename });
    } finally {
      // The download has its own reference once it starts.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }
  } else if (onCancel.action === "redownload") {
    const where = onCancel.incognito
      ? { incognito: true }
      : onCancel.cookieStoreId
        ? { cookieStoreId: onCancel.cookieStoreId }
        : {};
    await browser.downloads.download({ url: onCancel.url, ...where });
  }
}

/** Treats closing a picker window like pressing Cancel. */
export async function cancelPendingForWindow(windowId: number): Promise<void> {
  const all = await browser.storage.session.get();
  for (const [key, value] of Object.entries(all)) {
    if (!key.startsWith(PREFIX)) continue;
    const parsed = v.safeParse(PendingSchema, value);
    if (parsed.success && parsed.output.windowId === windowId) {
      await cancelPending(key.slice(PREFIX.length));
    }
  }
}

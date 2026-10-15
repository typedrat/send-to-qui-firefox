import type { TorrentFile } from "./qui.ts";

/** Where a link came from, for picking cookies and the target instance. */
export interface LinkContext {
  instanceId?: number;
  incognito?: boolean;
  cookieStoreId?: string;
}

/**
 * True when the link came from somewhere whose cookies a background fetch can't use: a
 * private window or a non-default container. Those links are handed to qBittorrent as URLs
 * rather than fetched here with the wrong (or identifying) cookies.
 */
export function isIsolatedContext({ incognito, cookieStoreId }: LinkContext): boolean {
  return Boolean(incognito) || Boolean(cookieStoreId && cookieStoreId !== "firefox-default");
}

/** The filename a response asks to be saved as, falling back to the URL's last path segment. */
export function filenameFromDisposition(disposition: string | null | undefined, url: string): string {
  const encoded = disposition?.match(/filename\*\s*=\s*[^']*'[^']*'([^;]+)/i)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded.trim().replace(/^"|"$/g, ""));
    } catch {
      // Malformed percent-encoding; try the plain filename parameter instead.
    }
  }
  const plain = disposition?.match(/filename\s*=\s*(?:"([^"]*)"|([^;]+))/i);
  const name = plain?.[1] ?? plain?.[2];
  if (name) return name.trim();

  const last = new URL(url).pathname.split("/").filter(Boolean).pop();
  return last ? decodeURIComponent(last) : "download.torrent";
}

export function magnetName(url: string): string {
  try {
    return new URL(url).searchParams.get("dn") || "magnet link";
  } catch {
    return "magnet link";
  }
}

/** Every torrent file is a bencoded dictionary, which always starts with "d". */
export function looksLikeTorrent(bytes: Uint8Array): boolean {
  return bytes[0] === 0x64;
}

export function torrentFile(bytes: Uint8Array<ArrayBuffer>, filename: string): TorrentFile {
  return { blob: new Blob([bytes], { type: "application/x-bittorrent" }), filename };
}

export async function fetchTorrent(url: string): Promise<TorrentFile> {
  let res: Response;
  try {
    res = await fetch(url, { credentials: "include" });
  } catch (err) {
    throw new Error(`Download failed: ${(err as Error).message}`);
  }
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);

  const bytes = new Uint8Array(await res.arrayBuffer());
  // Anything else is usually a login page or an error from the tracker.
  if (!looksLikeTorrent(bytes)) throw new Error("The link didn't return a torrent file. Are you logged in?");
  return torrentFile(bytes, filenameFromDisposition(res.headers.get("content-disposition"), url));
}

export function isTorrentDownload(item: Pick<browser.downloads.DownloadItem, "mime" | "filename">): boolean {
  return item.mime === "application/x-bittorrent" || /\.torrent$/i.test(item.filename ?? "");
}

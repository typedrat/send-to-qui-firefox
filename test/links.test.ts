import { afterAll, describe, expect, test } from "bun:test";
import {
  fetchTorrent,
  filenameFromDisposition,
  isIsolatedContext,
  isTorrentDownload,
  magnetName,
} from "../src/links.ts";
import { makeTorrent } from "./torrent.ts";

describe("filenameFromDisposition", () => {
  test("prefers the RFC 5987 filename*", () => {
    const disposition = `attachment; filename="fallback.torrent"; filename*=UTF-8''Ubuntu%2024.04%20%E2%9C%93.torrent`;
    expect(filenameFromDisposition(disposition, "https://t.example/dl/1")).toBe("Ubuntu 24.04 ✓.torrent");
  });

  test("reads quoted and bare filenames", () => {
    expect(filenameFromDisposition(`attachment; filename="a b.torrent"`, "https://x/")).toBe("a b.torrent");
    expect(filenameFromDisposition("attachment; filename=c.torrent", "https://x/")).toBe("c.torrent");
  });

  test("falls back to the plain filename when filename* is malformed", () => {
    const disposition = `attachment; filename*=UTF-8''%E2%28; filename="ok.torrent"`;
    expect(filenameFromDisposition(disposition, "https://x/")).toBe("ok.torrent");
  });

  test("falls back to the URL path, then a generic name", () => {
    expect(filenameFromDisposition(null, "https://x/files/My%20Show.torrent?passkey=1")).toBe("My Show.torrent");
    expect(filenameFromDisposition(null, "https://x/")).toBe("download.torrent");
  });
});

test("magnetName uses the display name, or a generic label", () => {
  expect(magnetName("magnet:?xt=urn:btih:abc&dn=Some+Show+S01")).toBe("Some Show S01");
  expect(magnetName("magnet:?xt=urn:btih:abc")).toBe("magnet link");
});

test("isIsolatedContext flags private windows and non-default containers", () => {
  expect(isIsolatedContext({})).toBe(false);
  expect(isIsolatedContext({ cookieStoreId: "firefox-default" })).toBe(false);
  expect(isIsolatedContext({ incognito: true })).toBe(true);
  expect(isIsolatedContext({ cookieStoreId: "firefox-container-2" })).toBe(true);
});

test("isTorrentDownload matches on MIME type or extension", () => {
  expect(isTorrentDownload({ mime: "application/x-bittorrent", filename: "/tmp/dl" })).toBe(true);
  expect(isTorrentDownload({ mime: "application/octet-stream", filename: "/tmp/A.TORRENT" })).toBe(true);
  expect(isTorrentDownload({ mime: "application/pdf", filename: "/tmp/a.pdf" })).toBe(false);
});

describe("fetchTorrent", () => {
  const torrent = makeTorrent("fetch-test");
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      const { pathname } = new URL(req.url);
      if (pathname === "/ok") {
        return new Response(torrent, {
          headers: { "content-disposition": `attachment; filename="fetch-test.torrent"` },
        });
      }
      if (pathname === "/login") return new Response("<html>Please log in</html>");
      return new Response("nope", { status: 404, statusText: "Not Found" });
    },
  });
  afterAll(() => server.stop());

  test("returns the file and its name", async () => {
    const file = await fetchTorrent(`${server.url}ok`);
    expect(file.filename).toBe("fetch-test.torrent");
    expect(new Uint8Array(await file.blob.arrayBuffer())).toEqual(torrent);
  });

  test("rejects pages that aren't torrents", () => {
    expect(fetchTorrent(`${server.url}login`)).rejects.toThrow("Are you logged in?");
  });

  test("reports HTTP errors", () => {
    expect(fetchTorrent(`${server.url}missing`)).rejects.toThrow("404 Not Found");
  });
});

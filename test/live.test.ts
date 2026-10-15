// Runs against a real qui when QUI_URL and QUI_API_KEY are set, e.g.
//   QUI_URL=http://localhost:7476 QUI_API_KEY=... bun test live
// It adds two paused torrents to the first instance (or QUI_INSTANCE_ID) and doesn't remove them.
import { describe, expect, test } from "bun:test";
import { QuiClient } from "../src/qui.ts";
import { fetchQuiTheme } from "../src/theme.ts";
import { makeTorrent } from "./torrent.ts";

const { QUI_URL, QUI_API_KEY, QUI_INSTANCE_ID } = process.env;

describe.skipIf(!QUI_URL || !QUI_API_KEY)("live qui", () => {
  const client = new QuiClient(QUI_URL ?? "", QUI_API_KEY ?? "");
  const stamp = Date.now();

  async function instanceId() {
    if (QUI_INSTANCE_ID) return Number(QUI_INSTANCE_ID);
    const [first] = await client.listInstances();
    if (!first) throw new Error("qui has no instances to test against");
    return first.id;
  }

  test("lists instances, categories and tags", async () => {
    const id = await instanceId();
    expect(Array.isArray(await client.listCategories(id))).toBe(true);
    expect(Array.isArray(await client.listTags(id))).toBe(true);
  });

  test("reads the selected theme", async () => {
    const result = await fetchQuiTheme(client);
    if (result.status === "applied") expect(result.theme.css).toContain("--primary");
  });

  test("adds a torrent file", async () => {
    const blob = new Blob([makeTorrent(`send-to-qui-test-${stamp}`)]);
    const result = await client.addTorrents(await instanceId(), {
      files: [{ blob, filename: `send-to-qui-test-${stamp}.torrent` }],
      startState: "paused",
    });
    expect(result.added).toBe(1);
  });

  test("adds a magnet link", async () => {
    const hash = new Bun.CryptoHasher("sha1").update(`magnet-${stamp}`).digest("hex");
    const result = await client.addTorrents(await instanceId(), {
      urls: [`magnet:?xt=urn:btih:${hash}&dn=send-to-qui-test-magnet-${stamp}`],
      startState: "paused",
    });
    expect(result.added).toBe(1);
  });
});

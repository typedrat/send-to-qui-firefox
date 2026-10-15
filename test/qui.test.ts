import { afterAll, beforeEach, expect, test } from "bun:test";
import { QuiClient } from "../src/qui.ts";
import { fetchQuiTheme } from "../src/theme.ts";

// A stand-in for qui: each test sets the response, and the last request is recorded.
let reply: () => Response;
let lastRequest: { path: string; apiKey: string | null; form: FormData | null };

const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const url = new URL(req.url);
    lastRequest = {
      path: url.pathname,
      apiKey: req.headers.get("x-api-key"),
      form: req.method === "POST" ? await req.formData() : null,
    };
    return reply();
  },
});
afterAll(() => server.stop());

const client = new QuiClient(`${server.url}qui/`, " key ");

beforeEach(() => {
  reply = () => Response.json([]);
});

test("sends the API key to the base path", async () => {
  await client.listInstances();
  expect(lastRequest.path).toBe("/qui/api/instances");
  expect(lastRequest.apiKey).toBe("key");
});

test("reports a rejected API key", () => {
  reply = () => Response.json({ error: "Unauthorized" }, { status: 401 });
  expect(client.listInstances()).rejects.toThrow("qui rejected the API key");
});

test("passes qui's error message through", () => {
  reply = () => Response.json({ error: "Instance is disabled" }, { status: 409 });
  expect(client.listTags(1)).rejects.toThrow("Instance is disabled");
});

test("falls back to the status line for non-JSON errors", () => {
  reply = () => new Response("<html>bad gateway</html>", { status: 502, statusText: "Bad Gateway" });
  expect(client.listInstances()).rejects.toThrow("502 Bad Gateway");
});

test("rejects responses that don't match the schema, naming the field", () => {
  reply = () => Response.json([{ id: "1", name: "seedbox" }]);
  expect(client.listInstances()).rejects.toThrow("/instances at 0.id");
});

test("drops fields the extension doesn't use", async () => {
  reply = () => Response.json([{ id: 1, name: "seedbox", host: "http://qbt", connected: true }]);
  expect(await client.listInstances()).toEqual([{ id: 1, name: "seedbox" }]);
});

test("treats null categories and tags as empty", async () => {
  reply = () => Response.json(null);
  expect(await client.listCategories(1)).toEqual([]);
  expect(await client.listTags(1)).toEqual([]);
});

test("returns category names", async () => {
  reply = () => Response.json({ tv: { name: "tv", savePath: "" }, movies: { name: "movies" } });
  expect(await client.listCategories(1)).toEqual(["tv", "movies"]);
});

test("addTorrents sends files with the chosen options", async () => {
  reply = () => Response.json({ message: "Torrent added successfully", added: 1, failed: 0 }, { status: 201 });
  const blob = new Blob(["d4:infodee"]);
  await client.addTorrents(2, {
    files: [{ blob, filename: "a.torrent" }],
    category: "tv",
    tags: "a,b",
    startState: "paused",
  });

  expect(lastRequest.path).toBe("/qui/api/instances/2/torrents");
  const form = lastRequest.form!;
  expect((form.get("torrent") as File).name).toBe("a.torrent");
  expect(form.get("category")).toBe("tv");
  expect(form.get("tags")).toBe("a,b");
  expect(form.get("paused")).toBe("true");
  expect(form.has("urls")).toBe(false);
});

test("addTorrents omits paused when deferring to qBittorrent", async () => {
  reply = () => Response.json({ message: "ok", added: 1, failed: 0 }, { status: 201 });
  await client.addTorrents(1, { urls: ["magnet:?xt=urn:btih:abc"], startState: "" });
  expect(lastRequest.form!.get("urls")).toBe("magnet:?xt=urn:btih:abc");
  expect(lastRequest.form!.has("paused")).toBe(false);
  expect(lastRequest.form!.has("category")).toBe(false);
});

test("addTorrents fails when nothing was added", () => {
  reply = () => Response.json({ message: "Added 0 torrent(s), 1 failed", added: 0, failed: 1 }, { status: 201 });
  expect(client.addTorrents(1, { urls: ["magnet:?xt=urn:btih:abc"] })).rejects.toThrow("1 failed");
});

test("fetchQuiTheme returns the selected theme with its variation", async () => {
  reply = () =>
    lastRequest.path.endsWith("/themes/settings")
      ? Response.json({ default: { themeId: "dragon", mode: "", variation: "pink" } })
      : Response.json({
          themes: [
            { id: "minimal", name: "Minimal", premium: false, css: ":root{}" },
            { id: "dragon", name: "Dragon", premium: false, css: "/* @lightOnly: true */ :root{}" },
          ],
        });
  expect(await fetchQuiTheme(client)).toEqual({
    status: "applied",
    name: "Dragon",
    theme: {
      id: "dragon",
      css: "/* @lightOnly: true */ :root{}",
      mode: "auto",
      variation: "pink",
      lightOnly: true,
    },
  });
});

test("fetchQuiTheme finds sideloaded custom themes", async () => {
  reply = () =>
    lastRequest.path.endsWith("/themes/settings")
      ? Response.json({ default: { themeId: "custom:mine", mode: "dark" } })
      : Response.json({ directory: "/themes", themes: [{ id: "mine", filename: "mine.css", css: ".dark{}" }] });
  expect(await fetchQuiTheme(client)).toMatchObject({
    status: "applied",
    theme: { id: "custom:mine", css: ".dark{}", variation: "" },
  });
});

test("fetchQuiTheme reports locked premium themes and unset settings", async () => {
  reply = () =>
    lastRequest.path.endsWith("/themes/settings")
      ? Response.json({ default: { themeId: "catppuccin", mode: "dark" } })
      : Response.json({ themes: [{ id: "catppuccin", name: "Catppuccin", premium: true }] });
  expect(await fetchQuiTheme(client)).toEqual({ status: "unavailable", themeId: "catppuccin" });

  reply = () => Response.json({});
  expect(await fetchQuiTheme(client)).toEqual({ status: "none-selected" });
});

// qui before 1.31 kept one selection and returned it flat, or null when unset.
test("fetchQuiTheme reads the flat selection from older qui versions", async () => {
  reply = () =>
    lastRequest.path.endsWith("/themes/settings")
      ? Response.json({ themeId: "catppuccin", mode: "dark", variation: "mauve" })
      : Response.json({ themes: [{ id: "catppuccin", name: "Catppuccin", premium: true, css: ":root{}" }] });
  expect(await fetchQuiTheme(client)).toMatchObject({
    status: "applied",
    name: "Catppuccin",
    theme: { id: "catppuccin", mode: "dark", variation: "mauve" },
  });

  reply = () => Response.json(null);
  expect(await fetchQuiTheme(client)).toEqual({ status: "none-selected" });
});

import { beforeEach, expect, test } from "bun:test";
import { loadManagedSettings, loadSettings, saveSettings } from "../src/settings.ts";

let local: Record<string, unknown>;
let managed: Record<string, unknown> | null;

beforeEach(() => {
  local = {};
  managed = null;
  globalThis.browser = {
    storage: {
      local: {
        get: async () => ({ ...local }),
        set: async (patch: Record<string, unknown>) => Object.assign(local, patch),
      },
      managed: {
        get: async () => {
          if (managed === null) throw new Error("Managed storage manifest not found");
          return managed;
        },
      },
    },
  } as unknown as typeof browser;
});

test("without a managed-storage manifest nothing is managed", async () => {
  local = { baseUrl: "https://qui.local", apiKey: "mine" };
  expect(await loadManagedSettings()).toEqual({});
  expect(await loadSettings()).toMatchObject({ baseUrl: "https://qui.local", apiKey: "mine" });
});

test("managed values override local ones; invalid managed values are ignored", async () => {
  local = { baseUrl: "https://old.local", apiKey: "old", category: "tv", startState: "paused" };
  managed = { baseUrl: "https://qui.example", apiKey: "secret", startState: "sideways", unknown: 1 };
  expect(await loadManagedSettings()).toEqual({ baseUrl: "https://qui.example", apiKey: "secret" });
  expect(await loadSettings()).toMatchObject({
    baseUrl: "https://qui.example",
    apiKey: "secret",
    category: "tv",
    startState: "paused",
  });
});

test("saving skips managed keys, so a managed API key is never copied into the profile", async () => {
  managed = { apiKey: "secret" };
  await saveSettings({ apiKey: "secret", baseUrl: "https://qui.example", category: "movies" });
  expect(local).toEqual({ baseUrl: "https://qui.example", category: "movies" });
});

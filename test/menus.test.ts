import { beforeEach, describe, expect, test } from "bun:test";
import { type MenuAction, menuId, parseMenuId, rebuildMenus } from "../src/menus.ts";

describe("menu ids", () => {
  const actions: MenuAction[] = [
    { kind: "category", instanceId: 3, category: "" },
    { kind: "category", instanceId: 3, category: "tv/anime & more 📺" },
    { kind: "choose", instanceId: 12 },
  ];

  test.each(actions)("round-trip %p", (action) => {
    expect(parseMenuId(menuId(action))).toEqual(action);
  });

  test("ignore ids that aren't ours", () => {
    expect(parseMenuId("qui")).toBeNull();
    expect(parseMenuId("qui/instance/3")).toBeNull();
    expect(parseMenuId("other/category/1/tv")).toBeNull();
  });
});

describe("rebuildMenus", () => {
  let created: browser.menus._CreateCreateProperties[];
  let stored: Record<string, unknown>;

  beforeEach(() => {
    created = [];
    globalThis.browser = {
      menus: {
        removeAll: async () => {},
        create: (props: browser.menus._CreateCreateProperties) => created.push(props),
      },
      storage: { local: { get: async () => stored } },
    } as unknown as typeof browser;
  });

  const titlesUnder = (parentId: string) =>
    created.filter((c) => c.parentId === parentId && c.type !== "separator").map((c) => c.title);

  test("lists one instance's categories directly, marking the default", async () => {
    stored = {
      instanceId: 1,
      category: "tv",
      instances: [{ id: 1, name: "seedbox" }],
      categories: { "1": ["tv", "movies", "R&B"] },
    };
    await rebuildMenus();
    expect(titlesUnder("qui")).toEqual([
      "No category",
      "movies",
      "R&&B",
      "tv (default)",
      "Choose category, tags…",
    ]);
  });

  test("nests categories under each instance when there are several", async () => {
    stored = {
      instanceId: 2,
      category: "",
      instances: [{ id: 1, name: "seedbox" }, { id: 2, name: "homelab" }],
      categories: { "1": ["tv"], "2": [] },
    };
    await rebuildMenus();
    expect(titlesUnder("qui")).toEqual(["seedbox", "homelab"]);
    expect(titlesUnder("qui/instance/1")).toEqual(["No category", "tv", "Choose category, tags…"]);
    expect(titlesUnder("qui/instance/2")).toEqual(["No category (default)", "Choose category, tags…"]);
  });
});

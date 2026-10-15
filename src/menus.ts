import { QuiClient } from "./qui.ts";
import { loadSettings, saveSettings, type Settings } from "./settings.ts";

const ROOT = "qui";

/** What a context-menu item does. Encoded in the item's id, which outlives this page. */
export type MenuAction =
  | { kind: "category"; instanceId: number; category: string }
  | { kind: "choose"; instanceId: number };

export function menuId(action: MenuAction): string {
  return action.kind === "category"
    ? `${ROOT}/category/${action.instanceId}/${encodeURIComponent(action.category)}`
    : `${ROOT}/choose/${action.instanceId}`;
}

export function parseMenuId(id: string): MenuAction | null {
  const [root, kind, instance, category] = id.split("/");
  const instanceId = Number(instance);
  if (root !== ROOT || !Number.isInteger(instanceId)) return null;
  if (kind === "choose") return { kind, instanceId };
  if (kind === "category" && category !== undefined) {
    return { kind, instanceId, category: decodeURIComponent(category) };
  }
  return null;
}

/** "&" marks an access key in menu titles, so a literal one has to be doubled. */
function menuTitle(text: string): string {
  return text.replaceAll("&", "&&");
}

function addInstanceItems(settings: Settings, instanceId: number, parentId: string) {
  const isDefaultInstance = instanceId === settings.instanceId;
  const names = [...(settings.categories[String(instanceId)] ?? [])].sort((a, b) => a.localeCompare(b));
  for (const category of ["", ...names]) {
    const label = category === "" ? "No category" : menuTitle(category);
    const isDefault = isDefaultInstance && category === settings.category;
    browser.menus.create({
      id: menuId({ kind: "category", instanceId, category }),
      parentId,
      title: isDefault ? `${label} (default)` : label,
      contexts: ["link"],
    });
  }
  browser.menus.create({ id: `${parentId}/separator`, parentId, type: "separator", contexts: ["link"] });
  browser.menus.create({
    id: menuId({ kind: "choose", instanceId }),
    parentId,
    title: "Choose category, tags…",
    contexts: ["link"],
  });
}

async function build() {
  await browser.menus.removeAll();
  const settings = await loadSettings();
  browser.menus.create({ id: ROOT, title: "Send to qui", contexts: ["link"] });

  if (settings.instances.length > 1) {
    for (const instance of settings.instances) {
      const parentId = `${ROOT}/instance/${instance.id}`;
      browser.menus.create({ id: parentId, parentId: ROOT, title: menuTitle(instance.name), contexts: ["link"] });
      addInstanceItems(settings, instance.id, parentId);
    }
  } else if (settings.instanceId != null) {
    addInstanceItems(settings, settings.instanceId, ROOT);
  }
}

// Rebuilds can be triggered from several events at once; overlapping ones would try to
// create the same ids twice.
let building: Promise<void> = Promise.resolve();

export function rebuildMenus(): Promise<void> {
  building = building.then(build, build);
  return building;
}

/**
 * Re-fetches every instance's categories into the settings cache. An instance that can't be
 * reached keeps its cached list. Resolves to whether anything changed.
 */
export async function refreshCategoryCache(): Promise<boolean> {
  const settings = await loadSettings();
  if (!settings.baseUrl || !settings.apiKey || !settings.instances.length) return false;

  const client = new QuiClient(settings.baseUrl, settings.apiKey);
  const results = await Promise.allSettled(
    settings.instances.map((i) => client.listCategories(i.id)),
  );
  const categories: Record<string, string[]> = {};
  settings.instances.forEach((instance, index) => {
    const result = results[index];
    const cached = settings.categories[String(instance.id)];
    if (result?.status === "fulfilled") categories[String(instance.id)] = result.value;
    else if (cached) categories[String(instance.id)] = cached;
  });

  if (JSON.stringify(categories) === JSON.stringify(settings.categories)) return false;
  await saveSettings({ categories });
  return true;
}

import * as v from "valibot";
import { QuiClient } from "./qui.ts";
import { NATIVE_MESSAGING, helperStatus } from "./host-client.ts";
import { $, fillSelect, loadCategoriesAndTags, normalizeTags, setStatus } from "./form.ts";
import { DownloadHandlingSchema, type Message, StartStateSchema } from "./schemas.ts";
import { loadManagedSettings, loadSettings, saveSettings, type Settings } from "./settings.ts";
import { describeQuiTheme, refreshQuiTheme, themeExtensionPage } from "./theme.ts";

const ALL_SITES = { origins: ["<all_urls>"] };

const form = {
  baseUrl: $<HTMLInputElement>("baseUrl"),
  apiKey: $<HTMLInputElement>("apiKey"),
  instanceId: $<HTMLSelectElement>("instanceId"),
  category: $<HTMLSelectElement>("category"),
  tags: $<HTMLInputElement>("tags"),
  tagOptions: $<HTMLDataListElement>("tag-options"),
  startState: $<HTMLSelectElement>("startState"),
  downloadHandling: $<HTMLSelectElement>("downloadHandling"),
  askBeforeSending: $<HTMLInputElement>("askBeforeSending"),
};
const connectionStatus = $("connection-status");
const defaultsStatus = $("defaults-status");

let client: QuiClient | null = null;

async function refreshPermissionBanner() {
  $("permission-banner").hidden = await browser.permissions.contains(ALL_SITES);
}

/** Explains what the selected download mode needs, and whether the helper is there. */
async function refreshHelperStatus() {
  const status = $("helper-status");
  status.className = "";
  $("allow-helper-row").hidden = true;
  if (form.downloadHandling.value === "refetch") {
    status.textContent = "Works without the helper, but the tracker sees each download twice.";
    return;
  }
  if (form.downloadHandling.value !== "file") {
    status.textContent = "";
    return;
  }
  const helper = await helperStatus();
  if (helper.state === "ready") {
    status.textContent = `Helper ${helper.version} is installed.`;
    return;
  }
  status.className = "error";
  if (helper.state === "not-permitted") {
    status.textContent = "Firefox needs your permission for the extension to use the helper.";
    $("allow-helper-row").hidden = false;
  } else {
    status.textContent =
      "Needs the native helper: run `bun run install-host` in the extension's source folder, " +
      "then reopen this page.";
  }
}

function loadInstanceOptions(qui: QuiClient, instanceId: number, savedCategory: string) {
  return loadCategoriesAndTags(qui, instanceId, savedCategory, form.category, form.tagOptions);
}

async function connect(settings: Settings) {
  setStatus(connectionStatus, "Connecting…");
  const qui = new QuiClient(settings.baseUrl, settings.apiKey);

  try {
    const instances = await qui.listInstances();
    if (!instances.length) {
      setStatus(connectionStatus, "Connected, but qui has no qBittorrent instances yet.", "error");
      return;
    }

    const instanceId = instances.some((i) => i.id === settings.instanceId)
      ? (settings.instanceId as number)
      : instances[0]!.id;
    await saveSettings({ baseUrl: qui.baseUrl, apiKey: qui.apiKey, instances, instanceId });
    client = qui;

    fillSelect(form.instanceId, instances.map((i) => [String(i.id), i.name]), String(instanceId));
    form.tags.value = settings.tags;
    form.startState.value = settings.startState;
    form.downloadHandling.value = settings.downloadHandling;
    form.askBeforeSending.checked = settings.askBeforeSending;
    await refreshHelperStatus();

    $("defaults").hidden = false;
    const count = `${instances.length} instance${instances.length === 1 ? "" : "s"}`;
    setStatus(connectionStatus, `Connected — ${count} found.`, "ok");
    // qui itself answered; an instance whose qBittorrent is down only costs its suggestions.
    try {
      await loadInstanceOptions(qui, instanceId, settings.category);
    } catch (err) {
      const category = settings.category;
      fillSelect(form.category, [["", "None"], ...(category ? [[category, category] as [string, string]] : [])], category);
      setStatus(defaultsStatus, `Couldn't load this instance's categories and tags: ${(err as Error).message}`, "error");
    }
    try {
      setStatus($("theme-status"), describeQuiTheme(await refreshQuiTheme(qui)));
    } catch (err) {
      setStatus($("theme-status"), `Couldn't load qui's theme: ${(err as Error).message}`, "error");
    }
    // Ask the background page to fill the context menu's category lists for these instances.
    await browser.runtime.sendMessage({ type: "refresh-categories" } satisfies Message);
  } catch (err) {
    setStatus(connectionStatus, (err as Error).message, "error");
  }
}

$("grant").addEventListener("click", async () => {
  await browser.permissions.request(ALL_SITES);
  await refreshPermissionBanner();
});

$("connection").addEventListener("submit", async (event) => {
  event.preventDefault();
  const settings = await loadSettings();
  const managed = await loadManagedSettings();
  await connect({
    ...settings,
    baseUrl: managed.baseUrl ?? form.baseUrl.value,
    apiKey: managed.apiKey ?? form.apiKey.value,
  });
});

form.instanceId.addEventListener("change", async () => {
  if (!client) return;
  try {
    await loadInstanceOptions(client, Number(form.instanceId.value), "");
  } catch (err) {
    setStatus(defaultsStatus, (err as Error).message, "error");
  }
});

form.downloadHandling.addEventListener("change", refreshHelperStatus);

// permissions.request needs a user action, and Firefox doesn't count a <select> change as one,
// so the permission is requested from its own button.
$("allow-helper").addEventListener("click", async () => {
  await browser.permissions.request(NATIVE_MESSAGING);
  await refreshHelperStatus();
});

$("defaults").addEventListener("submit", async (event) => {
  event.preventDefault();
  await saveSettings({
    instanceId: Number(form.instanceId.value),
    category: form.category.value,
    tags: normalizeTags(form.tags.value),
    startState: v.parse(StartStateSchema, form.startState.value),
    downloadHandling: v.parse(DownloadHandlingSchema, form.downloadHandling.value),
    askBeforeSending: form.askBeforeSending.checked,
  });
  setStatus(defaultsStatus, "Saved.", "ok");
});

/** Locks the fields the system configuration provides, so it's clear why they can't change. */
function lockManagedFields(managed: Partial<Settings>) {
  const fields: Partial<Record<keyof Settings, HTMLInputElement | HTMLSelectElement>> = {
    baseUrl: form.baseUrl,
    apiKey: form.apiKey,
    instanceId: form.instanceId,
    category: form.category,
    tags: form.tags,
    startState: form.startState,
    downloadHandling: form.downloadHandling,
    askBeforeSending: form.askBeforeSending,
  };
  const keys = Object.keys(managed) as (keyof Settings)[];
  for (const key of keys) {
    const field = fields[key];
    if (!field) continue;
    field.disabled = true;
    field.title = "Set by your system configuration";
  }
  if (managed.apiKey) form.apiKey.placeholder = "Provided by your system configuration";
  $("managed-note").hidden = keys.length === 0;
}

const settings = await loadSettings();
const managed = await loadManagedSettings();
themeExtensionPage(null);
await refreshPermissionBanner();
form.baseUrl.value = settings.baseUrl;
// A managed key stays out of the page; Connect uses it directly.
form.apiKey.value = managed.apiKey ? "" : settings.apiKey;
if (settings.baseUrl && settings.apiKey) await connect(settings);
lockManagedFields(managed);

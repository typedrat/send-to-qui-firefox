import * as v from "valibot";
import { ManagedSettingsSchema, type Settings, SettingsSchema } from "./schemas.ts";

export type { Settings };

/** Settings the system provides through managed storage, which the user can't change. */
export async function loadManagedSettings(): Promise<Partial<Settings>> {
  let raw: unknown;
  try {
    raw = await browser.storage.managed.get();
  } catch {
    // Firefox rejects when no managed-storage manifest exists for the extension.
    return {};
  }
  return v.parse(ManagedSettingsSchema, raw ?? {});
}

export async function loadSettings(): Promise<Settings> {
  const [local, managed] = await Promise.all([browser.storage.local.get(), loadManagedSettings()]);
  return { ...v.parse(SettingsSchema, local), ...managed };
}

/** Saves settings locally, skipping managed ones, so a managed API key never lands in the profile. */
export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  const managed = await loadManagedSettings();
  const local = Object.fromEntries(Object.entries(patch).filter(([key]) => !(key in managed)));
  if (Object.keys(local).length) await browser.storage.local.set(local);
}

export function isConfigured(
  settings: Settings,
): settings is Settings & { instanceId: number } {
  return Boolean(settings.baseUrl && settings.apiKey && settings.instanceId != null);
}

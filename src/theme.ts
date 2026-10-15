import { badgeSvg, logoSvg, svgDataUrl } from "./logo.ts";
import type { QuiClient } from "./qui.ts";
import type { CachedTheme } from "./schemas.ts";
import { loadSettings, saveSettings } from "./settings.ts";

export const darkSchemeQuery = window.matchMedia("(prefers-color-scheme: dark)");

/** Which theme qui has selected, and whether the extension could use it. */
export type QuiThemeResult =
  | { status: "applied"; theme: CachedTheme; name: string }
  | { status: "none-selected" }
  | { status: "unavailable"; themeId: string };

/** Fetches the theme selected in qui's default slot, with its CSS when qui serves it. */
export async function fetchQuiTheme(client: QuiClient): Promise<QuiThemeResult> {
  const slot = (await client.getThemeSettings()).default;
  if (!slot) return { status: "none-selected" };

  let css: string | undefined;
  let name = slot.themeId;
  if (slot.themeId.startsWith("custom:")) {
    const id = slot.themeId.slice("custom:".length);
    css = (await client.listCustomThemes()).find((t) => t.id === id)?.css;
    name = id;
  } else {
    const builtin = (await client.listThemes()).find((t) => t.id === slot.themeId);
    css = builtin?.css;
    name = builtin?.name ?? name;
  }
  // A premium theme comes without CSS when the install isn't licensed for it.
  if (!css) return { status: "unavailable", themeId: slot.themeId };

  const theme = {
    id: slot.themeId,
    css,
    mode: slot.mode,
    variation: slot.variation,
    lightOnly: /@lightOnly:\s*true/.test(css),
  };
  return { status: "applied", theme, name };
}

/**
 * Re-fetches qui's theme into the settings cache. If qui is unreachable the cached theme is
 * kept and the error is rethrown for callers that want to report it.
 */
export async function refreshQuiTheme(client: QuiClient): Promise<QuiThemeResult> {
  const result = await fetchQuiTheme(client);
  await saveSettings({ theme: result.status === "applied" ? result.theme : null });
  return result;
}

/** A one-line description of a theme refresh, for the settings page. */
export function describeQuiTheme(result: QuiThemeResult): string {
  switch (result.status) {
    case "applied": {
      const { theme, name } = result;
      const details = [theme.variation, theme.lightOnly ? "light" : theme.mode === "auto" ? "follows system" : theme.mode];
      return `Using qui's ${name} theme (${details.filter(Boolean).join(", ")}).`;
    }
    case "none-selected":
      return "qui hasn't saved a theme yet, so the default colours are used. Pick a theme in qui to sync it.";
    case "unavailable":
      return `qui's theme "${result.themeId}" is a premium theme this qui isn't licensed for, so the default colours are used.`;
  }
}

function isDark(theme: CachedTheme): boolean {
  if (theme.lightOnly || theme.mode === "light") return false;
  return theme.mode === "dark" || darkSchemeQuery.matches;
}

/** Applies a theme's CSS variables to this document, or removes them when `theme` is null. */
export function applyQuiTheme(theme: CachedTheme | null): void {
  const root = document.documentElement;
  let style = document.getElementById("qui-theme");

  if (!theme) {
    style?.remove();
    root.classList.remove("qui-themed", "dark");
    root.style.removeProperty("--variation-color");
    return;
  }

  if (!style) {
    style = document.createElement("style");
    style.id = "qui-theme";
    document.head.append(style);
  }
  style.textContent = theme.css;
  root.classList.add("qui-themed");
  root.classList.toggle("dark", isDark(theme));
  // Themes default --variation-color to their first variation; an inline value outranks that
  // in both the :root and .dark blocks.
  if (theme.variation) {
    root.style.setProperty("--variation-color", `var(--variation-${theme.variation})`);
  } else {
    root.style.removeProperty("--variation-color");
  }
}

/** A resolved colour variable of the applied theme, or null when no theme is applied. */
export function themeColor(name: string): string | null {
  if (!document.documentElement.classList.contains("qui-themed")) return null;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || null;
}

/** The themed badge icon for this document's applied theme, or null when there is none. */
export function themedBadgeSvg(): string | null {
  const primary = themeColor("--primary");
  const foreground = themeColor("--primary-foreground");
  return primary && foreground ? badgeSvg(primary, foreground) : null;
}

/** Keeps an extension page styled like qui: applies the cached theme, then refreshes it. */
export async function themeExtensionPage(client: QuiClient | null): Promise<void> {
  const favicon = document.querySelector<HTMLLinkElement>("link[rel=icon]");
  const logos = document.querySelectorAll<HTMLImageElement>("img.logo");
  const defaultFavicon = favicon?.href;
  const defaultLogo = logos[0]?.src;

  let theme = (await loadSettings()).theme;
  const sync = () => {
    applyQuiTheme(theme);
    const badge = themedBadgeSvg();
    const primary = themeColor("--primary");
    if (favicon && defaultFavicon) favicon.href = badge ? svgDataUrl(badge) : defaultFavicon;
    for (const img of logos) img.src = primary ? svgDataUrl(logoSvg(primary)) : (defaultLogo ?? "");
  };

  sync();
  darkSchemeQuery.addEventListener("change", sync);
  browser.storage.onChanged.addListener(async (changes, area) => {
    if (area !== "local" || !("theme" in changes)) return;
    theme = (await loadSettings()).theme;
    sync();
  });
  if (client) await refreshQuiTheme(client).catch(() => {});
}

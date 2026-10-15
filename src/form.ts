import type { QuiClient } from "./qui.ts";

export function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el as T;
}

export function setStatus(el: HTMLElement, text: string, kind: "" | "ok" | "error" = "") {
  el.textContent = text;
  el.className = `status ${kind}`;
}

export function fillSelect(select: HTMLSelectElement, entries: [string, string][], selected: string) {
  select.replaceChildren(
    ...entries.map(([value, label]) => new Option(label, value, false, value === selected)),
  );
}

/** Trims a comma-separated tag list and drops empty entries. */
export function normalizeTags(value: string): string {
  return value
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .join(",");
}

/**
 * Fills a category select and a tag suggestion list from one instance. `category` stays
 * selectable even if it no longer exists in qBittorrent.
 */
export async function loadCategoriesAndTags(
  client: QuiClient,
  instanceId: number,
  category: string,
  categorySelect: HTMLSelectElement,
  tagList: HTMLDataListElement,
) {
  const [categories, tags] = await Promise.all([
    client.listCategories(instanceId),
    client.listTags(instanceId),
  ]);
  const names = categories.sort((a, b) => a.localeCompare(b));
  if (category && !names.includes(category)) names.unshift(category);
  fillSelect(categorySelect, [["", "None"], ...names.map((n): [string, string] => [n, n])], category);
  tagList.replaceChildren(...tags.map((t) => new Option(t)));
}

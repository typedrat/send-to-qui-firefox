import * as v from "valibot";
import { $, fillSelect, loadCategoriesAndTags, normalizeTags, setStatus } from "./form.ts";
import { QuiClient } from "./qui.ts";
import { type Message, PendingSchema, PickerReplySchema, StartStateSchema } from "./schemas.ts";
import { isConfigured, loadSettings } from "./settings.ts";
import { themeExtensionPage } from "./theme.ts";

// Opened in its own window for downloads and context-menu links, or in place of the magnet
// handler page when a magnet link is clicked (`tab=1`); it leaves the same way it came.

const params = new URLSearchParams(location.search);
const id = params.get("id") ?? "";
const inTab = params.get("tab") === "1";

const form = {
  instanceRow: $("instance-row"),
  instanceId: $<HTMLSelectElement>("instanceId"),
  category: $<HTMLSelectElement>("category"),
  tags: $<HTMLInputElement>("tags"),
  tagOptions: $<HTMLDataListElement>("tag-options"),
  startState: $<HTMLSelectElement>("startState"),
  send: $<HTMLButtonElement>("send"),
};
const status = $("status");

async function leave() {
  if (inTab) {
    history.back();
  } else {
    window.close();
  }
}

async function cancel() {
  await browser.runtime.sendMessage({ type: "picker-cancel", id } satisfies Message);
  await leave();
}

themeExtensionPage(null);
const settings = await loadSettings();
const key = `pending:${id}`;
const pending = v.safeParse(PendingSchema, (await browser.storage.session.get(key))[key]);

if (!pending.success || !isConfigured(settings)) {
  setStatus(status, "This torrent has already been handled.", "error");
  form.send.disabled = true;
} else {
  const source = pending.output.source;
  $("torrent-name").textContent = source.kind === "file" ? source.filename : source.name;
  document.title = `Send ${$("torrent-name").textContent} to qui`;

  const client = new QuiClient(settings.baseUrl, settings.apiKey);
  const instanceId = pending.output.instanceId ?? settings.instanceId;
  fillSelect(form.instanceId, settings.instances.map((i) => [String(i.id), i.name]), String(instanceId));
  form.instanceRow.hidden = settings.instances.length < 2;
  form.tags.value = settings.tags;
  form.startState.value = settings.startState;

  // The defaults' category belongs to the default instance; elsewhere start from none.
  const loadInstance = async (selected: number) => {
    const category = selected === settings.instanceId ? settings.category : "";
    try {
      await loadCategoriesAndTags(client, selected, category, form.category, form.tagOptions);
    } catch (err) {
      const cached = settings.categories[String(selected)] ?? [];
      fillSelect(form.category, [["", "None"], ...cached.map((n): [string, string] => [n, n])], category);
      setStatus(status, `Couldn't load categories: ${(err as Error).message}`, "error");
    }
  };
  await loadInstance(instanceId);
  form.instanceId.addEventListener("change", () => loadInstance(Number(form.instanceId.value)));
  form.category.focus();

  $("picker").addEventListener("submit", async (event) => {
    event.preventDefault();
    form.send.disabled = true;
    setStatus(status, "Sending…");
    const reply = v.parse(
      PickerReplySchema,
      await browser.runtime.sendMessage({
        type: "picker-send",
        id,
        choices: {
          instanceId: Number(form.instanceId.value),
          category: form.category.value,
          tags: normalizeTags(form.tags.value),
          startState: v.parse(StartStateSchema, form.startState.value),
        },
      } satisfies Message),
    );
    if (reply.ok) {
      await leave();
    } else {
      // The torrent stays pending, so the user can fix the choice or qui and try again.
      setStatus(status, reply.error, "error");
      form.send.disabled = false;
    }
  });
}

$("cancel").addEventListener("click", cancel);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") cancel();
});

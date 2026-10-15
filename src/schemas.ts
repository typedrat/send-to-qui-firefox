import * as v from "valibot";

// Shapes of the qui API responses this extension reads. Objects are non-strict: qui adds
// fields over time, and only the ones listed here are relied on.

export const ErrorBodySchema = v.object({ error: v.string() });

export const InstanceSchema = v.object({ id: v.number(), name: v.string() });
export type Instance = v.InferOutput<typeof InstanceSchema>;

export const InstancesSchema = v.array(InstanceSchema);

/** qBittorrent's category map, keyed by category name; qui sends null when there are none. */
export const CategoriesSchema = v.pipe(
  v.nullable(v.record(v.string(), v.unknown())),
  v.transform((categories) => Object.keys(categories ?? {})),
);

export const TagsSchema = v.pipe(
  v.nullable(v.array(v.string())),
  v.transform((tags) => tags ?? []),
);

export const AddTorrentsResponseSchema = v.object({
  message: v.string(),
  added: v.number(),
  failed: v.number(),
});

export const ThemeModeSchema = v.picklist(["auto", "light", "dark"]);

const ThemeSlotSchema = v.object({
  themeId: v.string(),
  // Older qui versions stored an empty mode, which qui itself treats as "auto".
  mode: v.fallback(ThemeModeSchema, "auto"),
  variation: v.optional(v.string(), ""),
});

/**
 * The stored theme selection, normalized to qui's per-layout slots. qui before 1.31 stored a
 * single selection and answered with it directly, or with null when none was saved.
 */
export const ThemeSettingsSchema = v.pipe(
  v.union([
    v.null(),
    // Tried before the slot form, which would otherwise accept a flat selection as empty.
    ThemeSlotSchema,
    v.object({ default: v.optional(ThemeSlotSchema), mobile: v.optional(ThemeSlotSchema) }),
  ]),
  v.transform((settings) => {
    if (settings === null) return {};
    return "themeId" in settings ? { default: settings } : settings;
  }),
);

/** Built-in themes; `css` is absent for premium themes the install isn't licensed for. */
export const BuiltinThemesSchema = v.object({
  themes: v.array(v.object({ id: v.string(), name: v.string(), css: v.optional(v.string()) })),
});

export const CustomThemesSchema = v.object({
  themes: v.pipe(
    v.nullable(v.array(v.object({ id: v.string(), css: v.string() }))),
    v.transform((themes) => themes ?? []),
  ),
});

/** A qui theme as cached by the extension. */
export const CachedThemeSchema = v.object({
  id: v.string(),
  css: v.string(),
  mode: ThemeModeSchema,
  variation: v.string(),
  lightOnly: v.boolean(),
});
export type CachedTheme = v.InferOutput<typeof CachedThemeSchema>;

export const StartStateSchema = v.picklist(["", "started", "paused"]);
export type StartState = v.InferOutput<typeof StartStateSchema>;

/** How .torrent downloads are handled; see the options page for what each one means. */
export const DownloadHandlingSchema = v.picklist(["off", "refetch", "file"]);
export type DownloadHandling = v.InferOutput<typeof DownloadHandlingSchema>;

/**
 * Settings as stored in browser.storage.local. Each field falls back to its default on its
 * own, so one bad value (e.g. from an older version) doesn't reset the whole configuration.
 */
export const SettingsSchema = v.object({
  baseUrl: v.fallback(v.string(), ""),
  apiKey: v.fallback(v.string(), ""),
  instanceId: v.fallback(v.nullable(v.number()), null),
  // Cached so menus can be built without a network round trip.
  instances: v.fallback(InstancesSchema, []),
  category: v.fallback(v.string(), ""),
  tags: v.fallback(v.string(), ""),
  // "" leaves the decision to qBittorrent's own "start paused" preference.
  startState: v.fallback(StartStateSchema, ""),
  downloadHandling: v.fallback(DownloadHandlingSchema, "refetch"),
  // Open the picker for downloads and magnet links instead of sending with the defaults.
  askBeforeSending: v.fallback(v.boolean(), false),
  // Category names per instance id, cached for the context menu.
  categories: v.fallback(v.record(v.string(), v.array(v.string())), {}),
  // Last theme fetched from qui, so pages and the toolbar icon can paint before qui answers.
  theme: v.fallback(v.nullable(CachedThemeSchema), null),
});
export type Settings = v.InferOutput<typeof SettingsSchema>;

/** A managed value that is invalid is ignored rather than rejecting the whole file. */
function managed<S extends v.GenericSchema>(schema: S) {
  return v.optional(v.fallback(v.optional(schema), undefined));
}

/**
 * Settings provided by the system through managed storage (a managed-storage manifest or the
 * 3rdparty enterprise policy). They override the user's own settings.
 */
export const ManagedSettingsSchema = v.pipe(
  v.object({
    baseUrl: managed(v.string()),
    apiKey: managed(v.string()),
    instanceId: managed(v.number()),
    category: managed(v.string()),
    tags: managed(v.string()),
    startState: managed(StartStateSchema),
    downloadHandling: managed(DownloadHandlingSchema),
    askBeforeSending: managed(v.boolean()),
  }),
  v.transform(
    (managed) =>
      Object.fromEntries(Object.entries(managed).filter(([, value]) => value !== undefined)) as Partial<Settings>,
  ),
);

/** Per-torrent overrides of the default instance, category, tags and start state. */
export const SendChoicesSchema = v.object({
  instanceId: v.number(),
  category: v.string(),
  tags: v.string(),
  startState: StartStateSchema,
});
export type SendChoices = v.InferOutput<typeof SendChoicesSchema>;

/**
 * A torrent waiting in the picker, kept in session storage so that it survives the
 * background page being unloaded while the picker is open.
 */
export const PendingSchema = v.object({
  source: v.variant("kind", [
    v.object({ kind: v.literal("file"), filename: v.string(), base64: v.string() }),
    v.object({ kind: v.literal("url"), url: v.string(), name: v.string() }),
  ]),
  windowId: v.optional(v.number()),
  /** The instance to preselect, when the user picked one before opening the picker. */
  instanceId: v.optional(v.number()),
  /** The download the torrent came from, removed once qui has it. */
  downloadId: v.optional(v.number()),
  /**
   * What dismissing the picker does, so that a cancelled download ends up as if the extension
   * weren't installed: kept, saved from the bytes already fetched, or downloaded again.
   */
  onCancel: v.variant("action", [
    v.object({ action: v.literal("nothing") }),
    v.object({ action: v.literal("save-file") }),
    v.object({
      action: v.literal("redownload"),
      url: v.string(),
      incognito: v.boolean(),
      cookieStoreId: v.optional(v.string()),
    }),
  ]),
});
export type Pending = v.InferOutput<typeof PendingSchema>;

/** Messages extension pages send to the background script. */
export const MessageSchema = v.variant("type", [
  /** From the magnet handler; answered with a MagnetReply. */
  v.object({ type: v.literal("send-link"), url: v.string() }),
  /** From the picker; answered with a PickerReply. */
  v.object({ type: v.literal("picker-send"), id: v.string(), choices: SendChoicesSchema }),
  /** From the picker; not answered. */
  v.object({ type: v.literal("picker-cancel"), id: v.string() }),
  /** From the settings page after connecting; not answered. */
  v.object({ type: v.literal("refresh-categories") }),
]);
export type Message = v.InferOutput<typeof MessageSchema>;

export const MagnetReplySchema = v.variant("result", [
  v.object({ result: v.picklist(["sent", "failed"]) }),
  v.object({ result: v.literal("ask"), pickerId: v.string() }),
]);
export type MagnetReply = v.InferOutput<typeof MagnetReplySchema>;

export const PickerReplySchema = v.variant("ok", [
  v.object({ ok: v.literal(true) }),
  v.object({ ok: v.literal(false), error: v.string() }),
]);
export type PickerReply = v.InferOutput<typeof PickerReplySchema>;

// Messages exchanged with the native helper (src/host), which reads downloaded files.
export const HOST_NAME = "send_to_qui";

export const HostRequestSchema = v.variant("type", [
  v.object({ type: v.literal("ping") }),
  v.object({
    type: v.literal("read"),
    path: v.string(),
    offset: v.pipe(v.number(), v.integer(), v.minValue(0)),
  }),
]);
export type HostRequest = v.InferOutput<typeof HostRequestSchema>;

export const HostResponseSchema = v.variant("ok", [
  v.object({
    ok: v.literal(true),
    version: v.string(),
    /** For reads: a base64 chunk of the file starting at the requested offset. */
    data: v.optional(v.string()),
    /** For reads: the file's total size in bytes. */
    size: v.optional(v.number()),
  }),
  v.object({ ok: v.literal(false), error: v.string() }),
]);
export type HostResponse = v.InferOutput<typeof HostResponseSchema>;

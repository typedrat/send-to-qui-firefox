import * as v from "valibot";
import {
  AddTorrentsResponseSchema,
  BuiltinThemesSchema,
  CategoriesSchema,
  CustomThemesSchema,
  ErrorBodySchema,
  InstancesSchema,
  type StartState,
  TagsSchema,
  ThemeSettingsSchema,
} from "./schemas.ts";

export class QuiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "QuiError";
  }
}

export interface TorrentFile {
  blob: Blob;
  filename: string;
}

export interface AddOptions {
  files?: TorrentFile[];
  /** Magnet or HTTP links that qBittorrent fetches itself. Ignored by qui when files are given. */
  urls?: string[];
  category?: string;
  tags?: string;
  startState?: StartState;
}

/** Client for the parts of qui's REST API this extension uses. */
export class QuiClient {
  readonly baseUrl: string;
  readonly apiKey: string;

  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl.trim().replace(/\/+$/, "");
    this.apiKey = apiKey.trim();
  }

  async request<const S extends v.GenericSchema>(
    schema: S,
    path: string,
    init: RequestInit = {},
  ): Promise<v.InferOutput<S>> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/api${path}`, {
        ...init,
        headers: { "X-API-Key": this.apiKey, ...init.headers },
        // A logged-in qui session cookie would otherwise ride along and mask a bad API key.
        credentials: "omit",
      });
    } catch (err) {
      throw new QuiError(`Could not reach qui at ${this.baseUrl} (${(err as Error).message})`, 0);
    }

    const body: unknown = await res.json().catch(() => undefined);

    if (!res.ok) {
      if (res.status === 401) throw new QuiError("qui rejected the API key", res.status);
      const error = v.safeParse(ErrorBodySchema, body);
      // A non-JSON error body usually comes from a reverse proxy; the status line is all we have.
      throw new QuiError(
        error.success ? error.output.error : `${res.status} ${res.statusText}`,
        res.status,
      );
    }

    const parsed = v.safeParse(schema, body);
    if (!parsed.success) {
      const issue = parsed.issues[0];
      const where = issue.path ? ` at ${v.getDotPath(issue)}` : "";
      throw new QuiError(`Unexpected response from qui for ${path}${where}: ${issue.message}`, res.status);
    }
    return parsed.output;
  }

  listInstances() {
    return this.request(InstancesSchema, "/instances");
  }

  /** Resolves to the instance's category names. */
  listCategories(instanceId: number) {
    return this.request(CategoriesSchema, `/instances/${instanceId}/categories`);
  }

  listTags(instanceId: number) {
    return this.request(TagsSchema, `/instances/${instanceId}/tags`);
  }

  getThemeSettings() {
    return this.request(ThemeSettingsSchema, "/themes/settings");
  }

  /** Built-in themes. Premium ones carry CSS only when the qui install is licensed. */
  async listThemes() {
    return (await this.request(BuiltinThemesSchema, "/themes")).themes;
  }

  /** Themes sideloaded from qui's themes directory; requires a premium license. */
  async listCustomThemes() {
    return (await this.request(CustomThemesSchema, "/themes/custom")).themes;
  }

  async addTorrents(
    instanceId: number,
    { files = [], urls = [], category, tags, startState }: AddOptions,
  ) {
    const form = new FormData();
    for (const { blob, filename } of files) form.append("torrent", blob, filename);
    if (urls.length) form.append("urls", urls.join("\n"));
    if (category) form.append("category", category);
    if (tags) form.append("tags", tags);
    if (startState) form.append("paused", String(startState === "paused"));

    const result = await this.request(
      AddTorrentsResponseSchema,
      `/instances/${instanceId}/torrents`,
      { method: "POST", body: form },
    );
    if (result.added === 0) throw new QuiError(result.message, 201);
    return result;
  }
}

# Send to qui

A Firefox extension that sends `.torrent` files and magnet links to
[qui](https://github.com/autobrr/qui).

- **Right-click any link → Send to qui.** Pick a category straight from the menu
  (your default is marked), or **Choose category, tags…** to open the picker. With
  more than one qBittorrent instance, each gets its own submenu. Torrent links are
  downloaded by the browser (with your tracker cookies) and uploaded to qui as
  files; magnet links are passed through. The category lists refresh from qui each
  time the menu opens.
- **Optional picker for everything else.** With *Ask for the category, tags and
  start state* turned on, downloads and magnet links open a small window with the
  instance, category, tags and start state pre-filled from your defaults. Cancelling
  (or closing the window) leaves a download as if the extension weren't installed.
- **Torrent downloads go to qui.** Pick how in the settings:
  - *Send the downloaded file* lets Firefox download the file normally, then reads
    it through a small native helper, uploads it, and deletes it. The tracker sees
    exactly one ordinary download. Needs the helper (see below).
  - *Fetch the link again* cancels the download and requests the link a second time
    from the extension. No helper needed, but the tracker sees two requests.
  - *Leave them alone.*

  Either way, if qui can't take the torrent, the file is kept in your downloads.
- **Magnet links open in qui.** The extension registers as a `magnet:` handler;
  pick "Send to qui" the first time Firefox asks which application to use.
- **Matches your qui theme.** The settings pages and toolbar icon use the theme,
  variation and light/dark mode selected in qui, including premium and custom
  themes when your qui is licensed for them. Changes made in qui show up the next
  time the extension talks to it.

Context-menu links from private windows or non-default containers are passed to
qBittorrent as URLs instead of being fetched by the extension, which can't use
those cookies; links that need a tracker login only work there if the URL carries
a passkey.

## Setup

1. In qui, create an API key under **Settings → API Keys**.
2. Install the extension (see below). Its settings page opens automatically.
3. Enter qui's URL (including any base path) and the API key, then click **Connect**.
4. Choose the default instance, category, tags, start behaviour and download
   handling, then click **Save**.

## Building

```sh
bun install
bun run build      # extension → dist/
bun run package    # zip for installing or signing → web-ext-artifacts/
```

For a quick try, open `about:debugging#/runtime/this-firefox`, click **Load
Temporary Add-on…** and pick `dist/manifest.json`. Temporary add-ons are removed
when Firefox restarts. To install permanently on release Firefox it must be
signed; self-distributed ("unlisted") signing is automatic:

```sh
bunx web-ext sign --source-dir dist --channel unlisted \
  --api-key "$AMO_JWT_ISSUER" --api-secret "$AMO_JWT_SECRET"
```

(API credentials come from <https://addons.mozilla.org/developers/addon/api/key/>.)

## The download helper

"Send the downloaded file" needs a native messaging helper, because extensions
can't read files from disk. It only answers this extension, only reads `.torrent`
files, and never writes or deletes anything (the extension removes the download
through Firefox).

```sh
bun run install-host
```

This compiles the helper, copies it to `~/.local/share/send-to-qui/`, and
registers it in `~/.mozilla/native-messaging-hosts/`. Then, in the extension's
settings, choose *Send the downloaded file* and click **Allow talking to the
helper**.

If `~/.mozilla` is managed declaratively (e.g. by home-manager), build the helper
with `bun run build:host`, put `dist-host/send-to-qui-host` somewhere stable, and
generate the registration to add yourself:

```sh
bun run scripts/install-host.ts --print /path/to/send-to-qui-host
```

## Nix and home-manager

The flake provides:

- `packages.<system>.send-to-qui`: the extension, laid out for home-manager's
  `programs.firefox.profiles.<name>.extensions.packages` (and forks built on the same
  module, like `programs.zen-browser`).
- `packages.<system>.send-to-qui-host`: the download helper, for `nativeMessagingHosts`.
- `homeModules.default`: provides settings, including the API key from sops-nix,
  through Firefox managed storage. Managed settings override the extension's own
  and are locked on its settings page.

```nix
# flake inputs
send-to-qui = {
  url = "github:typedrat/send-to-qui-firefox";
  inputs.nixpkgs.follows = "nixpkgs";
};
```

```nix
{ config, inputs, ... }: {
  imports = [ inputs.send-to-qui.homeModules.default ];

  sops.secrets."qui/api-key" = { };

  programs.send-to-qui = {
    enable = true;
    apiKey.sopsSecret = "qui/api-key";
    settings = {
      baseUrl = "https://qui.example.com";
      instanceId = 1;          # the number in qui's /instances/<id> URLs
      category = "tv";
      tags = [ "linux" ];
      startState = "paused";   # "", "started" or "paused"
      downloadHandling = "file";
      askBeforeSending = true;
    };
  };

  programs.zen-browser = {   # or programs.firefox
    nativeMessagingHosts = [ config.programs.send-to-qui.hostPackage ];
    profiles.default = {
      extensions.packages = [ config.programs.send-to-qui.package ];
      # The extension is unsigned; see below.
      settings."xpinstall.signatures.required" = false;
    };
  };
}
```

Every setting is optional; anything left unset stays editable in the extension.
With `apiKey.sopsSecret`, sops-nix renders the managed-storage file
(`~/.mozilla/managed-storage/send-to-qui@typedr.at.json`) at activation, so the key
never enters the Nix store. Without it, the settings are written as an ordinary
home-manager file. Restart the browser after changing them to be sure the
extension sees the new values.

**Signing:** the package is built from source and unsigned. Zen and Firefox
Developer Edition, Nightly and ESR load it once `xpinstall.signatures.required` is
`false`; release Firefox refuses unsigned extensions regardless, so it needs a
signed build (see *Building*).

When `bun.lock` changes, update the `outputHash` in `nix/node-modules.nix`.

## Development

```sh
bun run watch       # rebuild dist/ on change
bun run start       # build, then launch Firefox with the extension loaded
bun run typecheck
bun test            # unit tests, plus the helper over its real stdio protocol
bun run lint        # web-ext lint on dist/
```

`bun test` also runs a live suite against a real qui when `QUI_URL` and
`QUI_API_KEY` are set; it adds two paused test torrents to the first instance
(or `QUI_INSTANCE_ID`).

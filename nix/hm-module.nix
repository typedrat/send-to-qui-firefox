self: {
  config,
  lib,
  pkgs,
  ...
}: let
  inherit (lib) mkEnableOption mkIf mkMerge mkOption types;

  cfg = config.programs.send-to-qui;
  packages = self.packages.${pkgs.stdenv.hostPlatform.system};
  addonId = packages.send-to-qui.addonId;

  # Firefox (and forks like Zen, which keep Mozilla's user directory) read managed storage
  # for an extension from <dir>/<addon id>.json.
  managedStorageDir =
    if pkgs.stdenv.hostPlatform.isDarwin
    then "Library/Application Support/Mozilla/ManagedStorage"
    else ".mozilla/managed-storage";
  managedStoragePath = "${managedStorageDir}/${addonId}.json";

  settings = lib.filterAttrs (_: value: value != null) (
    cfg.settings // {tags = if lib.isList cfg.settings.tags then lib.concatStringsSep "," cfg.settings.tags else cfg.settings.tags;}
  );

  manifest = data: {
    name = addonId;
    description = "Send to qui settings provided by home-manager";
    type = "storage";
    inherit data;
  };

  nullOr = type: description:
    mkOption {
      type = types.nullOr type;
      default = null;
      inherit description;
    };
in {
  options.programs.send-to-qui = {
    enable = mkEnableOption ''
      settings for the Send to qui extension, provided through Firefox managed storage. Settings
      set here override the extension's own and can't be changed from its settings page. This
      doesn't install the extension; add `package` to your browser profile's
      `extensions.packages` and `hostPackage` to its `nativeMessagingHosts`
    '';

    package = mkOption {
      type = types.package;
      default = packages.send-to-qui;
      defaultText = lib.literalExpression "send-to-qui.packages.\${system}.send-to-qui";
      description = "The extension, for a browser profile's `extensions.packages`.";
    };

    hostPackage = mkOption {
      type = types.package;
      default = packages.send-to-qui-host;
      defaultText = lib.literalExpression "send-to-qui.packages.\${system}.send-to-qui-host";
      description = ''
        The native helper used by the "send the downloaded file" download mode, for a
        browser's `nativeMessagingHosts`.
      '';
    };

    settings = {
      baseUrl = nullOr types.str "qui's URL, including any base path.";
      instanceId = nullOr types.ints.positive ''
        Default qBittorrent instance, by its qui id (the number in qui's `/instances/<id>` URLs).
      '';
      category = nullOr types.str "Default category. An empty string means none.";
      tags = nullOr (types.either types.str (types.listOf types.str)) "Default tags.";
      startState = nullOr (types.enum ["" "started" "paused"]) ''
        Whether new torrents start, are added paused, or follow qBittorrent's setting ("").
      '';
      downloadHandling = nullOr (types.enum ["off" "refetch" "file"]) ''
        What happens to .torrent downloads: left alone, re-fetched by the extension, or read
        from disk through `hostPackage`.
      '';
      askBeforeSending = nullOr types.bool ''
        Whether downloads and magnet links open a picker for the category, tags and start
        state instead of sending with the defaults.
      '';
    };

    apiKey.sopsSecret = mkOption {
      type = types.nullOr types.str;
      default = null;
      example = "qui/api-key";
      description = ''
        Name of a sops-nix secret (`sops.secrets.<name>`) holding the qui API key. The settings
        file is then rendered by sops-nix at activation, so the key never enters the Nix
        store. The secret must be declared separately.
      '';
    };
  };

  config = mkIf cfg.enable (mkMerge [
    (mkIf (cfg.apiKey.sopsSecret == null) {
      home.file.${managedStoragePath}.text = builtins.toJSON (manifest settings);
    })

    (mkIf (cfg.apiKey.sopsSecret != null) {
      sops.templates."send-to-qui-managed-storage.json" = {
        path = "${config.home.homeDirectory}/${managedStoragePath}";
        content = builtins.toJSON (manifest (settings // {apiKey = config.sops.placeholder.${cfg.apiKey.sopsSecret};}));
      };
    })
  ]);
}

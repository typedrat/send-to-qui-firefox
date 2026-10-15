{
  lib,
  stdenvNoCC,
  bun,
  zip,
  src,
  nodeModules,
}: let
  manifest = lib.importJSON ../static/manifest.json;
  addonId = manifest.browser_specific_settings.gecko.id;
in
  stdenvNoCC.mkDerivation {
    pname = "send-to-qui";
    inherit (lib.importJSON ../package.json) version;
    inherit src;

    nativeBuildInputs = [bun zip];

    dontConfigure = true;

    buildPhase = ''
      runHook preBuild

      export HOME=$(mktemp -d)
      ln -s ${nodeModules}/lib/node_modules node_modules
      bun run build.ts

      runHook postBuild
    '';

    # Sorted entries and fixed timestamps keep the .xpi reproducible.
    installPhase = ''
      runHook preInstall

      dir=$out/share/mozilla/extensions/{ec8030f7-c20a-464f-9b0e-13a3a9e97384}
      mkdir -p "$dir"
      (
        cd dist
        find . -exec touch -h -d "@$SOURCE_DATE_EPOCH" {} +
        find . -type f | sort | zip -X -q -@ "$dir/${addonId}.xpi"
      )

      runHook postInstall
    '';

    passthru = {inherit addonId;};

    meta = {
      description = "Firefox extension that sends .torrent files and magnet links to qui";
      homepage = "https://github.com/typedrat/send-to-qui-firefox";
      license = lib.licenses.gpl2Plus;
      mozPermissions =
        (manifest.permissions or [])
        ++ (manifest.optional_permissions or [])
        ++ (manifest.host_permissions or []);
      platforms = lib.platforms.all;
    };
  }

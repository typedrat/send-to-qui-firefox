{
  lib,
  stdenvNoCC,
  bun,
  makeBinaryWrapper,
  src,
  nodeModules,
}:
# The native messaging helper that lets the extension read downloaded .torrent files. Firefox
# finds it through lib/mozilla/native-messaging-hosts, the layout home-manager's
# nativeMessagingHosts options expect.
stdenvNoCC.mkDerivation {
  pname = "send-to-qui-host";
  inherit (lib.importJSON ../package.json) version;
  inherit src;

  nativeBuildInputs = [bun makeBinaryWrapper];

  dontConfigure = true;

  buildPhase = ''
    runHook preBuild

    export HOME=$(mktemp -d)
    ln -s ${nodeModules}/lib/node_modules node_modules
    bun build --target=bun src/host/main.ts --outfile host.js

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    install -Dm644 host.js $out/libexec/send-to-qui/host.js
    makeBinaryWrapper ${lib.getExe bun} $out/bin/send-to-qui-host \
      --add-flags "$out/libexec/send-to-qui/host.js"

    mkdir -p $out/lib/mozilla/native-messaging-hosts
    bun run scripts/install-host.ts --print $out/bin/send-to-qui-host \
      > $out/lib/mozilla/native-messaging-hosts/send_to_qui.json

    runHook postInstall
  '';

  meta = {
    description = "Native messaging helper for the Send to qui extension";
    license = lib.licenses.gpl2Plus;
    mainProgram = "send-to-qui-host";
    platforms = lib.platforms.unix;
  };
}

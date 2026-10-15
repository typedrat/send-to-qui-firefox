{
  stdenvNoCC,
  bun,
  src,
  version,
}:
# Fixed-output derivation containing the bun-resolved runtime dependencies. Only production
# dependencies are installed: the bundler inlines them, and nothing else is needed to build.
# The hash has to be updated whenever bun.lock changes.
stdenvNoCC.mkDerivation {
  pname = "send-to-qui-node_modules";
  inherit src version;

  nativeBuildInputs = [bun];

  dontConfigure = true;

  buildPhase = ''
    runHook preBuild

    export HOME=$(mktemp -d)
    bun install --frozen-lockfile --production --no-progress --ignore-scripts

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    mkdir -p $out/lib
    rm -rf ./node_modules/.cache
    cp -R ./node_modules $out/lib/node_modules

    runHook postInstall
  '';

  dontFixup = true;

  outputHash = "sha256-9e+/tRg6ztO3ck/khkPy9tsF8AYsJsOtn2ydDNcrUjY=";
  outputHashAlgo = "sha256";
  outputHashMode = "recursive";
}

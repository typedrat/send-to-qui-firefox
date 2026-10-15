{
  description = "Firefox extension that sends .torrent files and magnet links to qui";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = {
    self,
    nixpkgs,
  }: let
    inherit (nixpkgs) lib;
    systems = ["x86_64-linux" "aarch64-linux" "aarch64-darwin"];
    forAllSystems = f: lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});

    fs = lib.fileset;
    src = fs.toSource {
      root = ./.;
      fileset = fs.unions [
        ./build.ts
        ./bunfig.toml
        ./bun.lock
        ./package.json
        ./scripts
        ./src
        ./static
        ./test
        ./tsconfig.json
      ];
    };
    # Only the lockfile decides the dependency hash, so code changes don't invalidate it.
    depsSrc = fs.toSource {
      root = ./.;
      fileset = fs.unions [./bun.lock ./package.json];
    };

    packagesFor = pkgs: rec {
      node-modules = pkgs.callPackage ./nix/node-modules.nix {
        src = depsSrc;
        inherit (lib.importJSON ./package.json) version;
      };
      send-to-qui = pkgs.callPackage ./nix/package.nix {
        inherit src;
        nodeModules = node-modules;
      };
      send-to-qui-host = pkgs.callPackage ./nix/host.nix {
        inherit src;
        nodeModules = node-modules;
      };
      default = send-to-qui;
    };
  in {
    packages = forAllSystems (pkgs: removeAttrs (packagesFor pkgs) ["node-modules"]);

    overlays.default = final: _: {inherit (packagesFor final) send-to-qui send-to-qui-host;};

    homeModules.default = import ./nix/hm-module.nix self;
    homeManagerModules.default = self.homeModules.default;

    checks = forAllSystems (pkgs: let
      packages = packagesFor pkgs;
    in {
      inherit (packages) send-to-qui send-to-qui-host;
      tests = pkgs.runCommand "send-to-qui-tests" {nativeBuildInputs = [pkgs.bun];} ''
        cp -r ${src}/. . && chmod -R u+w .
        ln -s ${packages.node-modules}/lib/node_modules node_modules
        export HOME=$(mktemp -d)
        bun test
        touch $out
      '';
    });

    devShells = forAllSystems (pkgs: {
      default = pkgs.mkShell {packages = [pkgs.bun];};
    });

    formatter = forAllSystems (pkgs: pkgs.alejandra);
  };
}

{
  description = "Firefox extension that sends .torrent files and magnet links to qui";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-parts = {
      url = "github:hercules-ci/flake-parts";
      inputs.nixpkgs-lib.follows = "nixpkgs";
    };
  };

  outputs = inputs @ {flake-parts, ...}:
    flake-parts.lib.mkFlake {inherit inputs;} ({
      self,
      lib,
      ...
    }: let
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
      };
    in {
      systems = ["x86_64-linux" "aarch64-linux" "aarch64-darwin"];

      imports = [flake-parts.flakeModules.partitions];

      # CI tooling lives in its own partition, so its inputs stay out of consumers' lock files.
      partitionedAttrs = {
        apps = "dev";
        devShells = "dev";
      };
      partitions.dev = {
        extraInputsFlake = ./dev;
        module.imports = [./dev/flake-module.nix];
      };

      perSystem = {pkgs, ...}: let
        packages = packagesFor pkgs;
      in {
        packages = {
          inherit (packages) send-to-qui send-to-qui-host;
          default = packages.send-to-qui;
        };

        checks = {
          inherit (packages) send-to-qui send-to-qui-host;
          tests = pkgs.runCommand "send-to-qui-tests" {nativeBuildInputs = [pkgs.bun];} ''
            cp -r ${src}/. . && chmod -R u+w .
            ln -s ${packages.node-modules}/lib/node_modules node_modules
            export HOME=$(mktemp -d)
            bun test
            touch $out
          '';
        };

        formatter = pkgs.alejandra;
      };

      flake = {
        overlays.default = final: _: {inherit (packagesFor final) send-to-qui send-to-qui-host;};

        homeModules.default = import ./nix/hm-module.nix self;
        homeManagerModules.default = self.homeModules.default;
      };
    });
}

{inputs, ...}: {
  imports = [
    inputs.github-actions-nix.flakeModules.default
    inputs.files.flakeModules.default
  ];

  perSystem = {
    config,
    pkgs,
    lib,
    ...
  }: let
    addonId = (lib.importJSON ../static/manifest.json).browser_specific_settings.gecko.id;
    xpiPath = "result/share/mozilla/extensions/{ec8030f7-c20a-464f-9b0e-13a3a9e97384}/${addonId}.xpi";

    checkout = {
      name = "Checkout";
      uses = "actions/checkout@v5";
    };
    installNix = {
      name = "Install Nix";
      uses = "DeterminateSystems/determinate-nix-action@v3";
    };
  in {
    devShells.default = pkgs.mkShell {
      packages = with pkgs; [
        bun
        # web-ext's command-line entry point runs under Node.
        nodejs
        actionlint
        alejandra
      ];
    };

    files.files =
      lib.mapAttrsToList (name: drv: {
        path_ = ".github/workflows/${name}";
        inherit drv;
      })
      config.githubActions.workflowFiles;

    apps.write-files = {
      type = "app";
      program = lib.getExe config.files.writer.drv;
      meta.description = "Write the generated workflow files to .github/workflows";
    };

    githubActions = {
      enable = true;

      workflows = {
        ci = {
          name = "CI";

          on = {
            push.branches = ["main"];
            pullRequest = {};
            workflowDispatch = {};
          };

          concurrency = {
            group = "\${{ github.workflow }}-\${{ github.event.pull_request.number || github.ref }}";
            cancelInProgress = true;
          };

          permissions.contents = "read";

          jobs = {
            flake-check = {
              name = "Nix flake check";
              runsOn = "ubuntu-latest";
              steps = [
                checkout
                installNix
                {
                  name = "Build packages and run tests";
                  run = "nix flake check --print-build-logs";
                }
              ];
            };

            lint = {
              name = "Typecheck and lint";
              runsOn = "ubuntu-latest";
              steps = [
                checkout
                installNix
                {
                  name = "Install dependencies";
                  run = "nix develop --command bun install --frozen-lockfile";
                }
                {
                  name = "Typecheck";
                  run = "nix develop --command bun run typecheck";
                }
                {
                  name = "Lint the built extension";
                  run = "nix develop --command bash -c 'bun run build && bun run lint'";
                }
              ];
            };

            workflows = {
              name = "Generated workflows are current";
              runsOn = "ubuntu-latest";
              steps = [
                checkout
                installNix
                {
                  name = "Regenerate workflows";
                  run = "nix run .#write-files";
                }
                {
                  name = "Check for differences";
                  run = ''
                    if ! git diff --exit-code -- .github/workflows; then
                      echo "::error::.github/workflows is out of date. Run 'nix run .#write-files' and commit the result."
                      exit 1
                    fi
                  '';
                }
                {
                  name = "Lint workflows";
                  run = "nix develop --command actionlint";
                }
              ];
            };
          };
        };

        release = {
          name = "Release";

          on.push.tags = ["v[0-9]+.[0-9]+.[0-9]+*"];

          # Two runs for the same tag would both try to sign the same version.
          concurrency = {
            group = "release-\${{ github.ref }}";
            cancelInProgress = false;
          };

          permissions.contents = "write";

          jobs.release = {
            name = "Sign and publish";
            runsOn = "ubuntu-latest";
            timeoutMinutes = 60;
            steps = [
              checkout
              installNix
              {
                id = "version";
                name = "Check the tag matches package.json";
                run = ''
                  version=$(jq -r .version package.json)
                  if [ "v$version" != "$GITHUB_REF_NAME" ]; then
                    echo "::error::Tag $GITHUB_REF_NAME doesn't match package.json version $version"
                    exit 1
                  fi
                  echo "version=$version" >> "$GITHUB_OUTPUT"
                '';
              }
              {
                name = "Build";
                run = "nix build .#send-to-qui --print-build-logs";
              }
              {
                name = "Install web-ext";
                run = "nix develop --command bun install --frozen-lockfile";
              }
              {
                # Signing the Nix-built files keeps the release identical to the package, apart
                # from Mozilla's signature. AMO asks for the source of bundled code, so the
                # tagged tree goes along with it.
                name = "Sign with addons.mozilla.org";
                env = {
                  WEB_EXT_API_KEY = "\${{ secrets.AMO_JWT_ISSUER }}";
                  WEB_EXT_API_SECRET = "\${{ secrets.AMO_JWT_SECRET }}";
                };
                run = ''
                  mkdir unpacked
                  unzip -q '${xpiPath}' -d unpacked
                  git archive --format=zip --output=source.zip HEAD
                  nix develop --command node_modules/.bin/web-ext sign \
                    --source-dir unpacked \
                    --channel unlisted \
                    --upload-source-code source.zip \
                    --artifacts-dir signed \
                    --approval-timeout 1800000
                  mv signed/*.xpi "send-to-qui-''${{ steps.version.outputs.version }}.xpi"
                '';
              }
              {
                name = "Publish the GitHub release";
                env.GH_TOKEN = "\${{ github.token }}";
                run = ''
                  gh release create "$GITHUB_REF_NAME" \
                    "send-to-qui-''${{ steps.version.outputs.version }}.xpi" \
                    --title "$GITHUB_REF_NAME" \
                    --generate-notes \
                    --verify-tag
                '';
              }
            ];
          };
        };
      };
    };
  };
}

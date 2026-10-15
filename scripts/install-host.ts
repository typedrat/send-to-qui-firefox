// Installs the native helper for the current user: copies the compiled binary to a stable
// location and registers it with Firefox. `--print` only prints the registration manifest,
// for managing it declaratively (e.g. with home-manager) instead.
import { chmod, copyFile, mkdir, writeFile } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { join, resolve } from "node:path";
import { HOST_NAME } from "../src/schemas.ts";
import manifest from "../static/manifest.json" with { type: "json" };

const BINARY = resolve("dist-host/send-to-qui-host");

function hostManifest(path: string) {
  return {
    name: HOST_NAME,
    description: "Reads downloaded .torrent files for the Send to qui extension",
    path,
    type: "stdio",
    allowed_extensions: [manifest.browser_specific_settings.gecko.id],
  };
}

function locations() {
  const home = homedir();
  switch (platform()) {
    case "linux": {
      const data = process.env.XDG_DATA_HOME || join(home, ".local/share");
      return {
        binaryDir: join(data, "send-to-qui"),
        manifestDir: join(home, ".mozilla/native-messaging-hosts"),
      };
    }
    case "darwin":
      return {
        binaryDir: join(home, "Library/Application Support/send-to-qui"),
        manifestDir: join(home, "Library/Application Support/Mozilla/NativeMessagingHosts"),
      };
    default:
      throw new Error(`Installing the helper isn't supported on ${platform()} yet`);
  }
}

if (process.argv.includes("--print")) {
  const path = process.argv[process.argv.indexOf("--print") + 1] ?? BINARY;
  console.log(JSON.stringify(hostManifest(path), null, 2));
} else {
  const { binaryDir, manifestDir } = locations();
  const binary = join(binaryDir, "send-to-qui-host");
  await mkdir(binaryDir, { recursive: true });
  await copyFile(BINARY, binary);
  await chmod(binary, 0o755);

  await mkdir(manifestDir, { recursive: true });
  const manifestPath = join(manifestDir, `${HOST_NAME}.json`);
  await writeFile(manifestPath, `${JSON.stringify(hostManifest(binary), null, 2)}\n`);
  console.log(`Installed ${binary}\nRegistered ${manifestPath}`);
}

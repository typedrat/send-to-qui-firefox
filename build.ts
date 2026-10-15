import { cp, readFile, rm, writeFile } from "node:fs/promises";
import { watch } from "node:fs";

const OUT = "dist";

async function build() {
  await rm(OUT, { recursive: true, force: true });

  const result = await Bun.build({
    entrypoints: ["src/background.ts", "src/options.ts", "src/magnet.ts", "src/picker.ts"],
    outdir: OUT,
    target: "browser",
    format: "esm",
    // Kept readable so the shipped code can be reviewed (AMO asks for this) and debugged.
    minify: false,
  });
  if (!result.success) {
    for (const log of result.logs) console.error(log);
    return false;
  }

  await cp("static", OUT, { recursive: true });

  const { version } = JSON.parse(await readFile("package.json", "utf8"));
  const manifest = JSON.parse(await readFile("static/manifest.json", "utf8"));
  await writeFile(`${OUT}/manifest.json`, `${JSON.stringify({ ...manifest, version }, null, 2)}\n`);

  console.log(`Built ${OUT}/ (v${version})`);
  return true;
}

const ok = await build();

if (process.argv.includes("--watch")) {
  let pending: ReturnType<typeof setTimeout> | undefined;
  const rebuild = () => {
    clearTimeout(pending);
    pending = setTimeout(build, 100);
  };
  for (const dir of ["src", "static"]) watch(dir, { recursive: true }, rebuild);
  console.log("Watching src/ and static/…");
} else if (!ok) {
  process.exit(1);
}

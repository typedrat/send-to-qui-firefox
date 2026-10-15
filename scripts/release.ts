// Bumps the version in package.json, commits it, and tags the commit. Pushing the tag runs
// the release workflow, which signs the extension and publishes it as a GitHub release.
//
//   bun run release patch|minor|major|<x.y.z>
import { $ } from "bun";

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

/** The version after `current` for a bump kind, or `bump` itself when it is a version. */
export function nextVersion(current: string, bump: string): string {
  const parts = current.match(SEMVER);
  if (!parts) throw new Error(`package.json has a version that isn't x.y.z: ${current}`);
  const [major, minor, patch] = parts.slice(1).map(Number) as [number, number, number];

  let next: string;
  if (bump === "major") next = `${major + 1}.0.0`;
  else if (bump === "minor") next = `${major}.${minor + 1}.0`;
  else if (bump === "patch") next = `${major}.${minor}.${patch + 1}`;
  else if (SEMVER.test(bump)) next = bump;
  else throw new Error(`Expected patch, minor, major or x.y.z, not "${bump}"`);

  const order = (v: string) => v.split(".").map(Number).reduce((a, n) => a * 1e6 + n, 0);
  if (order(next) <= order(current)) throw new Error(`${next} isn't newer than ${current}`);
  return next;
}

if (import.meta.main) {
  const bump = process.argv[2];
  if (!bump) {
    console.error("Usage: bun run release patch|minor|major|<x.y.z>");
    process.exit(1);
  }

  if ((await $`git status --porcelain`.text()).trim()) {
    console.error("Commit or stash your changes first; the release commit should only bump the version.");
    process.exit(1);
  }
  const branch = (await $`git branch --show-current`.text()).trim();
  if (branch !== "main") {
    console.error(`Releases are cut from main, not ${branch}.`);
    process.exit(1);
  }

  const pkg = await Bun.file("package.json").json();
  const version = nextVersion(pkg.version, bump);
  pkg.version = version;
  await Bun.write("package.json", `${JSON.stringify(pkg, null, 2)}\n`);

  await $`git add package.json`;
  await $`git commit --quiet -m ${`chore(release): v${version}`}`;
  await $`git tag --annotate ${`v${version}`} -m ${`v${version}`}`;
  console.log(`Tagged v${version}. Publish it with:\n  git push --atomic origin main v${version}`);
}

import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { version } from "../package.json" with { type: "json" };

// Talks to the helper over stdio exactly as Firefox does: 32-bit little-endian length, then JSON.
let dir: string;
let host: ReturnType<typeof Bun.spawn<"pipe", "pipe", "inherit">>;
let replies: AsyncIterator<Uint8Array>;
let buffered = Buffer.alloc(0);

async function ask(message: unknown): Promise<any> {
  const body = Buffer.from(JSON.stringify(message));
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length);
  host.stdin.write(Buffer.concat([header, body]));
  await host.stdin.flush();

  while (buffered.length < 4 || buffered.length < 4 + buffered.readUInt32LE(0)) {
    const { value, done } = await replies.next();
    if (done) throw new Error("helper exited");
    buffered = Buffer.concat([buffered, value]);
  }
  const length = buffered.readUInt32LE(0);
  const reply = JSON.parse(buffered.subarray(4, 4 + length).toString());
  buffered = buffered.subarray(4 + length);
  return reply;
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "send-to-qui-host-"));
  host = Bun.spawn(["bun", "src/host/main.ts"], { stdin: "pipe", stdout: "pipe", stderr: "inherit" });
  replies = host.stdout[Symbol.asyncIterator]();
});

afterAll(async () => {
  host.kill();
  await rm(dir, { recursive: true, force: true });
});

test("answers pings with its version", async () => {
  expect(await ask({ type: "ping" })).toEqual({ ok: true, version });
});

test("reads a large torrent in chunks", async () => {
  const bytes = Buffer.alloc(1_300_000, 7);
  bytes[0] = 0x64;
  const path = join(dir, "Big Show.torrent");
  await writeFile(path, bytes);

  const parts: Buffer[] = [];
  let offset = 0;
  for (;;) {
    const reply = await ask({ type: "read", path, offset });
    expect(reply).toMatchObject({ ok: true, size: bytes.length });
    const chunk = Buffer.from(reply.data, "base64");
    if (chunk.length === 0) break;
    expect(chunk.length).toBeLessThanOrEqual(512 * 1024);
    parts.push(chunk);
    offset += chunk.length;
  }
  expect(parts.length).toBe(3);
  expect(Buffer.concat(parts).equals(bytes)).toBe(true);
});

test("only reads absolute paths to regular .torrent files", async () => {
  await writeFile(join(dir, "secret.txt"), "nope");
  await symlink(join(dir, "secret.txt"), join(dir, "link.torrent"));

  for (const path of [join(dir, "secret.txt"), "relative.torrent"]) {
    expect(await ask({ type: "read", path, offset: 0 })).toMatchObject({ ok: false });
  }
  expect(await ask({ type: "read", path: join(dir, "link.torrent"), offset: 0 })).toEqual({
    ok: false,
    error: "Not a regular file",
  });
  expect((await ask({ type: "read", path: join(dir, "missing.torrent"), offset: 0 })).ok).toBe(false);
});

test("rejects malformed requests without exiting", async () => {
  expect((await ask({ type: "delete", path: "/" })).ok).toBe(false);
  expect((await ask({ type: "read", path: join(dir, "x.torrent"), offset: -1 })).ok).toBe(false);
  expect(await ask({ type: "ping" })).toMatchObject({ ok: true });
});

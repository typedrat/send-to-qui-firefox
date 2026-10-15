// Native messaging helper: reads .torrent files that Firefox has downloaded, so the
// extension can send the very file the browser fetched instead of requesting it again.
// Firefox starts this program on demand and only lets the extensions named in its manifest
// talk to it; it never writes or deletes anything.
import { endianness } from "node:os";
import { lstat, open } from "node:fs/promises";
import { isAbsolute } from "node:path";
import * as v from "valibot";
import { version } from "../../package.json" with { type: "json" };
import { type HostResponse, HostRequestSchema } from "../schemas.ts";

// Base64 grows data by a third; this keeps each reply well under the 1 MB that browsers
// allow for a single message from a native application.
const CHUNK_BYTES = 512 * 1024;
const MAX_TORRENT_BYTES = 64 * 1024 * 1024;
const littleEndian = endianness() === "LE";

async function read(path: string, offset: number): Promise<HostResponse> {
  if (!isAbsolute(path) || !/\.torrent$/i.test(path)) {
    return { ok: false, error: "Only absolute paths to .torrent files can be read" };
  }
  const info = await lstat(path);
  if (!info.isFile()) return { ok: false, error: "Not a regular file" };
  if (info.size > MAX_TORRENT_BYTES) return { ok: false, error: "File is too large to be a torrent" };

  const file = await open(path, "r");
  try {
    const buffer = Buffer.alloc(Math.min(CHUNK_BYTES, Math.max(0, info.size - offset)));
    const { bytesRead } = await file.read(buffer, 0, buffer.length, offset);
    return { ok: true, version, size: info.size, data: buffer.subarray(0, bytesRead).toString("base64") };
  } finally {
    await file.close();
  }
}

async function handle(message: unknown): Promise<HostResponse> {
  const request = v.safeParse(HostRequestSchema, message);
  if (!request.success) return { ok: false, error: `Bad request: ${request.issues[0].message}` };
  if (request.output.type === "ping") return { ok: true, version };
  try {
    return await read(request.output.path, request.output.offset);
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

function send(response: HostResponse) {
  const body = Buffer.from(JSON.stringify(response));
  const header = Buffer.alloc(4);
  if (littleEndian) header.writeUInt32LE(body.length);
  else header.writeUInt32BE(body.length);
  process.stdout.write(Buffer.concat([header, body]));
}

// Each message is a 32-bit length in native byte order followed by that many bytes of JSON.
let pending = Buffer.alloc(0);
for await (const chunk of Bun.stdin.stream()) {
  pending = Buffer.concat([pending, chunk]);
  while (pending.length >= 4) {
    const length = littleEndian ? pending.readUInt32LE(0) : pending.readUInt32BE(0);
    if (pending.length < 4 + length) break;
    const body = pending.subarray(4, 4 + length).toString("utf8");
    pending = pending.subarray(4 + length);
    let message: unknown;
    try {
      message = JSON.parse(body);
    } catch {
      message = undefined;
    }
    send(await handle(message));
  }
}

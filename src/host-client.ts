import * as v from "valibot";
import { fromBase64 } from "./bytes.ts";
import { HOST_NAME, type HostRequest, HostResponseSchema } from "./schemas.ts";

export const NATIVE_MESSAGING: browser.permissions.Permissions = { permissions: ["nativeMessaging"] };

async function request(message: HostRequest) {
  const reply = v.parse(HostResponseSchema, await browser.runtime.sendNativeMessage(HOST_NAME, message));
  if (!reply.ok) throw new Error(`Helper: ${reply.error}`);
  return reply;
}

export type HelperStatus =
  | { state: "not-permitted" }
  | { state: "missing"; error: string }
  | { state: "ready"; version: string };

export async function helperStatus(): Promise<HelperStatus> {
  if (!(await browser.permissions.contains(NATIVE_MESSAGING))) return { state: "not-permitted" };
  try {
    return { state: "ready", version: (await request({ type: "ping" })).version };
  } catch (err) {
    return { state: "missing", error: (err as Error).message };
  }
}

/** Reads a downloaded file through the helper. */
export async function readDownloadedFile(path: string): Promise<Uint8Array<ArrayBuffer>> {
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;
  let size = Number.POSITIVE_INFINITY;
  while (offset < size) {
    const reply = await request({ type: "read", path, offset });
    const chunk = fromBase64(reply.data ?? "");
    size = reply.size ?? 0;
    // A file that shrinks while being read would otherwise loop forever.
    if (chunk.length === 0) break;
    chunks.push(chunk);
    offset += chunk.length;
  }
  return new Uint8Array(await new Blob(chunks).arrayBuffer());
}

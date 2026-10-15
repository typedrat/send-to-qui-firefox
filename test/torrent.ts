import { createHash } from "node:crypto";

type Bencodable = number | string | Uint8Array | Bencodable[] | { [key: string]: Bencodable };

function bencode(value: Bencodable): Buffer {
  if (typeof value === "number") return Buffer.from(`i${value}e`);
  if (typeof value === "string") return bencode(Buffer.from(value));
  if (value instanceof Uint8Array) return Buffer.concat([Buffer.from(`${value.length}:`), value]);
  if (Array.isArray(value)) return Buffer.concat([Buffer.from("l"), ...value.map(bencode), Buffer.from("e")]);
  const keys = Object.keys(value).sort();
  return Buffer.concat([
    Buffer.from("d"),
    ...keys.flatMap((k) => [bencode(k), bencode(value[k]!)]),
    Buffer.from("e"),
  ]);
}

/** A valid single-file torrent; `name` also makes the info hash unique per call site. */
export function makeTorrent(name: string): Uint8Array<ArrayBuffer> {
  const content = Buffer.from(`contents of ${name}`);
  const encoded = bencode({
    announce: "http://127.0.0.1:1/announce",
    info: {
      length: content.length,
      name,
      "piece length": 16384,
      pieces: createHash("sha1").update(content).digest(),
      private: 1,
    },
  });
  return new Uint8Array(encoded);
}

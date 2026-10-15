import { expect, test } from "bun:test";
import { fromBase64, toBase64 } from "../src/bytes.ts";

test("base64 round-trips large binary data", () => {
  const bytes = new Uint8Array(200_000).map((_, i) => (i * 7919) % 256);
  expect(toBase64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
  expect(fromBase64(toBase64(bytes))).toEqual(bytes);
});

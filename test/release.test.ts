import { expect, test } from "bun:test";
import { nextVersion } from "../scripts/release.ts";

test("bumps each part and resets the lower ones", () => {
  expect(nextVersion("1.2.3", "patch")).toBe("1.2.4");
  expect(nextVersion("1.2.3", "minor")).toBe("1.3.0");
  expect(nextVersion("1.2.3", "major")).toBe("2.0.0");
});

test("accepts an explicit newer version", () => {
  expect(nextVersion("1.2.3", "1.10.0")).toBe("1.10.0");
});

test("rejects versions that don't move forward, and unknown bumps", () => {
  expect(() => nextVersion("1.2.3", "1.2.3")).toThrow("isn't newer");
  expect(() => nextVersion("1.10.0", "1.9.9")).toThrow("isn't newer");
  expect(() => nextVersion("1.2.3", "1.2")).toThrow("Expected patch");
});

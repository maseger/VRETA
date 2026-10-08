import { describe, expect, it } from "vitest";
import { isStaleChunkError } from "./staleChunk";

describe("isStaleChunkError", () => {
  it("känner igen en sidfil från en tidigare version som inte finns längre", () => {
    expect(isStaleChunkError(new TypeError("Failed to fetch dynamically imported module: https://maseger.github.io/VRETA/v2/assets/Review-vB7axIZI.js"))).toBe(true);
    expect(isStaleChunkError(new TypeError("Importing a module script failed."))).toBe(true);
    expect(isStaleChunkError(new Error("error loading dynamically imported module"))).toBe(true);
  });
  it("låter andra fel vara", () => {
    expect(isStaleChunkError(new Error("permission denied for function q_context"))).toBe(false);
    expect(isStaleChunkError(null)).toBe(false);
  });
});

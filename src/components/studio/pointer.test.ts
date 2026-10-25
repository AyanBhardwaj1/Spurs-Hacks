import { describe, expect, test } from "bun:test";
import { canAutoPreview } from "./pointer";

describe("automatic preview gating", () => {
  test("allows mouse hover only when motion is allowed", () => {
    expect(canAutoPreview("mouse", false)).toBe(true);
    expect(canAutoPreview("mouse", true)).toBe(false);
    expect(canAutoPreview("touch", false)).toBe(false);
    expect(canAutoPreview("pen", false)).toBe(false);
  });
});

import { describe, expect, test } from "bun:test";
import { jevUtility, mapSegments, parsePegasusSegments } from "./matchwatch";

describe("MatchWatch event mapping", () => {
  test("maps the largest overlap and rejects segments outside moments", () => {
    const moments = [{ id: "m-1", start: 10, end: 20 }, { id: "m-2", start: 30, end: 40 }];
    const result = mapSegments([{ start: 12, end: 32, label: "Goal scored" }, { start: 40, end: 55, label: "Crowd celebration" }], moments);
    expect(result.matched.get("m-1")?.[0].detail).toContain("Goal scored");
    expect(result.matched.has("m-2")).toBe(false);
    expect(result.rejected).toHaveLength(1);
  });
});

test("renormalizes Jev weights when a score is unknown", () => {
  expect(jevUtility({ importance: 1, excitement: 0, watchability: 0.5 })).toBeCloseTo(0.6);
  expect(jevUtility({ importance: 1, excitement: null, watchability: 0 })).toBeCloseTo(0.7142857);
  expect(jevUtility({ importance: null, excitement: null, watchability: null })).toBe(0);
});

test("parses the documented segmentation response and rejects malformed ranges", () => {
  expect(parsePegasusSegments({ events: [{ start_time: 1, end_time: 4, metadata: { label: "Shot on target", confidence: 0.8 } }] }, 10)).toEqual([{ start: 1, end: 4, label: "Shot on target", confidence: 0.8 }]);
  expect(() => parsePegasusSegments({ events: [{ start_time: 1, end_time: 12, metadata: { label: "Goal scored" } }] }, 10)).toThrow();
});

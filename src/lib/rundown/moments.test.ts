import { describe, expect, test } from "bun:test";
import { clusterHits, fitSegment, type Hit } from "./moments";

const hit = (videoId: string, start: number, end: number, strength: number, kind: Hit["kind"] = "goal"): Hit => ({
  assetId: `asset-${videoId}`,
  videoId,
  start,
  end,
  kind,
  label: kind,
  signal: { source: "footage", label: `${kind}-${start}`, query: `${kind}-${start}`, strength },
});

describe("clusterHits", () => {
  test("two searches landing on the same seconds make one moment that outranks either", () => {
    const moments = clusterHits([hit("a", 100, 110, 0.6), hit("a", 108, 115, 0.5), hit("a", 300, 310, 0.7), hit("b", 100, 110, 0.6)]);
    expect(moments).toHaveLength(3);
    const joined = moments.find((m) => m.primary.videoId === "a" && m.primary.start === 100)!;
    expect(joined.primary.end).toBe(115);
    expect(joined.signals).toHaveLength(2);
    expect(joined.score).toBeCloseTo(1 - 0.4 * 0.5);
    expect(moments[0]).toBe(joined);
  });

  test("a chain of overlapping hits stops growing at 45 seconds", () => {
    const chain = [0, 8, 16, 24, 32, 40, 48].map((s) => hit("a", s, s + 10, 0.5));
    const moments = clusterHits(chain);
    expect(moments.length).toBeGreaterThan(1);
    for (const m of moments) expect(m.primary.end - m.primary.start).toBeLessThanOrEqual(45);
  });

  test("a fan post does not rename the moment a typed search found", () => {
    const fan: Hit = { ...hit("a", 101, 109, 0.9, "other"), label: "WHAT A GOAL", signal: { source: "fans", label: "WHAT A GOAL", strength: 0.9 } };
    const [m] = clusterHits([hit("a", 100, 110, 0.5), fan]);
    expect(m.kind).toBe("goal");
    expect(m.title).toBe("goal");
  });
});

describe("fitSegment", () => {
  test("pads around the middle without running before 0 or past the asset end", () => {
    expect(fitSegment({ assetId: "x", start: 2, end: 6 }, 12)).toMatchObject({ start: 0, end: 12 });
    expect(fitSegment({ assetId: "x", start: 95, end: 99 }, 12, 100)).toMatchObject({ start: 88, end: 100 });
    expect(fitSegment({ assetId: "x", start: 40, end: 60 }, 10, 100)).toMatchObject({ start: 45, end: 55 });
  });
});

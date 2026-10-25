import { describe, expect, test } from "bun:test";
import { agreement, detectSpikes, heldRange, parseRmsFrames, segmentFloorDb, segmentsToMeasure, SPIKE, withSpikes, toAnalysisScale, ANALYSIS_SCALE_DB } from "./live-signal";

describe("segment loudness", () => {
  test("reads ffmpeg's RMS print, with -inf as silence", () => {
    const text = "frame:0    pts:0       pts_time:0\nlavfi.astats.Overall.RMS_level=-34.858517\nframe:1    pts:1600    pts_time:0.1\nlavfi.astats.Overall.RMS_level=-inf\n";
    expect(parseRmsFrames(text)).toEqual([-34.858517, -90]);
  });

  test("the floor is the 20th percentile of the segment's frames, as in the analysis", () => {
    const frames = Array.from({ length: 20 }, (_, i) => -40 + i);
    expect(segmentFloorDb(frames)).toBe(-36);
  });

  test("dB maps onto the analysis' 0-to-1 scale and clamps outside it", () => {
    expect(toAnalysisScale(ANALYSIS_SCALE_DB.low)).toBe(0);
    expect(toAnalysisScale(ANALYSIS_SCALE_DB.high)).toBe(1);
    expect(toAnalysisScale(-80)).toBe(0);
    expect(toAnalysisScale(-10)).toBe(1);
  });
});

describe("spike detector", () => {
  const quiet = Array<number>(SPIKE.baselineSegments).fill(-30);

  test("a floor 5 dB over the last minute's median is a spike", () => {
    const r = detectSpikes([...quiet, -25]);
    expect(r.at(-1)).toEqual({ baselineDb: -30, riseDb: 5, spike: true });
  });

  test("a smaller rise is not", () => {
    expect(detectSpikes([...quiet, -25.1]).at(-1)?.spike).toBe(false);
  });

  test("one sustained roar is one spike until the refractory period ends", () => {
    // The spike, the refractory segments, then the first segment allowed to spike again.
    const roar = Array<number>(SPIKE.refractorySegments + 2).fill(-22);
    const flags = detectSpikes([...quiet, ...roar]).slice(quiet.length).map((r) => r.spike);
    expect(flags.filter(Boolean).length).toBe(2);
    expect(flags[0]).toBe(true);
    expect(flags.at(-1)).toBe(true);
  });

  test("a segment that failed to measure starts the baseline again", () => {
    const r = detectSpikes([...quiet, undefined, -30, -30, -30, -30, -20]);
    expect(r.at(-1)).toEqual({ spike: false });
  });

  test("with under five earlier segments there is no baseline and no spike", () => {
    expect(detectSpikes([-40, -40, -40, -40, -10]).at(-1)).toEqual({ spike: false });
  });
});

test("agreement counts readings within the band of the analysis", () => {
  const a = agreement([{ live: 0.5, analysis: 0.6 }, { live: 0.2, analysis: 0.6 }], 0.15);
  expect([a?.within, a?.total]).toEqual([1, 2]);
  expect(a?.meanGap).toBeCloseTo(0.25);
});

describe("what one meter request measures", () => {
  const budget = { total: 3, forward: 2, history: 45 };

  test("a first request measures the two newest segments", () => {
    expect(segmentsToMeasure(1000, {}, budget)).toEqual([1000, 999]);
  });

  test("new segments come first, and the spare budget backfills before the oldest one held", () => {
    expect(segmentsToMeasure(1001, { after: 1000, before: 990 }, budget)).toEqual([1001, 989, 988]);
  });

  test("after a long gap only the newest segments are measured, not the whole gap", () => {
    expect(segmentsToMeasure(1100, { after: 1000, before: 990 }, budget)).toEqual([1100, 1099]);
  });

  test("backfill stops at the edge of the history window", () => {
    expect(segmentsToMeasure(1000, { after: 1000, before: 957 }, budget)).toEqual([956]);
  });
});

describe("the browser's meter history", () => {
  const reading = (seq: number, floorDb = -30) => ({ seq, n: seq - 100, airsAt: seq * 2000, floorDb });

  test("asks for segments after its newest and before the start of its unbroken run", () => {
    expect(heldRange([reading(10), reading(11), reading(20), reading(21), reading(22)])).toEqual({ after: 22, before: 20 });
  });

  test("a missing segment breaks the spike baseline", () => {
    const quiet = Array.from({ length: SPIKE.baselineSegments }, (_, i) => reading(i));
    const roar = reading(SPIKE.baselineSegments, -24);
    expect(withSpikes([...quiet, roar], roar.seq).at(-1)?.spike).toBe(true);
    const gapped = [...quiet.slice(0, -6), ...quiet.slice(-5), roar];
    expect(withSpikes(gapped, roar.seq).at(-1)?.spike).toBe(true);
    const tooShort = [...quiet.slice(0, -5), ...quiet.slice(-4), roar];
    expect(withSpikes(tooShort, roar.seq).at(-1)?.spike).toBe(false);
  });
});

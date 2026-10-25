import { expect, test } from "bun:test";
import { correlate, mergeAudioWindows, type AudioWindow } from "./audio-align";

test("recovers the source offset despite gain and rejects a repeated peak as ambiguous", () => {
  let seed = 31;
  const values = Array.from({ length: 4000 }, () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32 - 0.5;
  });
  const source = { stepSec: 0.1, bands: 2, values };
  const query = { ...source, values: values.slice(642, 722).map((x) => x * 0.3) };
  const found = correlate(source, query);
  expect(found.sourceStart).toBeCloseTo(32.1);
  expect(found.score).toBeCloseTo(1);
  expect(found.ratio).toBeGreaterThan(2);
  values.splice(1600, 80, ...values.slice(642, 722));
  expect(correlate(source, query).ratio).toBeCloseTo(1);
  const silent = correlate(source, { ...query, values: query.values.map(() => 0) });
  expect(silent.score).toBe(0);
  expect(silent.sourceStart).toBeNull();
});

test("merges contiguous offsets but preserves stitched cuts and unsupported gaps", () => {
  const window = (clipStart: number, offset: number, accepted = true): AudioWindow => ({
    clipStart, clipEnd: clipStart + 4, offset, accepted, score: 0.9, secondScore: 0.3, ratio: 3,
  });
  const segments = mergeAudioWindows([
    window(0, 100), window(4, 100.1), window(8, 500), window(12, 500, false), window(16, 500),
  ]);
  expect(segments.map(({ clipStart, clipEnd, offset }) => ({ clipStart, clipEnd, offset }))).toEqual([
    { clipStart: 0, clipEnd: 8, offset: 100 },
    { clipStart: 8, clipEnd: 12, offset: 500 },
    { clipStart: 16, clipEnd: 20, offset: 500 },
  ]);
});

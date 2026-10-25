import { describe, expect, test } from "bun:test";
import { clipsOnlyAtK, loudCrowdPeaks, loudPlacements, mergeRanges, placeInHalves, rankingAtK } from "./rank-eval";

describe("mergeRanges", () => {
  test("merges overlapping ranges and keeps ranges that only touch apart", () => {
    expect(mergeRanges([{ start: 20, end: 30 }, { start: 5, end: 15 }, { start: 0, end: 10 }, { start: 30, end: 35 }])).toEqual([
      { start: 0, end: 15 },
      { start: 20, end: 30 },
      { start: 30, end: 35 },
    ]);
  });
});

describe("rankingAtK", () => {
  const events = [
    { start: 10, end: 20 },
    { start: 50, end: 60 },
  ];
  // Ranked A, B, C by score; A hits the first event, B misses, C hits the second.
  const moments = [
    { start: 55, end: 70, peak: 60, score: 0.7 },
    { start: 12, end: 18, peak: 15, score: 0.9 },
    { start: 30, end: 40, peak: 35, score: 0.8 },
  ];

  test("scores the top K by rank, counting each event once", () => {
    const rows = rankingAtK({ moments, references: events, ks: [1, 2, 3], halves: [{ start: 0, end: 100 }], crowd: { stepSec: 5, values: Array(20).fill(1) }, trials: 10, seed: 1 });
    expect(rows.map(({ k, precision, recall }) => ({ k, precision, recall }))).toEqual([
      { k: 1, precision: 1, recall: 0.5 },
      { k: 2, precision: 0.5, recall: 0.5 },
      { k: 3, precision: 0.667, recall: 1 },
    ]);
    expect(rows[2].minutes).toBe(0.5);
  });

  test("the random baseline is certain when one event covers the whole source", () => {
    const [row] = rankingAtK({ moments, references: [{ start: 0, end: 100 }], ks: [3], halves: [{ start: 0, end: 100 }], crowd: { stepSec: 5, values: Array(20).fill(1) }, trials: 50, seed: 7 });
    expect(row.randomPrecision).toBe(1);
    expect(row.randomRecall).toBe(1);
    expect(row.loudCrowdPrecision).toBe(1);
  });
});

test("uniform placement weights the feasible starts and never bridges half-time", () => {
  const halves = [{ start: 10, end: 30 }, { start: 50, end: 80 }];
  expect(placeInHalves(10, halves, 0)).toEqual({ start: 10, end: 20 });
  expect(placeInHalves(10, halves, 1 / 3)).toEqual({ start: 50, end: 60 });
  expect(placeInHalves(10, halves, 0.5)).toEqual({ start: 55, end: 65 });
  for (const draw of [0, 0.1, 0.32, 0.5, 0.99]) {
    const range = placeInHalves(10, halves, draw);
    expect(halves.some((half) => range.start >= half.start && range.end <= half.end)).toBe(true);
  }
  expect(placeInHalves(20, [halves[0]], 0.5)).toEqual(halves[0]);
  expect(() => placeInHalves(31, halves, 0.5)).toThrow("No playing half");
});

test("loud sampling excludes the break and preserves peak offsets inside a half", () => {
  const halves = [{ start: 5, end: 105 }, { start: 155, end: 255 }];
  const values: number[] = Array.from({ length: 60 }, (_, i) => i >= 21 && i < 31 ? 100 : 0);
  values[1] = 4;
  values[19] = 3;
  values[31] = 2;
  values[40] = 1;
  const peaks = loudCrowdPeaks({ stepSec: 5, values }, halves);
  expect(peaks).toEqual([7.5, 97.5, 157.5, 202.5]);
  expect(loudPlacements({ start: 0, peak: 10, end: 15 }, peaks, halves)).toEqual([
    { start: 87.5, end: 102.5 }, { start: 192.5, end: 207.5 },
  ]);
  expect(() => loudPlacements({ start: 0, peak: 10, end: 15 }, [7.5], halves)).toThrow("No loud playing-half bin");
});

test("clips-only precision excludes all three packages and requires at least three seconds", () => {
  const moments = [
    { start: 0, end: 10, peak: 5, score: 1 },
    { start: 20, end: 30, peak: 25, score: 0.9 },
    { start: 40, end: 50, peak: 45, score: 0.8 },
    { start: 60, end: 70, peak: 65, score: 0.7 },
    { start: 80, end: 90, peak: 85, score: 0.6 },
  ];
  const references = [
    { start: 7, end: 15, scoreplayId: 1 },
    { start: 27.1, end: 35, scoreplayId: 2 },
    { start: 40, end: 50, scoreplayId: 130852722 },
    { start: 60, end: 70, scoreplayId: 130852723 },
    { start: 80, end: 90, scoreplayId: 130852724 },
  ];
  expect(clipsOnlyAtK(moments, references)).toEqual({ k: 10, precision: 0.2 });
});

test("ranking precision and merged-range recall both reject overlaps below three seconds", () => {
  const [row] = rankingAtK({
    moments: [{ start: 0, end: 10, peak: 5, score: 1 }, { start: 20, end: 30, peak: 25, score: 0.9 }],
    references: [{ start: 7.1, end: 15 }, { start: 27, end: 35 }], ks: [2],
    halves: [{ start: 0, end: 100 }], crowd: { stepSec: 5, values: Array(20).fill(1) }, trials: 1, seed: 1,
  });
  expect(row.precision).toBe(0.5);
  expect(row.recall).toBe(0.5);
});

import { expect, test } from "bun:test";
import { energyCurve, findPeaks, floorPerSecond, parseRmsPrint, settleAfter } from "./energy";

/** A flat -30 dB crowd with a rise to `db` for `width` seconds starting at each burst's second. */
function crowd(seconds: number, bursts: { at: number; db: number; width?: number }[]) {
  const floor = new Array<number>(seconds).fill(-30);
  for (const b of bursts) for (let s = b.at; s < b.at + (b.width ?? 6) && s < seconds; s++) floor[s] = b.db;
  return floor;
}

test("the crowd floor is the 20th percentile of the 100 ms frames around each second", () => {
  const rmsDb = Array.from({ length: 30 }, (_, i) => (i % 10 === 0 ? -10 : -40));
  expect(floorPerSecond({ frameSec: 0.1, durationSec: 3, rmsDb })).toEqual([-40, -40, -40]);
});

test("ffmpeg's ametadata print is placed by pts_time, and -inf reads as silence", () => {
  const text = "frame:0 pts:0 pts_time:0\nlavfi.astats.Overall.RMS_level=-31.5\nframe:1 pts:1600 pts_time:0.1\nlavfi.astats.Overall.RMS_level=-inf\n";
  expect(parseRmsPrint(text, 0.1, 0.3)).toEqual([-31.5, -90, -90]);
});

test("finds the loud stretches, loudest first, and ignores a small bump", () => {
  const peaks = findPeaks(crowd(600, [{ at: 100, db: -18 }, { at: 200, db: -28 }, { at: 400, db: -21 }]));
  expect(peaks.map((p) => p.peak)).toEqual([100, 400]);
  expect(peaks[0].score).toBe(1);
  expect(peaks[1].score).toBeGreaterThan(0.5);
  expect(peaks[1].score).toBeLessThan(1);
});

test("a clip window starts before the roar, because the play comes first", () => {
  const [p] = findPeaks(crowd(600, [{ at: 300, db: -18 }]));
  expect(p.start).toBe(285);
  expect(p.end).toBe(310);
});

test("two roars closer than the gap are one moment, kept at the louder one", () => {
  const peaks = findPeaks(crowd(600, [{ at: 300, db: -22 }, { at: 312, db: -16 }]));
  expect(peaks.map((p) => p.peak)).toEqual([312]);
});

test("windows stay inside the video, and a silent or flat video has no peaks", () => {
  const [early] = findPeaks(crowd(120, [{ at: 4, db: -15 }]));
  expect(early.start).toBe(0);
  expect(findPeaks(new Array(600).fill(-30))).toEqual([]);
  expect(findPeaks([])).toEqual([]);
});

test("caps the number of moments to about one per three minutes, at least five", () => {
  const bursts = Array.from({ length: 40 }, (_, i) => ({ at: 60 + i * 60, db: -20 + (i % 5) }));
  expect(findPeaks(crowd(2460, bursts)).length).toBe(Math.round(2460 / 180));
  expect(findPeaks(crowd(400, bursts.slice(0, 6))).length).toBe(5);
});

test("a moment is placed where the roar starts, not where it tops out", () => {
  const floor = new Array<number>(600).fill(-30);
  [-24, -22, -18, -16, -15, -15, -20].forEach((db, i) => (floor[300 + i] = db));
  const [p] = findPeaks(floor);
  expect(p.peak).toBe(301);
  expect(p.start).toBe(286);
});

test("a roar settles when the crowd falls most of the way back for two seconds", () => {
  const floor = new Array<number>(600).fill(-30);
  for (let s = 300; s < 320; s++) floor[s] = -15;
  // A one-second swell at 321 s is still the same roar, so it settles at the quiet pair from 322 s.
  floor[321] = -18;
  expect(settleAfter(floor, 300)).toBe(22);
  const short = new Array<number>(600).fill(-30);
  for (let s = 300; s < 304; s++) short[s] = -15;
  expect(settleAfter(short, 300)).toBe(4);
});

test("a roar that never settles before the end, or a flat crowd, has no answer", () => {
  const floor = new Array<number>(330).fill(-30);
  for (let s = 300; s < 330; s++) floor[s] = -15;
  expect(settleAfter(floor, 300)).toBeUndefined();
  expect(settleAfter(new Array(600).fill(-30), 300)).toBeUndefined();
});

test("the energy curve keeps every second of a short match and the loudest of each bucket of a long one", () => {
  expect(energyCurve([-30, -20.04, -25])).toEqual({ stepSec: 1, db: [-30, -20, -25] });
  const long = Array.from({ length: 1200 }, (_, s) => (s === 601 ? -10 : -30));
  const curve = energyCurve(long, 600);
  expect(curve.stepSec).toBe(2);
  expect(curve.db).toHaveLength(600);
  expect(curve.db[300]).toBe(-10);
  expect(curve.db[299]).toBe(-30);
  expect(energyCurve([])).toEqual({ stepSec: 1, db: [] });
});

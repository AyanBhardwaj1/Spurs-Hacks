import { expect, test } from "bun:test";
import { findPeaks } from "./energy";
import { excitedCalls, fuseMoments } from "./moments";
import { SPORT } from "./sports";
import { SPORTS } from "./types";

const words = (at: number, text: string) => text.split(" ").map((t, i) => ({ text: t, start: at + i * 0.4, end: at + i * 0.4 + 0.35 }));

test("every sport has a label, a gap between plays and hashtags written without the #", () => {
  for (const s of SPORTS) {
    expect(SPORT[s].label.length).toBeGreaterThan(0);
    expect(SPORT[s].gapSec).toBeGreaterThan(0);
    expect(SPORT[s].tags.length).toBeGreaterThanOrEqual(3);
    for (const t of SPORT[s].tags) expect(t).toMatch(/^[a-z0-9]+$/);
  }
});

test("a call counts in its own sport and not in one where the word means nothing", () => {
  const six = words(50, "and that is a huge six");
  expect(excitedCalls(six, "cricket").map((c) => c.at)).toEqual([52]);
  expect(excitedCalls(six, "soccer")).toEqual([]);
  expect(excitedCalls(words(10, "ace down the middle"), "tennis").length).toBe(1);
  expect(excitedCalls(words(10, "knockout he is down"), "combat").length).toBe(1);
});

test("the shared calls work in every sport, and 'other' listens for all of them", () => {
  for (const s of SPORTS) expect(excitedCalls(words(5, "what a moment"), s).length).toBe(1);
  expect(excitedCalls(words(5, "home run"), "other").length).toBe(1);
});

test("a fast sport keeps two roars that a slow one treats as one play", () => {
  const floor = new Array<number>(600).fill(-30);
  for (const at of [300, 312]) for (let s = at; s < at + 4; s++) floor[s] = at === 300 ? -20 : -16;
  expect(findPeaks(floor, SPORT.soccer.gapSec).length).toBe(1);
  expect(findPeaks(floor, SPORT.basketball.gapSec).map((p) => p.peak)).toEqual([312, 300]);
});

test("moments merge at the sport's gap, so back-to-back points stay separate in tennis", () => {
  const peaks = [{ peak: 100, start: 85, end: 110, score: 1 }, { peak: 112, start: 97, end: 122, score: 0.9 }];
  expect(fuseMoments({ durationSec: 600, peaks, words: [], cuts: [] }).length).toBe(1);
  expect(fuseMoments({ durationSec: 600, peaks, words: [], cuts: [], sport: "tennis" }).length).toBe(2);
});

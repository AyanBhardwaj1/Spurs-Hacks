import { describe, expect, test } from "bun:test";
import { cueWords, nameFixer, wordsInClip } from "./captions";

const round = (words: { text: string; start: number; end: number }[]) =>
  words.map((w) => ({ text: w.text, start: Math.round(w.start * 100) / 100, end: Math.round(w.end * 100) / 100 }));

describe("cueWords", () => {
  test("says a lone name at the start of a long line instead of stretching it across the line", () => {
    const [word] = cueWords({ index: 1, start: 5818.01, end: 5821.97, text: "Tonali." });
    expect(word.start).toBe(5818.01);
    expect(word.end).toBeLessThan(5818.6);
  });
});

describe("wordsInClip", () => {
  const words = [
    { text: "before", start: 99, end: 100.2 },
    { text: "Solanke", start: 100.5, end: 101 },
    { text: "scores", start: 101.8, end: 102.4 },
    { text: "later", start: 150, end: 151 },
  ];

  test("offsets each segment by the length of the ones before it, repeats a replayed range, and keeps words a segment cuts into", () => {
    const segments = [{ start: 100, end: 102 }, { start: 140, end: 152 }, { start: 100.7, end: 101.2 }];
    expect(round(wordsInClip(words, segments))).toEqual([
      // Said from 99 s; the clip starts mid-word at 100 s.
      { text: "before", start: 0, end: 0.2 },
      { text: "Solanke", start: 0.5, end: 1 },
      // Cut at the first segment's end, 2 s into the clip.
      { text: "scores", start: 1.8, end: 2 },
      { text: "later", start: 12, end: 13 },
      // The replay starts at 100.7 s, inside "Solanke".
      { text: "Solanke", start: 14, end: 14.3 },
    ]);
  });
});

describe("nameFixer", () => {
  const fix = nameFixer(["Mateus Fernandes", "Mateus Gonçalo Espanha Fernandes", "Sávio", "Gray", "Kinský", "Shaw"], { Künlü: "Cunha" });

  test("respells commentary names to the roster", () => {
    expect(fix("Gray. Matheus Fernandes in and away by Dalot.")).toBe("Gray. Mateus Fernandes in and away by Dalot.");
    expect(fix("Savio and Kinsky")).toBe("Sávio and Kinský");
    expect(fix("Künlü.")).toBe("Cunha.");
  });

  test("leaves short near-misses and ordinary words alone", () => {
    expect(fix("Grey skies. Show us. Should he?")).toBe("Grey skies. Show us. Should he?");
  });
});

import { describe, expect, test } from "bun:test";
import { clipTime, focusInCrop, overlayAss, roarOnset, scoreAt } from "./graphics";
import { cueWords } from "./captions";
import { renderKey } from "./render";

describe("roarOnset", () => {
  // 100 ms frames: a -30 dB crowd with speech spikes, rising to -20 dB at 104 s.
  const rmsDb = Array.from({ length: 1200 }, (_, i) => (i >= 1040 ? -20 : i % 7 === 0 ? -12 : -30));
  const frames = { frameSec: 0.1, durationSec: 120, rmsDb };

  test("puts a goal's beat at the roar, not at the commentator's call", () => {
    const beat = roarOnset(frames, 101)!;
    expect(beat).toBeGreaterThan(103.6);
    expect(beat).toBeLessThan(104.6);
  });

  test("finds no beat when the crowd does not rise", () => {
    expect(roarOnset({ ...frames, rmsDb: rmsDb.map((v) => Math.min(v, -30)) }, 101)).toBeUndefined();
  });
});

test("scores goals by home and away up to and including the moment", () => {
  const moments = [
    { kind: "goal" as const, team: "opponent" as const, peak: 4667 },
    { kind: "disallowed-goal" as const, team: "spurs" as const, peak: 3633 },
    { kind: "goal" as const, team: "spurs" as const, peak: 5822 },
  ];
  expect(scoreAt(moments, 4999, false)).toBe("1-0");
  expect(scoreAt(moments, 4999, true)).toBe("0-1");
  expect(scoreAt(moments, 5822, false)).toBe("1-1");
});

test("finds a source second's first place on a multi-segment clip", () => {
  const segments = [{ start: 4995, end: 5008 }, { start: 5024.6, end: 5032.9 }];
  expect(clipTime(segments, 5026)).toBeCloseTo(14.4, 6);
  expect(clipTime(segments, 5010)).toBeUndefined();
});

test("moves the zoom centre off the middle when the crop is held at the frame's edge", () => {
  expect(focusInCrop(0.5, 606)).toBeCloseTo(0.5, 6);
  // At x = 0.05 the 606 px crop sits against the left edge, so the focus is 96 px into it.
  expect(focusInCrop(0.05, 606)).toBeCloseTo(96 / 606, 6);
});

test("fails if a graphics change can reuse an old render", () => {
  const clip = { segments: [{ start: 10, end: 20, momentId: "goal" }], format: "9:16" as const, title: "Goal" };
  const focus = new Map([["goal", [{ t: 10, x: 0.5 }]]]);
  const source = { mediaId: 1, format: "original", width: 1920, height: 1080 };
  expect(renderKey(clip, focus, source, "a")).not.toBe(renderKey(clip, focus, source, "b"));
  expect(renderKey(clip, focus, source, "a")).not.toBe(renderKey(clip, focus, source));
});

test("captions a clip's commentary in short phrases, in clip time, with roster spellings", () => {
  const clip = {
    id: "c", lane: "asap" as const, variant: "Goal", format: "9:16" as const, title: "Equaliser", caption: "", hashtags: [],
    segments: [{ start: 100, end: 110 }], durationSec: 10, viralScore: 0, rationale: "",
  };
  const words = cueWords({ index: 1, start: 102, end: 105, text: "I don't believe it. Matheus Fernandes!" });
  const players = [{ id: 1, name: "Mateus Gonçalo Espanha Fernandes", shortName: "Mateus Fernandes" }];
  const lines = overlayAss({ sourceId: 1, clip, moments: [], players, words }, "9:16").split("\n").filter((l) => l.includes(",Caption,"));
  const shown = lines.map((l) => l.split(",,0,0,0,,")[1].replace(/\{[^}]*\}/g, ""));
  // The full stop ends a phrase even though the caption drops it.
  expect([...new Set(shown)]).toEqual(["I DON'T BELIEVE", "IT", "MATEUS FERNANDES!"]);
  expect(lines[0].startsWith("Dialogue: 0,0:00:02.00,")).toBe(true);
});

describe("match-specific graphics", () => {
  const clip = {
    id: "c", lane: "asap" as const, variant: "Goal", format: "9:16" as const, title: "Goal", caption: "", hashtags: [],
    segments: [{ start: 100, end: 110 }], durationSec: 10, viralScore: 0, rationale: "",
  };
  const moments = [
    { kind: "goal" as const, team: "opponent" as const, peak: 50 },
    { kind: "goal" as const, team: "opponent" as const, peak: 60 },
    { kind: "goal" as const, team: "spurs" as const, peak: 105 },
  ].map((m, i) => ({ ...m, id: `m${i}`, title: "", summary: "", start: m.peak - 5, end: m.peak + 5, players: [], evidence: [], focus: [], scores: { importance: 0, emotion: 0, crowd: 0, social: 0, total: 0 } }));
  const words = cueWords({ index: 1, start: 103, end: 104, text: "Künlü." });
  const render = (sourceId: number) => overlayAss({ sourceId, clip, moments, players: [], words }, "9:16").split("\n");

  test("ends the Man United v Spurs source on its names and the score its goal moments add up to", () => {
    const lines = render(130852725);
    expect(lines.filter((l) => l.includes(",Score,")).map((l) => l.split("}").at(-1))).toEqual(["MAN UNITED 2-1 SPURS"]);
    expect(lines.some((l) => l.includes("CUNHA"))).toBe(true);
  });

  test("gives any other source no team names, score or name aliases", () => {
    const lines = render(1);
    expect(lines.some((l) => l.includes(",Score,"))).toBe(false);
    expect(lines.some((l) => l.includes("CUNHA"))).toBe(false);
  });
});

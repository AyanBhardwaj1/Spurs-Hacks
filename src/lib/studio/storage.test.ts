import { describe, expect, test } from "bun:test";
import { mergeRanges, storagePlan, type StorageInput } from "./storage";
import type { Moment } from "./types";

const moment: Moment = {
  id: "m1",
  kind: "chance",
  title: "Early chance",
  summary: "",
  start: 100,
  end: 130,
  peak: 115,
  players: [],
  team: "spurs",
  evidence: [],
  scores: { importance: 0, emotion: 0, crowd: 0, social: 0, total: 0 },
  focus: [],
};

// A 600 s match. The loud crowd bin is 300 to 400, the dropped candidate keeps 440 to 460, and the two
// 40 s gaps either side of it are too short to call cold.
const analysis: StorageInput = {
  source: { durationSec: 600 },
  moments: [moment],
  clips: [
    {
      id: "c1",
      lane: "asap",
      variant: "Goal",
      format: "9:16",
      title: "",
      caption: "",
      hashtags: [],
      segments: [{ start: 300, end: 320 }],
      durationSec: 20,
      viralScore: 0,
      rationale: "",
    },
  ],
  groundTruth: [{ scoreplayId: 1, name: "club.mp4", start: 500, end: 505, alignedBy: "audio", confidence: 1 }],
  rejected: [{ title: "Long shot", at: 450, source: "commentary", reason: "" }],
  crowd: { stepSec: 100, values: [0.1, 0.2, 0.3, 0.9, 0.4, 0.5] },
};

describe("storagePlan", () => {
  test("keeps what the run pointed at and calls the long gaps cold, longest first", () => {
    expect(storagePlan(analysis)).toEqual({
      durationSec: 600,
      keptSec: 155,
      cold: [
        { start: 130, end: 300, crowdPeak: 0.3 },
        { start: 0, end: 100, crowdPeak: 0.1 },
        { start: 505, end: 600, crowdPeak: 0.5 },
      ],
      coldSec: 365,
    });
  });
});

describe("mergeRanges", () => {
  test("clamps to the source and merges touching ranges", () => {
    const ranges = [
      { start: -5, end: 15 },
      { start: 15, end: 20 },
      { start: 590, end: 700 },
    ];
    expect(mergeRanges(ranges, 600)).toEqual([
      { start: 0, end: 20 },
      { start: 590, end: 600 },
    ]);
  });
});

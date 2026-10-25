import { describe, expect, test } from "bun:test";
import { clubClipName, clubVideos, coveredMinutes, editorialOf, linkedMoments, momentGroups, reelStudioId, usesMatchWatch, writtenMomentIds, rankClips, scoreBreakdown } from "./clips";
import { clubCheck } from "./evaluation";
import { cropShift, focusAt } from "./reframe";
import { spriteFrame } from "./sprites";
import { clipLength, timecode } from "./time";
import type { Clip, Moment } from "./types";

describe("timecode", () => {
  test("drops the hour under an hour and pads past it", () => {
    expect(timecode(59.9)).toBe("0:59");
    expect(timecode(5462)).toBe("1:31:02");
    expect(timecode(6334)).toBe("1:45:34");
  });

  test("rounds a clip length to the nearest second", () => {
    expect(clipLength(23.6)).toBe("0:24");
    expect(clipLength(125)).toBe("2:05");
  });
});

describe("focusAt", () => {
  const keys = [
    { t: 10, x: 0.2 },
    { t: 20, x: 0.6 },
  ];

  test("centres with no keys", () => expect(focusAt([], 15)).toBe(0.5));
  test("holds the first and last key", () => {
    expect(focusAt(keys, 0)).toBe(0.2);
    expect(focusAt(keys, 99)).toBe(0.6);
  });
  test("interpolates between keys", () => expect(focusAt(keys, 15)).toBeCloseTo(0.4));
});

describe("cropShift", () => {
  const r = (16 / 9) / (9 / 16);

  test("centres a 9:16 window on the middle of the source", () => {
    // The window is 1/r of the video wide; centred, its left edge sits at (1 - 1/r) / 2 of the video.
    expect(cropShift(0.5, 9 / 16)).toBeCloseTo(-(1 - 1 / r) / 2);
  });

  test("stops at either edge instead of showing past the frame", () => {
    expect(cropShift(0, 9 / 16)).toBe(0);
    expect(cropShift(1, 9 / 16)).toBeCloseTo(1 / r - 1);
  });

  test("leaves a 16:9 clip alone", () => expect(cropShift(0.9, 16 / 9)).toBe(0));
});

describe("spriteFrame", () => {
  const sheets = { template: "https://cdn/x_{n}.jpg", durationSec: 6334 };

  test("finds the sheet and the cell for a second", () => {
    // Second 125 is sheet 2, cell 5: column 5, row 0.
    const f = spriteFrame(sheets, 125.7);
    expect(f.url).toBe("https://cdn/x_2.jpg");
    expect(f.position).toBe(`${(5 / 9) * 100}% 0%`);
  });

  test("holds the last frame past the end", () => {
    expect(spriteFrame(sheets, 99_999).url).toBe("https://cdn/x_105.jpg");
  });
});

const moment = (id: string, scores: Partial<Moment["scores"]>): Moment => ({
  id,
  kind: "chance",
  title: id,
  summary: "",
  start: 0,
  end: 1,
  peak: 0,
  players: [],
  team: "spurs",
  evidence: [],
  scores: { importance: 0, emotion: 0, crowd: 0, social: 0, total: 0, ...scores },
  focus: [],
});

const clip = (id: string, viralScore: number, momentIds: (string | undefined)[]): Clip => ({
  id,
  lane: "asap",
  variant: "Goal",
  format: "9:16",
  title: id,
  caption: "",
  hashtags: [],
  segments: momentIds.map((momentId, i) => ({ start: i, end: i + 1, momentId })),
  durationSec: momentIds.length,
  viralScore,
  rationale: "",
});

describe("clip ranking and scores", () => {
  test("ranks by viral score and keeps the pipeline's order on ties", () => {
    const ranked = rankClips([clip("a", 0.5, []), clip("b", 0.9, []), clip("c", 0.5, [])]);
    expect(ranked.map((c) => c.id)).toEqual(["b", "a", "c"]);
  });

  test("averages the parts of each linked moment once", () => {
    const byId = new Map([
      ["m1", moment("m1", { importance: 1, crowd: 0.2 })],
      ["m2", moment("m2", { importance: 0.5, crowd: 0.6 })],
    ]);
    const linked = linkedMoments(clip("x", 1, ["m1", undefined, "m2", "m1"]), byId);
    expect(linked.map((m) => m.id)).toEqual(["m1", "m2"]);
    const parts = scoreBreakdown(linked);
    expect(parts?.importance).toBeCloseTo(0.75);
    expect(parts?.crowd).toBeCloseTo(0.4);
  });

  test("refuses a segment that points at a missing moment", () => {
    expect(() => linkedMoments(clip("x", 1, ["gone"]), new Map())).toThrow(/gone/);
  });
});

describe("club videos", () => {
  const range = (scoreplayId: number, name: string, start: number) => ({
    scoreplayId,
    name,
    start,
    end: start + 5,
    alignedBy: "subtitles" as const,
    confidence: 1,
  });

  test("strips the cut suffix and the extension", () => {
    expect(clubClipName("9x16_MNU_1_1_TOT_HIGHLIGHTS.mp4 · cut at 1:08")).toBe("9x16_MNU_1_1_TOT_HIGHLIGHTS");
    expect(clubClipName("solanke late goal.mp4")).toBe("solanke late goal");
  });

  test("groups ranges by video, most ranges first, each in source order", () => {
    const videos = clubVideos([
      range(2, "goal.mp4", 500),
      range(1, "HL.mp4 · cut at 0:08", 900),
      range(1, "HL.mp4 · cut at 0:02", 300),
    ]);
    expect(videos.map((v) => v.name)).toEqual(["HL", "goal"]);
    expect(videos[0].ranges.map((r) => [r.start, r.cutAt])).toEqual([
      [300, "0:02"],
      [900, "0:08"],
    ]);
  });
});

describe("coveredMinutes", () => {
  test("counts overlapping moments once", () => {
    const moments = [
      { start: 0, end: 60 },
      { start: 30, end: 90 },
      { start: 120, end: 180 },
    ];
    expect(coveredMinutes(moments)).toBe(2.5);
  });
});

describe("clubCheck", () => {
  const cut = (k: number, precision: number) => ({
    k,
    precision,
    recall: 0.4,
    minutes: 6,
    randomPrecision: 0.17,
    randomRecall: 0.08,
    loudCrowdPrecision: 0.24,
  });
  const evaluation = {
    matched: 50,
    total: 54,
    recall: 0.93,
    mergedRanges: 24,
    overlapMinSec: 3,
    clipsOnly: { k: 10, precision: 0.4 },
    atK: [cut(20, 0.75), cut(10, 0.9)],
  };

  test("leads with K = 10 and turns shares into counts", () => {
    const check = clubCheck(evaluation);
    expect(check.head.k).toBe(10);
    expect(check.head.hits).toBe(9);
    expect(check.head.random).toBe(1.7);
    expect(check.head.loudCrowd).toBe(2.4);
    expect(check.clipsOnly).toEqual({ k: 10, hits: 4 });
    expect(check.cutoffs.map((c) => c.k)).toEqual([10, 20]);
  });
});

describe("momentGroups", () => {
  test("groups the variants of a moment and leaves single edits and multi-moment edits apart", () => {
    const byId = new Map(["a", "b", "c"].map((id) => [id, moment(id, {})]));
    const ranked = [clip("a1", 0.9, ["a"]), clip("b1", 0.8, ["b"]), clip("a2", 0.7, ["a", "a"]), clip("mix", 0.6, ["a", "c"]), clip("c1", 0.5, ["c"])];
    const { groups, others } = momentGroups(ranked, byId);
    expect(groups.map((g) => [g.moment.id, g.clips.map((c) => c.id)])).toEqual([["a", ["a1", "a2"]]]);
    expect(others.map((c) => c.id)).toEqual(["b1", "mix", "c1"]);
  });
});

describe("writtenMomentIds", () => {
  test("takes the moments the writeback read back", () => {
    const writeback = { videoLogs: 2, tags: [], at: "", momentIds: ["m1", "m7"] };
    expect([...writtenMomentIds({ writeback })]).toEqual(["m1", "m7"]);
  });

  test("claims none when the writeback does not list its moments, or did not run", () => {
    expect(writtenMomentIds({ writeback: { videoLogs: 30, tags: [], at: "" } }).size).toBe(0);
    expect(writtenMomentIds({ writeback: undefined }).size).toBe(0);
  });
});

describe("editorial review and finishing", () => {
  test("reads MatchWatch's editorial lens, keeping unknown scores as null", () => {
    const m: Moment = { ...moment("a", {}), editorial: { importance: 0.8, excitement: null, watchability: 1, flags: ["replay"], source: "matchwatch-jev" } };
    expect(editorialOf(m)).toEqual({ importance: 0.8, excitement: null, watchability: 1, flags: ["replay"] });
    expect(editorialOf(moment("b", {}))).toBeUndefined();
  });

  test("credits MatchWatch only when its review or segmentation is in the run", () => {
    const seg = { ...moment("s", {}), evidence: [{ source: "twelvelabs-analysis" as const, detail: "Pegasus segmentation (MatchWatch prompts): goal", at: 1, strength: 1 }] };
    expect(usesMatchWatch([moment("a", {}), seg])).toBe(true);
    expect(usesMatchWatch([moment("a", {})])).toBe(false);
  });

  test("does not credit unrelated Twelve Labs segmentation", () => {
    const other = {
      ...moment("other", {}),
      evidence: [{ source: "twelvelabs-analysis" as const, detail: "video segmentation complete", at: 1, strength: 1 }],
    };
    expect(usesMatchWatch([other])).toBe(false);
  });

  test("reads a Reel Studio media ID only when it is a number", () => {
    expect(reelStudioId({ ...clip("a", 1, []), reelStudioMediaId: 131 } as never)).toBe(131);
    expect(reelStudioId(clip("b", 1, []))).toBeUndefined();
  });
});

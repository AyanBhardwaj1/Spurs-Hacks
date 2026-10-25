import { describe, expect, test } from "bun:test";
import { propose } from "./propose";
import type { Moment, MomentAnalysis, MomentKind } from "./types";

const analysis = (intensity: number): MomentAnalysis => ({
  description: "",
  players: [],
  emotion: "elation",
  intensity,
  isReplay: false,
  sponsorsVisible: [],
  crowdAudible: true,
  quality: "good",
  brandSafe: true,
  hook: "Hook",
  captions: {},
});

const moment = (id: string, kind: MomentKind, score: number, analysed = true): Moment => ({
  id,
  kind,
  title: id,
  primary: { assetId: "a", videoId: "v", start: 100, end: 110 },
  angles: [],
  signals: [{ source: "footage", label: id, strength: score }],
  analysis: analysed ? analysis(score) : undefined,
  score,
});

const run = (moments: Moment[]) => propose(moments, { assets: [], partners: [], now: "2026-10-23T15:00:00Z" });

describe("propose", () => {
  test("the shortlist takes one piece from each of the five strongest moments", () => {
    // The goal's four pitches all outscore every other moment's best piece.
    const { proposals } = run([
      moment("goal", "goal", 0.98),
      moment("bench", "bench", 0.7),
      moment("crowd", "crowd", 0.68),
      moment("skill", "skill", 0.66),
      moment("quiet", "silence", 0.64),
      moment("coach", "coach", 0.5),
    ]);
    const shortlist = proposals.filter((p) => p.shortlist);
    expect(shortlist.map((p) => p.momentId).sort()).toEqual(["bench", "crowd", "goal", "quiet", "skill"]);
    expect(proposals.slice(0, 5)).toEqual(shortlist);
    // The goal's other pieces are still in the queue, just not on the shortlist.
    expect(proposals.filter((p) => p.momentId === "goal").length).toBeGreaterThan(1);
  });

  test("once Pegasus has run, a moment it never looked at is spiked, not pitched", () => {
    const { proposals, spikes } = run([moment("goal", "goal", 0.98), moment("bench", "bench", 0.7, false)]);
    expect(proposals.some((p) => p.momentId === "bench")).toBe(false);
    expect(spikes.find((s) => s.momentId === "bench")?.reason).toBe("cut-for-time");
  });
});

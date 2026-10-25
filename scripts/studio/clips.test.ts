import { describe, expect, test } from "bun:test";
import type { Moment } from "../../src/lib/studio/types";
import { checkPlan, type Shot } from "./clips";

const moment: Moment = {
  id: "m-5822-goal",
  kind: "goal",
  title: "Solanke equalises",
  summary: "",
  start: 5797,
  end: 5857,
  peak: 5822,
  players: [],
  team: "spurs",
  evidence: [],
  scores: { importance: 1, emotion: 1, crowd: 0.6, social: 0, total: 0.8 },
  focus: [],
};
const shot: Shot = { id: "shot-1", momentId: moment.id, angle: "Fans", query: "away fans celebrating", start: 5950, end: 5962, rank: 2 };

const asap = (start: number, end: number) => ({
  lane: "asap" as const,
  variant: "Reaction",
  format: "9:16" as const,
  title: "t",
  caption: "c",
  hashtags: ["#COYS"],
  segments: [
    { start: 5810, end: 5825, momentId: moment.id },
    { start, end, momentId: moment.id },
  ],
  viralScore: 0.5,
  rationale: "r",
});

const placement = (errors: string[]) => errors.filter((e) => e.includes("neither within"));

describe("checkPlan", () => {
  const context = { moments: [moment], variations: [], singles: [], shots: [shot], durationSec: 6334 };

  test("accepts a segment inside one of the moment's fetched shots", () => {
    expect(placement(checkPlan([asap(5951, 5961)], context))).toEqual([]);
  });

  test("rejects a segment outside both the moment and its shots", () => {
    expect(placement(checkPlan([asap(5900, 5910)], context))).toHaveLength(1);
  });
});

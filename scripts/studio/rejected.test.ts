import { expect, test } from "bun:test";
import type { Moment } from "../../src/lib/studio/types";
import { rankedRejections } from "./rejected";

const moment: Moment = { id: "m-low", kind: "chance", title: "Shot wide", summary: "A shot misses.", start: 10, peak: 15, end: 20, players: [], team: "opponent", evidence: [], focus: [], scores: { importance: 0.3, emotion: 0.2, crowd: 0.12, social: 0, total: 0.24 } };

test("fails if a ranking rejection loses its score explanation or includes a selected moment", () => {
  const selected = { ...moment, id: "m-selected", scores: { ...moment.scores, total: 0.8 } };
  const rejected = rankedRejections([moment, selected], [{ id: "clip", lane: "asap", variant: "Moment", format: "9:16", title: "Chance", caption: "Shot", hashtags: [], segments: [{ start: 10, end: 20, momentId: selected.id }], durationSec: 10, viralScore: 0.5, rationale: "Action" }]);
  expect(rejected).toHaveLength(1);
  expect(rejected[0].momentId).toBe("m-low");
  expect(rejected[0].reason).toContain("Ranked 2");
  expect(rejected[0].reason).toContain("crowd 0.12");
  expect(rejected[0].reason).toContain("no visual search confirmation");
});

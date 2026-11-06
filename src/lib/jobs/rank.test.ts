import { expect, test } from "bun:test";
import { clipStrength, postOrder } from "./rank";
import type { JobClip, JobMoment } from "./types";

const moment = (id: string, over: Partial<JobMoment> = {}): JobMoment => ({ id, peak: 100, start: 85, end: 110, score: 0.8, signals: ["crowd"], title: "Crowd erupts at 1:40", ...over });
const clip = (id: string, momentId: string, over: Partial<JobClip> = {}): JobClip => ({
  id,
  momentId,
  placement: "tiktok",
  segments: [{ start: 92, end: 112 }],
  title: "t",
  hook: "Listen to this crowd",
  caption: "c",
  hashtags: [],
  why: "w",
  render: { state: "ready" },
  ...over,
});

test("strength adds up what the evidence shows, and says why", () => {
  const plain = clipStrength(clip("a", "m"), moment("m"));
  expect(plain.score).toBe(40 + 5);
  const strong = clipStrength(
    clip("b", "m", { hook: "What a goal", segments: [{ start: 92, end: 110 }] }),
    moment("m", { score: 1, signals: ["crowd", "commentary"], settle: 9, focus: [{ t: 100, x: 0.4 }], title: "“What a goal” at 1:40" }),
  );
  expect(strong.score).toBe(100);
  expect(strong.reasons).toEqual([
    "The crowd and the commentary both picked it.",
    "The commentary called it.",
    "It ends as the crowd settles.",
    "The crop follows the play.",
    "Short enough to watch twice.",
  ]);
});

test("a wide clip needs no crop, so it does not lose points for one", () => {
  const wide = clipStrength(clip("x", "m", { placement: "x-video" }), moment("m"));
  expect(wide.reasons).toContain("Wide, so nothing is cropped out.");
});

test("each platform's clips are ranked on their own, strongest first, ties to the earlier play", () => {
  const moments = [moment("weak", { score: 0.5 }), moment("big", { score: 1, peak: 300 }), moment("early", { score: 1, peak: 50 })];
  const clips = [clip("t-weak", "weak"), clip("t-big", "big"), clip("t-early", "early"), clip("x-weak", "weak", { placement: "x-video" })];
  const order = postOrder(clips, moments);
  expect([...order.entries()].map(([id, r]) => [id, r.rank])).toEqual([
    ["t-early", 1],
    ["t-big", 2],
    ["t-weak", 3],
    ["x-weak", 1],
  ]);
});

import { expect, test } from "bun:test";
import { PLACEMENTS } from "@/lib/rundown/platforms";
import { clipSeconds, cutRange, highlightChapters, planClips, replayWindow } from "./planner";
import type { JobMoment } from "./types";

const moment = (peak: number, score: number, extra: Partial<JobMoment> = {}): JobMoment => ({
  id: `m-${peak}`, peak, start: peak - 15, end: peak + 10, score, signals: ["crowd"], title: `Crowd erupts at ${peak}`, ...extra,
});
const length = (c: { segments: { start: number; end: number }[] }) => c.segments.reduce((n, s) => n + s.end - s.start, 0);
const base = { durationSec: 5400, sport: "soccer" as const, title: "City v United" };

test("each platform gets its own cut of the same moment", () => {
  const { clips } = planClips({ ...base, moments: [moment(1000, 1)], placements: ["tiktok", "youtube-short", "x-video"] });
  const by = Object.fromEntries(clips.map((c) => [c.placement, c.segments[0]]));
  expect(by.tiktok).toEqual({ start: 992, end: 1010 });
  expect(by["youtube-short"]).toEqual({ start: 986, end: 1014 });
  expect(by["x-video"]).toEqual({ start: 990, end: 1005 });
});

test("platforms take their own number of moments, best first, and say why the rest were left out", () => {
  const moments = [1, 0.95, 0.9, 0.85, 0.8, 0.75].map((s, i) => moment(600 * (i + 1), s));
  const { clips, skipped } = planClips({ ...base, moments, placements: ["tiktok", "x-video"] });
  expect(clips.filter((c) => c.placement === "tiktok").map((c) => c.momentId)).toEqual(["m-600", "m-1200", "m-1800", "m-2400", "m-3000"]);
  expect(clips.filter((c) => c.placement === "x-video")).toHaveLength(3);
  expect(skipped).toContainEqual({ momentId: "m-3600", placement: "tiktok", reason: "Ranked 6th; TikTok takes the top 5." });
});

test("a weak moment is left out everywhere, with its score in the reason", () => {
  const { clips, skipped } = planClips({ ...base, moments: [moment(1000, 0.2)], placements: ["tiktok"] });
  expect(clips).toEqual([]);
  expect(skipped[0].reason).toBe("Scored 0.20, under the 0.30 floor for a clip.");
});

test("cuts stay inside the video and inside the platform's length limit", () => {
  const { clips } = planClips({ ...base, durationSec: 1005, moments: [moment(3, 1), moment(1000, 0.9)], placements: ["tiktok", "x-video"] });
  for (const c of clips) {
    const [s] = c.segments;
    expect(s.start).toBeGreaterThanOrEqual(0);
    expect(s.end).toBeLessThanOrEqual(1005);
    expect(length(c)).toBeLessThanOrEqual(PLACEMENTS[c.placement].maxSeconds);
  }
});

test("YouTube gets one highlights cut of the top moments, in match order", () => {
  const moments = [moment(3000, 0.9), moment(1000, 1), moment(2000, 0.8)];
  const { clips } = planClips({ ...base, moments, placements: ["youtube-video"] });
  expect(clips).toHaveLength(1);
  expect(clips[0].segments.map((s) => s.start)).toEqual([985, 1985, 2985]);
  expect(clips[0].title.length).toBeLessThanOrEqual(100);
});

test("captions keep to each platform's hashtag and length limits", () => {
  const quote = "What a goal ".repeat(40).trim();
  const { clips } = planClips({ ...base, moments: [moment(1000, 1, { quote, title: "“What a goal” at 16:40", signals: ["crowd", "commentary"] })], placements: ["x-video", "tiktok", "instagram-reel"] });
  for (const c of clips) {
    expect(c.hashtags.length).toBeLessThanOrEqual(PLACEMENTS[c.placement].hashtagLimit);
    expect([c.caption, ...c.hashtags.map((h) => `#${h}`)].join(" ").length).toBeLessThanOrEqual(PLACEMENTS[c.placement].captionLimit);
    expect(c.hook.length).toBeLessThanOrEqual(60);
    expect(c.why.length).toBeGreaterThan(20);
    expect(c.render.state).toBe("waiting");
  }
  expect(clips.find((c) => c.placement === "x-video")!.hashtags).toEqual(["football", "soccer"]);
});

test("the highlights cut never plays the same footage twice", () => {
  const { clips } = planClips({ ...base, moments: [moment(1000, 1), moment(1020, 0.9)], placements: ["youtube-video"] });
  expect(clips[0].segments).toEqual([{ start: 985, end: 1030 }]);
});

test("a long roar keeps its cut going until the crowd settles, within each platform's limits", () => {
  const long = moment(1000, 1, { settle: 25 });
  const { clips } = planClips({ ...base, moments: [long], placements: ["tiktok", "x-video", "youtube-short"] });
  const end = (p: string) => clips.find((c) => c.placement === p)!.segments[0].end;
  expect(end("tiktok")).toBe(1018);
  expect(end("x-video")).toBe(1010);
  expect(end("youtube-short")).toBe(1026);
  expect(clips.find((c) => c.placement === "tiktok")!.why).toContain("a second after the crowd settles");
});

test("a short roar ends the cut early, but never under the platform's shortest tail", () => {
  const { clips } = planClips({ ...base, moments: [moment(1000, 1, { settle: 2 })], placements: ["tiktok", "x-video"] });
  expect(clips.map((c) => c.segments[0].end)).toEqual([1006, 1004]);
});

test("each short-form platform's cut length runs from its shortest tail to its longest", () => {
  expect(cutRange("tiktok")).toEqual({ min: 14, max: 26, count: 5 });
  expect(cutRange("youtube-short")).toEqual({ min: 22, max: 44, count: 4 });
  expect(cutRange("youtube-video")).toBeUndefined();
});

test("the highlights cut gets YouTube chapters: from 0:00, in cut time, at least 10 s apart", () => {
  const m = (id: string, peak: number, start: number, title: string) => ({ id, peak, start, end: start + 25, score: 1, signals: ["crowd" as const], title });
  const segments = [{ start: 100, end: 125 }, { start: 300, end: 330 }, { start: 600, end: 625 }];
  const chapters = highlightChapters([m("a", 115, 100, "“what a goal” at 1:55"), m("b", 312, 300, "Crowd erupts at 5:12"), m("b2", 318, 305, "x"), m("c", 615, 600, "Crowd erupts at 10:15")], segments);
  expect(chapters).toEqual([
    { at: 0, label: "“what a goal” at 1:55" },
    { at: 25, label: "Crowd erupts at 5:12" },
    { at: 55, label: "Crowd erupts at 10:15" },
  ]);
  expect(highlightChapters([m("a", 115, 100, "a"), m("b", 312, 300, "b")], segments.slice(0, 2))).toEqual([]);
});

test("with a replay, each short clip replays the three seconds around its play, inside the cut; the highlights cut has none", () => {
  const { clips } = planClips({ ...base, moments: [moment(1000, 1), moment(2000, 0.9), moment(3000, 0.8)], placements: ["tiktok", "youtube-video"], replay: true });
  expect(clips.find((c) => c.id === "tiktok-m-1000")!.replay).toEqual({ start: 998, end: 1001 });
  expect(clips.find((c) => c.placement === "youtube-video")!.replay).toBeUndefined();
  expect(planClips({ ...base, moments: [moment(1000, 1)], placements: ["tiktok"] }).clips[0].replay).toBeUndefined();
});

test("a replay window stays inside its segment", () => {
  expect(replayWindow(1000, { start: 999, end: 1010 })).toEqual({ start: 999, end: 1002 });
  expect(replayWindow(1000, { start: 990, end: 1000.5 })).toEqual({ start: 997.5, end: 1000.5 });
});

test("a clip plays its segments and then its replay at half speed", () => {
  expect(clipSeconds({ segments: [{ start: 10, end: 28 }] })).toBe(18);
  expect(clipSeconds({ segments: [{ start: 10, end: 28 }], replay: { start: 20, end: 23 } })).toBe(24);
});

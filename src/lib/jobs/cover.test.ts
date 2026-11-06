import { expect, test } from "bun:test";
import { coverArgs, coverAss, coverTime } from "./cover";

test("the cover shows the moment's play, kept inside the clip", () => {
  expect(coverTime({ peak: 100 }, [{ start: 92, end: 112 }])).toBe(100);
  expect(coverTime({ peak: 50 }, [{ start: 92, end: 112 }])).toBe(92);
  expect(coverTime(undefined, [{ start: 92, end: 112 }])).toBe(102);
});

test("the cover's hook sits across the middle, big, and only on the cover", () => {
  const ass = coverAss({ width: 1080, height: 1920, hook: "What a goal", font: "Arial" });
  expect(ass).toContain("PlayResX: 1080");
  expect(ass).toMatch(/Dialogue: 1,0:00:00\.00,0:00:10\.00,Cover,.*WHAT A GOAL/);
});

test("one frame from the play, cropped like the clip, the hook burned in, saved as a JPEG", () => {
  const args = coverArgs({ source: "/m/source.mp4", at: 100, width: 1080, height: 1920, captions: "cover.ass", output: "/m/clips/c.jpg", focus: [{ t: 99, x: 0.3 }, { t: 400, x: 0.9 }] });
  expect(args.slice(0, 6)).toEqual(["-v", "error", "-ss", "100.000", "-i", "/m/source.mp4"]);
  expect(args.slice(args.indexOf("-frames:v"), args.indexOf("-frames:v") + 2)).toEqual(["-frames:v", "1"]);
  const graph = args[args.indexOf("-vf") + 1];
  expect(graph).toContain("scale=1080:1920");
  expect(graph).toContain("ass=cover.ass");
  expect(graph).not.toContain("0.9");
  expect(args.at(-1)).toBe("/m/clips/c.jpg");
});

test("a cover carries the logo too, laid over before the hook", () => {
  const args = coverArgs({ source: "s.mp4", at: 10, width: 1080, height: 1920, captions: "cover.ass", output: "c.jpg", logo: { file: "logo.png", width: 151, x: 886, y: 235 } });
  expect(args.slice(args.indexOf("-i", 5), args.indexOf("-i", 5) + 2)).toEqual(["-i", "logo.png"]);
  const graph = args[args.indexOf("-filter_complex") + 1];
  expect(graph).toContain("[1:v]scale=151:-1");
  expect(graph).toContain("overlay=886:235[vl];[vl]ass=cover.ass");
  expect(args.slice(args.indexOf("-map"), args.indexOf("-map") + 2)).toEqual(["-map", "[v]"]);
});

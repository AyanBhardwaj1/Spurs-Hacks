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
  expect(args.slice(0, 7)).toEqual(["-v", "error", "-ss", "100.000", "-i", "/m/source.mp4", "-frames:v"]);
  const graph = args[args.indexOf("-vf") + 1];
  expect(graph).toContain("scale=1080:1920");
  expect(graph).toContain("ass=cover.ass");
  expect(graph).not.toContain("0.9");
  expect(args.at(-1)).toBe("/m/clips/c.jpg");
});

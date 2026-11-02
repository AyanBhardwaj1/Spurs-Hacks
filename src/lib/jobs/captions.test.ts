import { expect, test } from "bun:test";
import { captionEvents, escapeFilterValue, renderArgs } from "./captions";

const w = (text: string, start: number, end = start + 0.3) => ({ text, start, end });

test("words become short chunks in clip time, breaking on a pause", () => {
  const words = [w("he", 100), w("shoots", 100.4), w("and", 100.8), w("scores!", 101.2), w("Unbelievable", 103)];
  const events = captionEvents(words, [{ start: 99, end: 110 }], 3);
  expect(events.map((e) => [e.text, e.start, e.end])).toEqual([
    ["HE SHOOTS AND", 1, 2.1],
    ["SCORES!", 2.2, 2.5],
    ["UNBELIEVABLE", 4, 4.3],
  ]);
});

test("a highlights cut runs its segments back to back, and words outside them are dropped", () => {
  const words = [w("early", 5), w("first", 12), w("outside", 30), w("second", 52)];
  const events = captionEvents(words, [{ start: 10, end: 20 }, { start: 50, end: 60 }], 3);
  expect(events.map((e) => [e.text, e.start])).toEqual([
    ["FIRST", 2],
    ["SECOND", 12],
  ]);
});

test("filter values that hold a colon, quote or backslash are escaped for ffmpeg", () => {
  expect(escapeFilterValue("/Fonts/My Font's:dir")).toBe("/Fonts/My Font\\'s\\:dir");
});

test("the render crops to the platform, burns captions from the job folder, and levels loudness", () => {
  const args = renderArgs({
    source: "/data/jobs/j1/source.mp4",
    segments: [{ start: 10, end: 28 }, { start: 50, end: 60 }],
    width: 1080,
    height: 1920,
    captions: "captions.ass",
    fontsDir: "/System/Library/Fonts/Supplemental",
    output: "clip.mp4",
  });
  expect(args.filter((a) => a === "-i")).toHaveLength(2);
  expect(args.slice(args.indexOf("-ss"), args.indexOf("-ss") + 4)).toEqual(["-ss", "10.000", "-t", "18.000"]);
  const graph = args[args.indexOf("-filter_complex") + 1];
  expect(graph).toContain("scale=1080:1920");
  expect(graph).toContain("concat=n=2:v=1:a=1");
  expect(graph).toContain("ass=captions.ass:fontsdir=/System/Library/Fonts/Supplemental");
  // loudnorm works at 192 kHz inside; without the resample the clip would ship 96 kHz audio.
  expect(graph).toContain("loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000");
  expect(args.at(-1)).toBe("clip.mp4");
  expect(args).toContain("-shortest");
});

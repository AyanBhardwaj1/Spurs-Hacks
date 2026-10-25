import { describe, expect, test } from "bun:test";
import { ffmpegArgs, renderKey, segmentKeys } from "./render";

describe("segmentKeys", () => {
  const keys = [
    { t: 100, x: 0.4 },
    { t: 101, x: 0.6 },
    { t: 102, x: 0.6 },
  ];

  test("starts and ends the segment on interpolated positions, in segment time", () => {
    expect(segmentKeys(keys, 100.5, 101.5)).toEqual([
      { t: 0, x: 0.5 },
      { t: 0.5, x: 0.6 },
      { t: 1, x: 0.6 },
    ]);
  });

  test("holds the nearest key for a segment that reaches past the moment's keys", () => {
    expect(segmentKeys(keys, 95, 99)).toEqual([
      { t: 0, x: 0.4 },
      { t: 4, x: 0.4 },
    ]);
  });
});

test("fails if render reuse survives a plan, crop or rendition change", () => {
  const clip = { segments: [{ start: 10, end: 20, momentId: "goal" }], format: "9:16" as const, title: "Goal" };
  const focus = new Map([["goal", [{ t: 10, x: 0.3 }, { t: 20, x: 0.7 }]]]);
  const source = { mediaId: 1, format: "original", renditionId: "original-v1", width: 1920, height: 1080 };
  const key = renderKey(clip, focus, source);
  expect(renderKey({ ...clip }, new Map([...focus, ["unused", [{ t: 0, x: 1 }]]]), { ...source })).toBe(key);
  expect(renderKey({ ...clip, title: "Equaliser" }, focus, source)).not.toBe(key);
  expect(renderKey({ ...clip, format: "1:1" }, focus, source)).not.toBe(key);
  expect(renderKey({ ...clip, segments: [{ ...clip.segments[0], end: 21 }] }, focus, source)).not.toBe(key);
  expect(renderKey(clip, new Map([["goal", [{ t: 10, x: 0.6 }]]]), source)).not.toBe(key);
  expect(renderKey(clip, focus, { ...source, renditionId: "original-v2" })).not.toBe(key);
});

test("cropTop leaves out the top of one segment's crop at the same aspect and keeps the others whole", () => {
  const clip = {
    id: "c", lane: "asap" as const, variant: "Goal", format: "9:16" as const, title: "", caption: "", hashtags: [], viralScore: 0, rationale: "",
    segments: [{ start: 10, end: 20 }, { start: 30, end: 40 }], durationSec: 20,
  };
  const args = ffmpegArgs({ clip, url: "u", focus: new Map(), fontFile: "f", escape: (t) => t, wrap: () => [], cropTop: [0.112, 0] }, "out.mp4");
  const graph = args[args.indexOf("-filter_complex") + 1];
  expect(graph).toContain("crop=w=2*trunc(ih*0.888*9/32):h=2*trunc(ih*0.888/2):y=ih-oh:x=");
  expect(graph).toContain("crop=w=2*trunc(ih*9/32):h=ih:y=0:x=");
});

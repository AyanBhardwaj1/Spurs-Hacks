import { expect, test } from "bun:test";
import { clipEdl, frameTimecode } from "./edl";

const source = { name: "Manchester United vs Spurs | Full Match | 2026-27.mp4", fps: 25 };
const events = (edl: string) => edl.split("\n").filter((line) => /^\d{3} {2}/.test(line));

test("frame counts become non-drop HH:MM:SS:FF timecode", () => {
  expect(frameTimecode(0, 25)).toBe("00:00:00:00");
  expect(frameTimecode(90000, 25)).toBe("01:00:00:00");
  expect(frameTimecode(145549, 25)).toBe("01:37:01:24");
});

test("each segment is one event, and the record side runs on from 01:00:00:00 without drifting", () => {
  // c-m-5822-goal-reaction in the committed run: 14 s, 11 s and 6.4 s of the match, 31.4 s in all.
  const edl = clipEdl(
    { title: "10 men. Never beaten.", segments: [{ start: 5814, end: 5828 }, { start: 5833.2, end: 5844.2 }, { start: 5960.6, end: 5967 }] },
    source,
  );
  expect(events(edl)).toEqual([
    "001  AX       AA/V  C        01:36:54:00 01:37:08:00 01:00:00:00 01:00:14:00",
    "002  AX       AA/V  C        01:37:13:05 01:37:24:05 01:00:14:00 01:00:25:00",
    "003  AX       AA/V  C        01:39:20:15 01:39:27:00 01:00:25:00 01:00:31:10",
  ]);
  expect(edl.split("\n").slice(0, 2)).toEqual(["TITLE: 10 men. Never beaten.", "FCM: NON-DROP FRAME"]);
  expect(edl.match(/^\* FROM CLIP NAME: Manchester United vs Spurs \| Full Match \| 2026-27\.mp4$/gm)).toHaveLength(3);
});

test("segments that touch share one frame on both sides, with no gap and no overlap", () => {
  // c-m-5822-goal-international: 5821.968 s rounds to frame 145549.
  const edl = clipEdl({ title: "Ten-man Tottenham fight back", segments: [{ start: 5790, end: 5821.968 }, { start: 5821.968, end: 5845 }] }, source);
  const [first, second] = events(edl).map((line) => line.split(/\s+/).slice(4));
  expect(first[1]).toBe("01:37:01:24");
  expect(second[0]).toBe("01:37:01:24");
  expect(first[3]).toBe(second[2]);
});

test("drops a segment shorter than a frame, folds line breaks out of the title, and refuses non-integer rates", () => {
  const edl = clipEdl({ title: "Two\nlines", segments: [{ start: 10, end: 10.01 }, { start: 20, end: 21 }] }, source);
  expect(events(edl)).toEqual(["001  AX       AA/V  C        00:00:20:00 00:00:21:00 01:00:00:00 01:00:01:00"]);
  expect(edl.startsWith("TITLE: Two lines\n")).toBe(true);
  expect(() => clipEdl({ title: "x", segments: [] }, { ...source, fps: 29.97 })).toThrow();
});

import { describe, expect, test } from "bun:test";
import { parseSrt, parseTimecode } from "./srt";

describe("parseSrt", () => {
  test("reads hour timecodes, CRLF line ends, a BOM and multi-line cues", () => {
    const text =
      "﻿1\r\n00:00:00,040 --> 00:00:05,520\r\nTottenham Hotspur step out\r\nat Old Trafford\r\n\r\n" +
      "1187\r\n01:17:47,640 --> 01:17:52,520\r\nMbeumo turns and scores!\r\n";
    expect(parseSrt(text)).toEqual([
      { index: 1, start: 0.04, end: 5.52, text: "Tottenham Hotspur step out at Old Trafford" },
      { index: 1187, start: 4667.64, end: 4672.52, text: "Mbeumo turns and scores!" },
    ]);
  });

  test("throws on a block with no timing line instead of dropping it", () => {
    expect(() => parseSrt("1\nno timing here\n")).toThrow("without a timing line");
  });
});

describe("parseTimecode", () => {
  test("pads short millisecond fields", () => {
    expect(parseTimecode("00:01:02.5")).toBe(62.5);
  });
});

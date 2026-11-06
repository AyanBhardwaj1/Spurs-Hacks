import { expect, test } from "bun:test";
import { clipSrt, crc32, exportManifest, zipStored } from "./export";
import type { JobClip } from "./types";

test("captions as SRT, numbered from 1, in clip time", () => {
  const words = [{ text: "what", start: 101, end: 101.3 }, { text: "a", start: 101.4, end: 101.5 }, { text: "goal", start: 101.6, end: 102.25 }];
  expect(clipSrt(words, [{ start: 100, end: 110 }])).toBe("1\n00:00:01,000 --> 00:00:02,250\nWHAT A GOAL\n");
  expect(clipSrt([], [{ start: 0, end: 5 }])).toBe("");
});

test("CRC-32 matches the standard check values", () => {
  expect(crc32(new TextEncoder().encode("hello"))).toBe(0x3610a686);
  expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  expect(crc32(new Uint8Array())).toBe(0);
});

test("a stored zip holds each file under its name, with an end record that counts them", () => {
  const zip = zipStored([{ name: "a.txt", data: new TextEncoder().encode("hello") }, { name: "dir/b.txt", data: new TextEncoder().encode("hi") }]);
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  expect(view.getUint32(0, true)).toBe(0x04034b50);
  const end = zip.byteLength - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  expect(view.getUint16(end + 10, true)).toBe(2);
  expect(new TextDecoder().decode(zip)).toContain("dir/b.txt");
});

test("the manifest lists each clip's file, platform and post copy", () => {
  const clip: JobClip = { id: "tiktok-m-30", momentId: "m-30", placement: "tiktok", segments: [{ start: 22, end: 40 }], title: "T", hook: "H", caption: "C", hashtags: ["football"], why: "w", render: { state: "ready", file: "tiktok-m-30.mp4" } };
  expect(exportManifest("City v United", [clip])).toEqual({
    match: "City v United",
    clips: [{ file: "tiktok-m-30.mp4", captions: "tiktok-m-30.srt", platform: "TikTok", placement: "Video", aspect: "9:16", seconds: 18, title: "T", hook: "H", caption: "C", hashtags: ["football"], post: "C #football", order: 1, source: [{ start: 22, end: 40 }] }],
  });
});

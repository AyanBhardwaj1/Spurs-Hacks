import { describe, expect, test } from "bun:test";
import analysis from "./data/mnu-tot.json";
import { crossedPeaks, isFeedSegmentUrl, parsePlaylist, scorebug, sourceAtDate, sourceSecond } from "./live";
import type { Moment } from "./types";

// The feed's playlist as served on 23 October, with the CDN path shortened.
const CDN = "https://cdn.scoreplay.io/m/hls";
const PLAYLIST = `#EXTM3U
#EXT-X-VERSION:6
#EXT-X-TARGETDURATION:2
#EXT-X-MEDIA-SEQUENCE:64147
#EXT-X-DISCONTINUITY-SEQUENCE:20
#EXT-X-PROGRAM-DATE-TIME:2026-10-23T11:37:53.200Z
#EXTINF:2.000000,
${CDN}/video_002333.ts
#EXT-X-PROGRAM-DATE-TIME:2026-10-23T11:37:55.200Z
#EXTINF:2.000000,
${CDN}/video_002334.ts
`;

describe("where the feed is in the match", () => {
  test("reads sequence, segment number and air time for each segment", () => {
    const segs = parsePlaylist(PLAYLIST);
    expect(segs.map((s) => [s.seq, s.n, s.airsAt])).toEqual([
      [64147, 2333, Date.parse("2026-10-23T11:37:53.200Z")],
      [64148, 2334, Date.parse("2026-10-23T11:37:55.200Z")],
    ]);
  });

  test("refuses a segment without a program date time instead of guessing its air time", () => {
    expect(() => parsePlaylist("#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:1\n#EXTINF:2.0,\n" + CDN + "/video_000001.ts\n")).toThrow(/PROGRAM-DATE-TIME/);
  });

  test("segment N starts at source second 2N, so Mbeumo's goal at 4,667.6 s is in segment 2333", () => {
    expect(sourceSecond(2333)).toBe(4666);
    expect(sourceSecond(2333, 1.564)).toBeCloseTo(4667.564);
  });

  test("a program date inside a listed segment maps to that segment's source second", () => {
    const segs = parsePlaylist(PLAYLIST);
    expect(sourceAtDate(Date.parse("2026-10-23T11:37:56.700Z"), segs)).toBeCloseTo(4669.5);
    expect(sourceAtDate(Date.parse("2026-10-23T11:38:30.000Z"), segs)).toBeUndefined();
  });
});

describe("match clock", () => {
  test("matches the broadcast scorebug read off the full-match rendition", () => {
    const onScreen: [number, string][] = [
      [1000, "12:39"],
      [2000, "29:19"],
      [4000, "60:53"],
      [5000, "77:33"],
      [5900, "92:33"],
    ];
    for (const [t, shown] of onScreen) expect([t, scorebug(t)]).toEqual([t, shown]);
  });

  test("shows no running clock at half-time", () => {
    expect(scorebug(3000)).toBeUndefined();
  });
});

describe("moments the feed passes", () => {
  const moments = analysis.moments as Moment[];
  const equaliser = "m-5822-goal";

  test("a moment appears when playback passes its peak", () => {
    expect(crossedPeaks(5821.5, 5822.2, moments).map((m) => m.id)).toEqual([equaliser]);
  });

  test("a peak already passed is not reported again", () => {
    expect(crossedPeaks(5821.968, 5823, moments)).toEqual([]);
  });

  test("a jump, such as the loop restarting or a reconnect, passes nothing", () => {
    expect(crossedPeaks(5800, 5830, moments)).toEqual([]);
    expect(crossedPeaks(6330, 2, moments)).toEqual([]);
  });
});

test("the server fetches segments only over https from ScorePlay's CDN", () => {
  expect(isFeedSegmentUrl("https://cdn.scoreplay.io/a/hls/video_000787.ts")).toBe(true);
  for (const url of [
    "http://cdn.scoreplay.io/a/hls/video_000787.ts",
    "https://cdn.scoreplay.io.evil.example/video_000787.ts",
    "https://169.254.169.254/latest/meta-data",
    "https://cdn.scoreplay.io:8443/video_000787.ts",
    "https://user:pass@cdn.scoreplay.io/video_000787.ts",
    "file:///etc/passwd",
    "not a url",
  ]) {
    expect([url, isFeedSegmentUrl(url)]).toEqual([url, false]);
  }
});

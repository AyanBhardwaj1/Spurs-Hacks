import { expect, test } from "bun:test";
import { parseCopyTime, parseProbe, parseSceneCuts } from "./probe";

const broadcast = `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'source.mp4':
  Duration: 01:45:34.00, start: 0.000000, bitrate: 4210 kb/s
  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(tv, bt709, progressive), 1920x1080 [SAR 1:1 DAR 16:9], 4000 kb/s, 25 fps, 25 tbr, 12800 tbn (default)
  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 48000 Hz, stereo, fltp, 128 kb/s (default)
At least one output file must be specified`;

test("reads duration, size, frame rate and audio from ffmpeg's banner", () => {
  expect(parseProbe(broadcast)).toEqual({ durationSec: 6334, width: 1920, height: 1080, fps: 25, hasAudio: true });
});

test("a phone video shot upright reports its rotated size", () => {
  const phone = `  Duration: 00:02:10.50, start: 0.000000, bitrate: 9000 kb/s
  Stream #0:0[0x1](und): Video: hevc (Main) (hvc1 / 0x31637668), yuv420p(tv, bt709), 1920x1080, 8800 kb/s, 29.97 fps, 29.97 tbr, 600 tbn (default)
    Side data:
      displaymatrix: rotation of -90.00 degrees
  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 44100 Hz, mono, fltp, 96 kb/s (default)`;
  expect(parseProbe(phone)).toEqual({ durationSec: 130.5, width: 1080, height: 1920, fps: 29.97, hasAudio: true });
});

test("a silent video has no audio, and a file with no video stream or duration is refused", () => {
  expect(parseProbe(broadcast.split("\n").filter((l) => !l.includes("Audio:")).join("\n")).hasAudio).toBe(false);
  expect(() => parseProbe("  Duration: 00:01:00.00, start: 0\n  Stream #0:0: Audio: mp3, 44100 Hz, stereo")).toThrow(/no video/);
  expect(() => parseProbe("not a media file")).toThrow(/no duration/);
});

test("scene cuts come back sorted and once each from scdet's metadata print", () => {
  const text = "frame:3 pts:3 pts_time:12.4\nlavfi.scd.score=40.1\nlavfi.scd.time=12.4\nframe:9 pts:9 pts_time:3.2\nlavfi.scd.time=3.2\nlavfi.scd.time=12.4\n";
  expect(parseSceneCuts(text)).toEqual([3.2, 12.4]);
  expect(parseSceneCuts("")).toEqual([]);
});

test("a stream-written file with no duration in its header reads as 0, to be measured", () => {
  const banner = "Input #0, matroska,webm, from 'a.webm':\n  Duration: N/A, start: -0.007000, bitrate: N/A\n  Stream #0:0: Video: vp8, yuv420p(progressive), 320x180, SAR 1:1 DAR 16:9, 25 fps, 25 tbr, 1k tbn\n  Stream #0:1: Audio: opus, 48000 Hz, mono, fltp\n";
  expect(parseProbe(banner)).toEqual({ durationSec: 0, width: 320, height: 180, fps: 25, hasAudio: true });
});

test("the last progress time of a copy pass is the file's length", () => {
  expect(parseCopyTime("frame=  100 time=00:00:03.96 bitrate=N/A\rframe=  199 time=00:01:07.96 bitrate=N/A speed= 40x\n")).toBe(67.96);
  expect(parseCopyTime("no progress here")).toBe(0);
});

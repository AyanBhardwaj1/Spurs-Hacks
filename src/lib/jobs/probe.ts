import type { SourceInfo } from "./types";

// ffprobe is not shipped with ffmpeg-static, so the source is read from the banner `ffmpeg -i` prints.
// Only the first video and audio streams count.

const toSeconds = (h: string, m: string, s: string) => Number(h) * 3600 + Number(m) * 60 + Number(s);

/** Duration, frame size, frame rate and whether there is audio, from `ffmpeg -i` stderr. */
export function parseProbe(banner: string): SourceInfo {
  const duration = /Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(banner);
  if (!duration) throw new Error("The file has no duration; it is not a video ffmpeg can read.");
  const video = /Stream #\d+:\d+.*?: Video: .*?(\d{2,5})x(\d{2,5}).*?(\d+(?:\.\d+)?) (?:fps|tbr)/.exec(banner);
  if (!video) throw new Error("The file has no video stream.");
  // A phone records landscape pixels and a rotation flag; the picture people see is the rotated one.
  const rotation = /rotation of (-?\d+(?:\.\d+)?) degrees|rotate\s*:\s*(-?\d+)/.exec(banner);
  const turned = rotation ? Math.abs(Number(rotation[1] ?? rotation[2])) % 180 === 90 : false;
  const [w, h] = [Number(video[1]), Number(video[2])];
  return {
    durationSec: toSeconds(duration[1], duration[2], duration[3]),
    width: turned ? h : w,
    height: turned ? w : h,
    fps: Number(video[3]),
    hasAudio: /Stream #\d+:\d+.*?: Audio: /.test(banner),
  };
}

/** Cut times from ffmpeg's `metadata=mode=print` output for scdet, sorted and without repeats. */
export function parseSceneCuts(text: string): number[] {
  const times = [...text.matchAll(/lavfi\.scd\.time=([\d.]+)/g)].map((m) => Number(m[1]));
  return [...new Set(times)].sort((a, b) => a - b);
}

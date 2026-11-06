import { PLACEMENTS, xLength } from "@/lib/rundown/platforms";
import { postText } from "./post";
import type { JobClip } from "./types";

// Before a clip is posted: the rendered file and its post text, checked against what the platform takes.
// The file is measured after rendering, so this reports what was made, not what was planned.

export type Check = { label: string; ok: boolean };

export function preflight(clip: JobClip): Check[] {
  const file = clip.render.probe;
  if (!file) return [];
  const p = PLACEMENTS[clip.placement];
  const post = postText(clip);
  const length = p.platform === "X" ? xLength(post) : [...post].length;
  const sec = Math.round(file.durationSec);
  return [
    { label: `${file.width}×${file.height}${file.width === p.width && file.height === p.height ? `, the size ${p.platform} wants` : `, not ${p.width}×${p.height}`}`, ok: file.width === p.width && file.height === p.height },
    { label: `${sec} s, ${sec <= p.maxSeconds ? "within" : "over"} ${p.platform}'s ${p.maxSeconds} s`, ok: file.durationSec <= p.maxSeconds + 0.5 },
    { label: file.hasAudio ? "Has sound" : "No sound", ok: file.hasAudio },
    { label: `Post is ${length} of ${p.captionLimit} characters`, ok: length <= p.captionLimit },
    { label: `${clip.hashtags.length} hashtags, ${clip.hashtags.length <= p.hashtagLimit ? "within" : "over"} ${p.hashtagLimit}`, ok: clip.hashtags.length <= p.hashtagLimit },
  ];
}

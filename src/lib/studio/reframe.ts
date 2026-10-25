import type { ClipFormat, FocusKey } from "./types";

// A 9:16 or 1:1 clip is cut from the 16:9 source by sliding a narrower window across it. The studio draws
// that window in CSS: the video keeps its height, overflows the frame sideways, and is shifted by
// cropShift() so the focus point sits in the middle of the frame without the frame running off either edge.

export const SOURCE_RATIO = 16 / 9;

export const FORMAT_RATIO: Record<ClipFormat, number> = {
  "16:9": 16 / 9,
  "9:16": 9 / 16,
  "1:1": 1,
};

/** Where to centre the crop at source second `t`: linear between keys, held before the first and after the last, 0.5 with none. */
export function focusAt(keys: FocusKey[], t: number) {
  if (keys.length === 0) return 0.5;
  if (t <= keys[0].t) return keys[0].x;
  for (let i = 1; i < keys.length; i++) {
    const b = keys[i];
    if (t <= b.t) {
      const a = keys[i - 1];
      const span = b.t - a.t;
      return span <= 0 ? b.x : a.x + ((b.x - a.x) * (t - a.t)) / span;
    }
  }
  return keys[keys.length - 1].x;
}

/**
 * The horizontal shift, as a fraction of the video's own width (what a CSS translateX percentage measures),
 * that centres focus `x` in a frame of `frameRatio`. 0 means the video's left edge meets the frame's left edge.
 */
export function cropShift(x: number, frameRatio: number, sourceRatio = SOURCE_RATIO) {
  // How many frame-widths wide the video is when both share a height.
  const r = sourceRatio / frameRatio;
  if (r <= 1) return 0;
  const centred = 1 / (2 * r) - x;
  return Math.min(0, Math.max(1 / r - 1, centred));
}

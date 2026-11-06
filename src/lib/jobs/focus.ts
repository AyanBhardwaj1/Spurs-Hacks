import type { FocusKey } from "@/lib/studio/types";

// Where a narrow crop (9:16 or 1:1 cut from widescreen) should sit while a moment plays. Shared by the
// hackathon pipeline (scripts/studio/focus.ts) and the job engine. Pure: frames come in as bytes.
//
// Motion alone was tried first at the hackathon: line up consecutive frames by the camera's pan and take
// the window holding the most residual movement. It followed the bulk of the players rather than the
// ball, and on the equaliser it sat on players jogging upfield while the header went in at the far post.
// So a vision model marks where the ball, or the play around it, is on sampled frames. Between those
// anchors the measured camera pan carries the position along (the action stays put on the pitch while
// the camera moves), a cut lets the crop jump, and a pan-speed limit keeps it from jittering.

/** Small frames for measuring the camera's pan and finding cuts. */
export const MOTION = { width: 160, height: 90, fps: 5 };
/** A 9:16 window's width as a share of a 16:9 frame. */
export const CROP_WIDTH = 9 / 16 / (16 / 9);
/** Rows used to measure the pan: below the scorebug, above the bottom graphics band. */
const BAND = { top: 0.14, bottom: 0.9 };
/** Largest camera shift searched between frames, in pixels of the small frame. */
const MAX_SHIFT = { x: 10, y: 3 };
/**
 * A cut changes what is on screen, so both the aligned difference and the
 * colour histogram jump. Fast close-ups also defeat the alignment, but their
 * histogram mostly holds: on the equaliser, cuts measured 0.40 to 1.00 and
 * celebration close-ups mostly 0.10 to 0.35.
 */
const CUT = { diff: 28, histogram: 0.4 };
/** Fastest the crop may pan, in frame widths per second. */
const MAX_PAN_PER_SEC = 0.4;

const W = MOTION.width;
const H = MOTION.height;

function luma(frame: Uint8Array): Float32Array {
  const out = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) out[i] = (frame[i * 3] + 2 * frame[i * 3 + 1] + frame[i * 3 + 2]) / 4;
  return out;
}

/** Mean L1 distance between the frames' per-channel 16-bin histograms, 0 (same) to 1 (disjoint). */
function histogramDistance(a: Uint8Array, b: Uint8Array): number {
  const bins = new Float32Array(48);
  for (let i = 0; i < W * H; i++) {
    for (let c = 0; c < 3; c++) {
      bins[c * 16 + (a[i * 3 + c] >> 4)]++;
      bins[c * 16 + (b[i * 3 + c] >> 4)]--;
    }
  }
  return bins.reduce((sum, v) => sum + Math.abs(v), 0) / (W * H * 2 * 3);
}

/** The camera's shift from `a` to `b`, so that b(x, y) ≈ a(x - dx, y - dy), and the mean difference left after it. */
export function cameraShift(a: Float32Array, b: Float32Array, width = W, height = H): { dx: number; dy: number; diff: number } {
  let best = { dx: 0, dy: 0, diff: Infinity };
  const y0 = Math.round(height * BAND.top) + MAX_SHIFT.y;
  const y1 = Math.round(height * BAND.bottom) - MAX_SHIFT.y;
  for (let dy = -MAX_SHIFT.y; dy <= MAX_SHIFT.y; dy++) {
    for (let dx = -MAX_SHIFT.x; dx <= MAX_SHIFT.x; dx++) {
      let total = 0;
      let n = 0;
      for (let y = y0; y < y1; y += 2) {
        for (let x = MAX_SHIFT.x; x < width - MAX_SHIFT.x; x += 2) {
          total += Math.abs(b[y * width + x] - a[(y - dy) * width + (x - dx)]);
          n++;
        }
      }
      if (total / n < best.diff) best = { dx, dy, diff: total / n };
    }
  }
  return best;
}

/** Per frame: the camera's horizontal pan from the previous frame, in frame widths, and whether a cut came just before. */
export type Step = { pan: number; cut: boolean };

/** Per-frame camera pan and cuts from small RGB frames (MOTION.width by MOTION.height). */
export function motionSteps(frames: Uint8Array[]): Step[] {
  const lumas = frames.map(luma);
  return frames.map((frame, i) => {
    if (i === 0) return { pan: 0, cut: true };
    const shift = cameraShift(lumas[i - 1], lumas[i]);
    const cut = shift.diff > CUT.diff && histogramDistance(frames[i - 1], frame) > CUT.histogram;
    return { pan: cut ? 0 : shift.dx / W, cut };
  });
}

/**
 * A per-frame crop centre from sparse anchors. Within a shot, a position
 * carried forward from the previous anchor moves with the camera's pan, as
 * does one carried back from the next anchor; between two anchors the two are
 * blended by distance. A shot with no anchor keeps the last position.
 */
export function pathFromAnchors(motion: Step[], anchors: (number | undefined)[]): number[] {
  const out = new Array<number>(motion.length);
  let last = 0.5;
  let shotStart = 0;
  for (let i = 1; i <= motion.length; i++) {
    if (i < motion.length && !motion[i].cut) continue;
    const shot = Array.from({ length: i - shotStart }, (_, k) => shotStart + k);
    const marks = shot.filter((f) => anchors[f] !== undefined);
    for (const f of shot) {
      const prev = marks.filter((m) => m <= f).at(-1);
      const next = marks.find((m) => m >= f);
      // Pan between two frames, summed over frames (from, to].
      const pan = (from: number, to: number) => motion.slice(from + 1, to + 1).reduce((s, m) => s + m.pan, 0);
      const forward = prev === undefined ? undefined : anchors[prev]! + pan(prev, f);
      const backward = next === undefined ? undefined : anchors[next]! - pan(f, next);
      if (forward !== undefined && backward !== undefined) {
        const w = next === prev ? 0 : (f - prev!) / (next! - prev!);
        out[f] = (1 - w) * forward + w * backward;
      } else {
        out[f] = forward ?? backward ?? last;
      }
    }
    last = out[i - 1];
    shotStart = i;
  }
  return out;
}

/** Limits how fast the crop pans, lets it jump at cuts, and keeps a window `cropWidth` wide inside the frame. */
export function limitPan(path: number[], motion: Step[], fps: number, maxPanPerSec = MAX_PAN_PER_SEC, cropWidth = CROP_WIDTH): number[] {
  const half = cropWidth / 2;
  const clamp = (x: number) => Math.min(1 - half, Math.max(half, x));
  const step = maxPanPerSec / fps;
  let position = clamp(path[0] ?? 0.5);
  return path.map((target, i) => {
    position = motion[i].cut ? clamp(target) : clamp(position + Math.max(-step, Math.min(step, clamp(target) - position)));
    return position;
  });
}

/** Keep every anchor interval, plus either side of each cut so the crop jumps instead of sliding. */
function toKeys(path: number[], motion: Step[], start: number, fps: number, keyFps: number): FocusKey[] {
  const every = Math.round(fps / keyFps);
  const keys: FocusKey[] = [];
  path.forEach((x, i) => {
    if (i % every === 0 || motion[i + 1]?.cut || (i > 0 && motion[i].cut)) {
      keys.push({ t: Math.round((start + i / fps) * 100) / 100, x: Math.round(x * 1000) / 1000 });
    }
  });
  return keys;
}

/** Map every vision anchor to its motion frame, then apply the existing cut and speed rules. */
/** A vision mark on one sampled frame; undefined when the model gave none for it. */
export type Anchor = { x: number; ballVisible: boolean } | undefined;

export function focusKeys(motion: Step[], anchors: Anchor[], start: number, motionFps: number, anchorFps: number, cropWidth = CROP_WIDTH): FocusKey[] {
  const perAnchor = motionFps / anchorFps;
  if (!Number.isInteger(perAnchor) || perAnchor < 1) throw new Error("Motion FPS must be a positive multiple of anchor FPS");
  const sparse = motion.map((_, i) => (i % perAnchor === 0 ? anchors[i / perAnchor]?.x : undefined));
  if (anchorFps > 1) {
    // Guesses at hidden-ball positions pulled the dense 5820 s crop away from a confirmed ball sighting.
    let shotStart = 0;
    for (let end = 1; end <= motion.length; end++) {
      if (end < motion.length && !motion[end].cut) continue;
      const sightings = anchors.flatMap((a, i) => a?.ballVisible && i * perAnchor >= shotStart && i * perAnchor < end ? [i * perAnchor] : []);
      if (sightings.length) {
        for (let i = shotStart; i < end; i++) if (!sightings.includes(i)) sparse[i] = undefined;
      }
      shotStart = end;
    }
  }
  const path = limitPan(pathFromAnchors(motion, sparse), motion, motionFps, MAX_PAN_PER_SEC, cropWidth);
  return toKeys(path, motion, start, motionFps, Math.max(2, anchorFps));
}

/** Remove old boundary keys that would force a faster pan into or out of a refinement. */
export function mergeRefinedFocus(base: FocusKey[], refinement: { start: number; end: number; keys: FocusKey[] }): FocusKey[] {
  const first = refinement.keys[0];
  const last = refinement.keys.at(-1);
  if (!first || !last) throw new Error("Focus refinement has no keys");
  const before = base.filter((k) => k.t < refinement.start);
  const after = base.filter((k) => k.t >= refinement.end);
  const tooFast = (a: FocusKey, b: FocusKey) => Math.abs(b.x - a.x) > MAX_PAN_PER_SEC * (b.t - a.t);
  while (before.length && tooFast(before.at(-1)!, first)) before.pop();
  while (after.length && tooFast(last, after[0])) after.shift();
  return [...before, ...refinement.keys, ...after];
}


/** The crop's width as a share of the source's, for an output of the given shape. 1 means no crop. */
export function cropShare(source: { width: number; height: number }, output: { width: number; height: number }) {
  return Math.min(1, output.width / output.height / (source.width / source.height));
}

/**
 * An ffmpeg crop `x` expression that slides a window `ow` wide along focus keys given in source seconds,
 * for a segment that starts at `segmentStart` (ffmpeg's `t` counts from the segment). Linear between keys,
 * held outside them, clamped inside the frame; centred with no keys.
 */
export function focusExpr(keys: FocusKey[], segmentStart: number): string {
  const clampX = (centre: string) => `min(max(iw*(${centre})-ow/2,0),iw-ow)`;
  if (keys.length === 0) return clampX("0.5");
  const local = keys.map((k) => ({ t: Math.round((k.t - segmentStart) * 100) / 100, x: k.x }));
  if (local.length === 1) return clampX(String(local[0].x));
  let expr = String(local.at(-1)!.x);
  for (let i = local.length - 1; i > 0; i--) {
    const a = local[i - 1];
    const b = local[i];
    const span = b.t - a.t;
    const lerp = span <= 0 ? String(b.x) : `${a.x}+(${(b.x - a.x).toFixed(4)})*(t-${a.t})/${span.toFixed(2)}`;
    expr = `if(lt(t,${b.t}),${lerp},${expr})`;
  }
  return clampX(`if(lt(t,${local[0].t}),${local[0].x},${expr})`);
}

/**
 * The crop path for a clip. A single cut follows its own moment; a montage follows, in each segment, the
 * moment whose play it shows, so one moment's path never steers another's footage.
 */
export function clipFocus(clip: { momentId: string; segments: { start: number; end: number }[] }, moments: { id: string; peak: number; focus?: FocusKey[] }[]): FocusKey[] {
  if (clip.segments.length === 1) return moments.find((m) => m.id === clip.momentId)?.focus ?? [];
  return clip.segments.flatMap((seg) => {
    const m = moments.find((x) => x.peak >= seg.start && x.peak <= seg.end);
    return (m?.focus ?? []).filter((k) => k.t >= seg.start - 2 && k.t <= seg.end + 2);
  });
}

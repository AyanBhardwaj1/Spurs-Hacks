import type { FocusKey } from "../../src/lib/studio/types";
import { askClaude, type PromptImage } from "./claude";

// Where a 9:16 crop should sit while a moment plays.
//
// Motion alone was tried first: line up consecutive frames by the camera's
// pan and take the 9:16 window holding the most residual movement on grass.
// It followed the bulk of the players rather than the ball, and on the
// equaliser it sat on players jogging upfield while the header went in at
// the far post. So Opus looks at sampled frames and says where the ball,
// or the play around it, is. Between those anchors the measured camera pan
// carries the position along (the action stays put on the pitch while the
// camera moves), a cut lets the crop jump, and a pan-speed limit keeps it
// from jittering. Frames reach ffmpeg's stdout and Claude's stdin only.

/** Small frames for measuring the camera's pan and finding cuts. */
const MOTION = { width: 160, height: 90, fps: 5 };
/** Default sampling; a refinement can use four anchors a second. */
const ANCHOR = { width: 960, perCall: 40 };
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

function steps(frames: Uint8Array[]): Step[] {
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

/** Limits how fast the crop pans, lets it jump at cuts, and keeps a 9:16 window inside the frame. */
export function limitPan(path: number[], motion: Step[], fps: number, maxPanPerSec = MAX_PAN_PER_SEC): number[] {
  const half = CROP_WIDTH / 2;
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

async function ffmpegStdout(args: string[]): Promise<Uint8Array> {
  const proc = Bun.spawn([process.env.FFMPEG_PATH || "ffmpeg", "-v", "error", "-nostdin", ...args, "-"], { stdout: "pipe", stderr: "pipe" });
  const [bytes, stderr, code] = await Promise.all([
    new Response(proc.stdout).arrayBuffer(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`ffmpeg exited ${code}: ${stderr}`);
  return new Uint8Array(bytes);
}

async function motionFrames(url: string, start: number, end: number, fps: number): Promise<Uint8Array[]> {
  const bytes = await ffmpegStdout([
    "-ss", start.toFixed(2), "-t", (end - start).toFixed(2), "-i", url,
    "-an", "-vf", `fps=${fps},scale=${W}:${H}:flags=area`, "-pix_fmt", "rgb24", "-f", "rawvideo",
  ]);
  const size = W * H * 3;
  const frames: Uint8Array[] = [];
  for (let at = 0; at + size <= bytes.length; at += size) frames.push(bytes.subarray(at, at + size));
  return frames;
}

/** Sampled JPEGs; ffmpeg's MJPEG frames start with an SOI marker, which is where the stream is split. */
async function anchorFrames(url: string, start: number, end: number, fps: number): Promise<string[]> {
  const bytes = await ffmpegStdout([
    "-ss", start.toFixed(2), "-t", (end - start).toFixed(2), "-i", url,
    "-an", "-vf", `fps=${fps},scale=${ANCHOR.width}:-2`, "-q:v", "4", "-f", "image2pipe", "-c:v", "mjpeg",
  ]);
  const starts: number[] = [];
  for (let i = 0; i + 2 < bytes.length; i++) if (bytes[i] === 0xff && bytes[i + 1] === 0xd8 && bytes[i + 2] === 0xff) starts.push(i);
  return starts.map((s, k) => Buffer.from(bytes.subarray(s, starts[k + 1] ?? bytes.length)).toString("base64"));
}

const ANCHOR_SYSTEM = `You locate the action in frames from a football broadcast so that a vertical 9:16 crop can follow it. For each frame, give x: the horizontal position, from 0 (left edge) to 1 (right edge), where the crop should be centred. Use the ball when you can see it. Otherwise use the players contesting the ball or the space the ball is heading into. In a close-up, use the player in focus. In a crowd or bench shot, use the person or group the shot is about. Ignore the scoreboard graphic and on-screen text.`;

const ANCHOR_SCHEMA = {
  type: "object",
  properties: {
    frames: {
      type: "array",
      items: {
        type: "object",
        properties: { frame: { type: "integer" }, x: { type: "number", minimum: 0, maximum: 1 }, ballVisible: { type: "boolean" } },
        required: ["frame", "x", "ballVisible"],
      },
    },
  },
  required: ["frames"],
};

type AnchorAnswer = { frames: { frame: number; x: number; ballVisible: boolean }[] };

async function anchorsFor(name: string, url: string, start: number, end: number, fps: number): Promise<{ x: number; ballVisible: boolean }[]> {
  const jpegs = await anchorFrames(url, start, end, fps);
  const out: { x: number; ballVisible: boolean }[] = [];
  for (let from = 0; from < jpegs.length; from += ANCHOR.perCall) {
    const batch = jpegs.slice(from, from + ANCHOR.perCall);
    const images: PromptImage[] = batch.map((jpegBase64, i) => ({ label: `Frame ${i}`, jpegBase64 }));
    const { value } = await askClaude<AnchorAnswer>({
      name: `focus-${name}-${from}`,
      system: ANCHOR_SYSTEM,
      prompt: `Give x for each of the ${batch.length} frames above, numbered 0 to ${batch.length - 1}.`,
      schema: ANCHOR_SCHEMA,
      images,
    });
    const byFrame = new Map(value.frames.map((f) => [f.frame, f]));
    batch.forEach((_, i) => {
      const answer = byFrame.get(i);
      if (!answer) throw new Error(`Opus gave no position for frame ${i} of ${name} (batch from ${from})`);
      out.push({ x: answer.x, ballVisible: answer.ballVisible });
    });
  }
  return out;
}

/** Map every vision anchor to its motion frame, then apply the existing cut and speed rules. */
export function focusKeys(motion: Step[], anchors: { x: number; ballVisible: boolean }[], start: number, motionFps: number, anchorFps: number): FocusKey[] {
  const perAnchor = motionFps / anchorFps;
  if (!Number.isInteger(perAnchor) || perAnchor < 1) throw new Error("Motion FPS must be a positive multiple of anchor FPS");
  const sparse = motion.map((_, i) => (i % perAnchor === 0 ? anchors[i / perAnchor]?.x : undefined));
  if (anchorFps > 1) {
    // Guesses at hidden-ball positions pulled the dense 5820 s crop away from a confirmed ball sighting.
    let shotStart = 0;
    for (let end = 1; end <= motion.length; end++) {
      if (end < motion.length && !motion[end].cut) continue;
      const sightings = anchors.flatMap((a, i) => a.ballVisible && i * perAnchor >= shotStart && i * perAnchor < end ? [i * perAnchor] : []);
      if (sightings.length) {
        for (let i = shotStart; i < end; i++) if (!sightings.includes(i)) sparse[i] = undefined;
      }
      shotStart = end;
    }
  }
  const path = limitPan(pathFromAnchors(motion, sparse), motion, motionFps);
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

/** Focus keys for one stretch of the source, and how many anchors saw the ball. */
export async function focusFor(name: string, url: string, start: number, end: number, anchorFps: 1 | 4 = 1) {
  // Four anchors a second need an integer number of motion frames between them.
  const motionFps = MOTION.fps * anchorFps;
  const [frames, anchors] = await Promise.all([
    motionFrames(url, start, end, motionFps), anchorsFor(name, url, start, end, anchorFps),
  ]);
  const motion = steps(frames);
  return {
    keys: focusKeys(motion, anchors, start, motionFps, anchorFps),
    anchors: anchors.length,
    ballSeen: anchors.filter((a) => a.ballVisible).length,
    cuts: motion.filter((m, i) => i > 0 && m.cut).length,
  };
}
